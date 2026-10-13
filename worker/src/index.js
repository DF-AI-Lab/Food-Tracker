// Cloudflare Worker: phone photos -> Claude -> Quick fill. Web APIs only, no npm packages.
import { PROMPT } from "./prompt.js";

export { PROMPT };

const MODEL = "claude-haiku-5-5";
const RETRY_MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const FS_URL = (pid) => `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;
// USD per million tokens
const PRICES = { "claude-haiku-5-5": { in: 0.10, out: 0.50 }, "claude-sonnet-5-5": { in: 2, out: 10 } };
const HOUSE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const okHouse = (h) => typeof h === "string" && HOUSE_RE.test(h);

// ---- prompt + reply parsing (copied from tools/photo-test) ----

export function buildPrompt(names, year) {
  return PROMPT.split("{{NAMES}}").join(names.join(", ")).split("{{YEAR}}").join(String(year));
}

// Keep a YYYY-MM-DD string only if it is a real calendar date.
function realDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const ok = t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  return ok ? s : null;
}

const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const norm = (v) => String(v ?? "").trim().toLowerCase();

// Model text -> one clean entry. Never guesses: bad fields become null.
export function parseReply(text) {
  const raw = String(text ?? "").replace(/```\w*/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let o;
  try {
    if (start < 0 || end < start) throw new Error("no object");
    o = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { error: "Couldn't read reply", needsCheck: true, date: null };
  }
  const kind = ["main", "side", "veg", "misc"].includes(norm(o.kind)) ? norm(o.kind) : null;
  // Veg never has a date: the app counts from the day it goes in the fridge
  const date = kind === "veg" ? null : realDate(o.date);
  const noDate = o.noDate === true || kind === "veg";
  return {
    name: clean(o.name),
    sub: clean(o.sub),
    kind,
    date,
    bb: o.bb === true && kind !== "veg",
    price: typeof o.price === "number" && Number.isFinite(o.price) ? o.price : null,
    packs: Number.isInteger(o.packs) && o.packs >= 2 ? o.packs : null,
    noDate,
    needsCheck: date === null && !noDate,
  };
}

// Retry on an error, a missing date on something that should have one, or a past date
export function needsRetry(r, today) {
  if (r.error) return true;
  if (r.date == null) return r.kind !== "veg";
  return Boolean(today) && r.date < today;
}

// ---- sign-in: Firebase ID tokens checked against Google's public keys ----

const bytes = (s) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

let jwkCache = { at: 0, keys: [] };
// Google's signing keys, cached for an hour and refetched when an unknown kid shows up
async function signingKey(kid, deps) {
  const now = deps.now();
  let jwk = now - jwkCache.at < 3600e3 ? jwkCache.keys.find((k) => k.kid === kid) : null;
  if (!jwk) {
    const data = await (await deps.fetch(JWK_URL)).json();
    jwkCache = { at: now, keys: data.keys || [] };
    jwk = jwkCache.keys.find((k) => k.kid === kid);
  }
  return jwk || null;
}

// RS256 check of a Firebase ID token. Returns the uid, or null. Never throws.
export async function verifyToken(token, projectId, deps) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const dec = (x) => new TextDecoder().decode(bytes(x));
    const header = JSON.parse(dec(h));
    const claims = JSON.parse(dec(p));
    const jwk = header.alg === "RS256" && (await signingKey(header.kid, deps));
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const sigOk = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes(s), new TextEncoder().encode(`${h}.${p}`));
    const now = Math.floor(deps.now() / 1000);
    const good = sigOk
      && claims.iss === `https://securetoken.google.com/${projectId}`
      && claims.aud === projectId
      && claims.exp > now
      && claims.iat <= now + 60
      && typeof claims.sub === "string" && claims.sub !== "";
    return good ? claims.sub : null;
  } catch {
    return null;
  }
}

// Member only if the household doc, read with the user's own token, lists their uid
async function isMember(token, uid, household, env, deps) {
  try {
    const res = await deps.fetch(`${FS_URL(env.FIREBASE_PROJECT_ID)}/households/${household}`,
      { headers: { authorization: `Bearer ${token}` } });
    if (res.status !== 200) return false;
    const doc = await res.json();
    return (doc.fields?.members?.arrayValue?.values || []).some((v) => v.stringValue === uid);
  } catch {
    return false;
  }
}

async function signedIn(request, env, deps) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  const uid = await verifyToken(token, env.FIREBASE_PROJECT_ID, deps);
  return uid ? { token, uid } : null;
}

// ---- KV keys: weekly cap, monthly cost log ----

// Monday (UTC) of the week containing ms
export function weekKey(household, ms) {
  const d = new Date(ms);
  const back = (d.getUTCDay() + 6) % 7;
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
  return `week:${household}:${mon.toISOString().slice(0, 10)}`;
}

const monthOf = (now) => new Date(now).toISOString().slice(0, 7);
const costKey = (h, now) => `cost:${h}:${monthOf(now)}`;
async function monthLog(env, household, now) {
  return (await env.KV.get(costKey(household, now), "json")) || { month: monthOf(now), cost: 0, calls: {} };
}

// ---- Claude ----

// One Claude call. Any failure becomes a needs-check answer; no key or raw body is passed on.
async function ask(model, photo, ctx, calls) {
  try {
    const res = await ctx.deps.fetch(API_URL, {
      method: "POST",
      headers: { "x-api-key": ctx.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo.jpeg } },
          { type: "text", text: ctx.prompt },
        ] }],
      }),
    });
    if (!res.ok) return { error: `Claude ${res.status}`, date: null, needsCheck: true };
    const data = await res.json();
    calls.push({ model, input_tokens: data.usage?.input_tokens || 0, output_tokens: data.usage?.output_tokens || 0 });
    const block = (data.content || []).find((b) => b.type === "text");
    return parseReply(block ? block.text : "");
  } catch {
    return { error: "Claude call failed", date: null, needsCheck: true };
  }
}

// Haiku first; a doubtful answer is re-checked by Sonnet (same rules as tools/photo-test/run-api.js)
async function scanOne(photo, ctx) {
  const calls = [];
  let answer = await ask(MODEL, photo, ctx, calls);
  let model = MODEL;
  const retried = needsRetry(answer, ctx.today);
  if (retried) {
    const again = await ask(RETRY_MODEL, photo, ctx, calls);
    // Keep Haiku's name if Sonnet lost the date as well
    if (again.date == null && answer.name) {
      again.name = answer.name;
      again.sub = answer.sub;
    }
    answer = again;
    model = RETRY_MODEL;
  }
  // Still past after the retry: keep the photo and ask for a check
  if (answer.date && answer.date < ctx.today) answer.needsCheck = true;
  const result = {
    id: photo.id, name: answer.name ?? null, sub: answer.sub ?? null, date: answer.date ?? null,
    bb: answer.bb === true, price: answer.price ?? null, packs: answer.packs ?? null,
    kind: answer.kind ?? null, noDate: answer.noDate === true, needsCheck: answer.needsCheck === true,
    model, retried,
  };
  return { result, calls };
}

// ---- routes ----

function validScan(b) {
  return Boolean(okHouse(b.household) && realDate(b.today) && Array.isArray(b.names)
    && b.names.every((s) => typeof s === "string")
    && Array.isArray(b.photos) && b.photos.length >= 1 && b.photos.length <= 5
    && b.photos.every((p) => p && typeof p.id === "string" && p.id !== "" && typeof p.jpeg === "string" && p.jpeg !== ""));
}

async function scan(request, env, deps, who) {
  const b = await readJson(request);
  if (!b || !validScan(b)) return [400, { error: "bad request" }];
  if (!(await isMember(who.token, who.uid, b.household, env, deps))) return [403, { error: "not a member" }];

  const now = deps.now();
  const cap = Number(env.WEEKLY_CAP);
  const n = b.photos.length;
  const wk = weekKey(b.household, now);
  const used = Number(await env.KV.get(wk)) || 0;
  if (used + n > cap) return [429, { error: "cap", week: { used, cap } }];
  await env.KV.put(wk, String(used + n));

  const ctx = { env, deps, today: b.today, prompt: buildPrompt(b.names, Number(b.today.slice(0, 4))) };
  const out = await Promise.all(b.photos.map((p) => scanOne(p, ctx)));

  // Keep each doubtful photo so the app can save the real date and it becomes a test case
  for (let i = 0; i < n; i++) {
    const { result } = out[i];
    if (result.needsCheck) {
      result.failKey = `fail:${b.household}:${now}-${result.id}`;
      await env.KV.put(result.failKey, JSON.stringify({ household: b.household, jpeg: b.photos[i].jpeg, result, at: now, date: null }));
    }
  }

  // Add this scan's calls and dollars to the month
  const month = await monthLog(env, b.household, now);
  for (const { calls } of out) {
    for (const c of calls) {
      const p = PRICES[c.model];
      month.cost += (c.input_tokens * p.in + c.output_tokens * p.out) / 1e6;
      month.calls[c.model] = (month.calls[c.model] || 0) + 1;
    }
  }
  await env.KV.put(costKey(b.household, now), JSON.stringify(month));

  return [200, { results: out.map((o) => o.result), week: { used: used + n, cap }, month }];
}

async function usage(url, env, deps, who) {
  const h = url.searchParams.get("household");
  if (!okHouse(h)) return [400, { error: "bad household" }];
  if (!(await isMember(who.token, who.uid, h, env, deps))) return [403, { error: "not a member" }];
  const now = deps.now();
  const used = Number(await env.KV.get(weekKey(h, now))) || 0;
  return [200, { week: { used, cap: Number(env.WEEKLY_CAP) }, month: await monthLog(env, h, now) }];
}

// Save the real date on a kept photo; only photos of the caller's own household
async function failDate(request, env, deps, who) {
  const b = await readJson(request);
  if (!b || !okHouse(b.household)) return [400, { error: "bad request" }];
  if (!(await isMember(who.token, who.uid, b.household, env, deps))) return [403, { error: "not a member" }];
  if (typeof b.key !== "string" || !b.key.startsWith(`fail:${b.household}:`)) return [403, { error: "not this household's photo" }];
  if (!realDate(b.date)) return [400, { error: "bad date" }];
  const rec = await env.KV.get(b.key, "json");
  if (!rec) return [404, { error: "not found" }];
  rec.date = b.date;
  await env.KV.put(b.key, JSON.stringify(rec));
  return [200, { ok: true }];
}

async function readJson(request) {
  try {
    const v = await request.json();
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

async function route(request, env, deps) {
  const url = new URL(request.url);
  const key = `${request.method} ${url.pathname}`;
  if (!["POST /scan", "GET /usage", "POST /fail-date"].includes(key)) return [404, { error: "not found" }];
  const who = await signedIn(request, env, deps);
  if (!who) return [401, { error: "sign in" }];
  if (key === "POST /scan") return scan(request, env, deps, who);
  if (key === "GET /usage") return usage(url, env, deps, who);
  return failDate(request, env, deps, who);
}

export async function handle(request, env, deps) {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const cors = allowed.includes(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type" }
    : {};
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  let reply;
  try {
    reply = await route(request, env, deps);
  } catch {
    reply = [500, { error: "server error" }];
  }
  return new Response(JSON.stringify(reply[1]), { status: reply[0], headers: { "content-type": "application/json", ...cors } });
}

// Wrap fetch: Cloudflare throws "Illegal invocation" if it is called as deps.fetch(...)
export default { fetch: (req, env) => handle(req, env, { fetch: (u, i) => fetch(u, i), now: () => Date.now() }) };
