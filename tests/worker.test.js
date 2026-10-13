// Tests for worker/ (Cloudflare Worker: phone photo -> Claude -> Quick fill) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");

const PID = "food-tracker-92b1c";
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0); // Tue 13 Oct 2026, 12:00 UTC
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const HOUSE_URL = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents/households/`;
const API_URL = "https://api.anthropic.com/v1/messages";

let W; // worker/src/index.js
test.before(async () => {
  W = await import("../worker/src/index.js");
});

// ---- helpers ----

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// One RSA key pair standing in for Google's token signing keys
let keys;
async function getKeys() {
  if (keys) return keys;
  const pair = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  keys = { pair, jwk: { ...jwk, kid: "k1", alg: "RS256", use: "sig" } };
  return keys;
}

// A Firebase-style ID token; `over` changes claims, `kid` changes the header
async function makeToken(over = {}, kid = "k1") {
  const { pair } = await getKeys();
  const s = Math.floor(NOW / 1000);
  const header = { alg: "RS256", kid, typ: "JWT" };
  const claims = { iss: `https://securetoken.google.com/${PID}`, aud: PID, sub: "u1", iat: s - 60, exp: s + 3000, ...over };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

// In-memory stand-in for a Cloudflare KV namespace
function fakeKV() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => (m.has(k) ? (type === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
  };
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

// Fake network: Google keys, Firestore household docs, and Claude answers per model
function fakeNet({ members = { h1: ["u1", "u2"] }, answers = {}, apiFail = {} } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    url = String(url);
    calls.push({ url, init });
    if (url === JWK_URL) return json({ keys: [(await getKeys()).jwk] });
    if (url.startsWith(HOUSE_URL)) {
      const h = url.slice(HOUSE_URL.length);
      if (!members[h]) return json({ error: { code: 403 } }, 403);
      return json({ fields: { members: { arrayValue: { values: members[h].map((v) => ({ stringValue: v })) } } } });
    }
    if (url === API_URL) {
      const body = JSON.parse(init.body);
      if (apiFail[body.model]) return json({ error: { message: "overloaded" } }, 529);
      const list = answers[body.model] || [];
      const text = list.length ? list.shift() : '{"name":"Milk","date":"2026-10-20","kind":"misc"}';
      return json({ content: [{ type: "text", text }], usage: { input_tokens: 1000, output_tokens: 100 } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetch, calls, apiCalls: () => calls.filter((c) => c.url === API_URL).map((c) => JSON.parse(c.init.body)) };
}

function env(over = {}) {
  return { ANTHROPIC_API_KEY: "sk-test", FIREBASE_PROJECT_ID: PID, WEEKLY_CAP: "100", ALLOWED_ORIGINS: "https://app.example", KV: fakeKV(), ...over };
}

async function call(method, route, { body, token, e = env(), net = fakeNet(), origin = "https://app.example" } = {}) {
  const headers = { origin };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const req = new Request(`https://worker.example${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await W.handle(req, e, { fetch: net.fetch, now: () => NOW });
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
}

const photo = (id) => ({ id, jpeg: Buffer.from(`jpeg-${id}`).toString("base64") });
const scanBody = (n = 1, over = {}) => ({ household: "h1", today: "2026-10-13", names: ["Milk", "Chicken"], photos: Array.from({ length: n }, (_, i) => photo(`p${i + 1}`)), ...over });

// ---- prompt + reply parsing (copied from tools/photo-test) ----

test("prompt is the tested prompt, with names and year filled in", () => {
  const tpl = fs.readFileSync(path.join(__dirname, "../tools/photo-test/prompt.txt"), "utf8");
  assert.equal(W.PROMPT, tpl);
  const p = W.buildPrompt(["Milk", "Eggs"], 2026);
  assert.ok(p.includes("Milk, Eggs"));
  assert.ok(!p.includes("{{NAMES}}") && !p.includes("{{YEAR}}"));
});

test("parseReply matches the photo-test version", () => {
  const lib = require("../tools/photo-test/lib.js");
  for (const t of [
    '{"name":"Milk","date":"2026-10-20","kind":"misc","bb":true}',
    '```json\n{"name":"Carrots","kind":"veg","date":"2026-10-20"}\n```',
    '{"name":"Ham","date":"2026-02-30"}',
    "no json here",
    '{"name":"Sausages","packs":2,"price":3.5,"kind":"main","date":"2026-10-15"}',
  ]) assert.deepEqual(W.parseReply(t), lib.parseReply(t), t);
});

test("needsRetry: error, no date on non-veg, or a past date", () => {
  assert.equal(W.needsRetry({ error: "x" }, "2026-10-13"), true);
  assert.equal(W.needsRetry({ date: null, kind: "main" }, "2026-10-13"), true);
  assert.equal(W.needsRetry({ date: null, kind: "veg" }, "2026-10-13"), false);
  assert.equal(W.needsRetry({ date: "2026-10-12", kind: "main" }, "2026-10-13"), true);
  assert.equal(W.needsRetry({ date: "2026-10-13", kind: "main" }, "2026-10-13"), false);
});

// ---- sign-in ----

test("verifyToken accepts a good Firebase token and returns the uid", async () => {
  const net = fakeNet();
  const uid = await W.verifyToken(await makeToken(), PID, { fetch: net.fetch, now: () => NOW });
  assert.equal(uid, "u1");
});

test("verifyToken rejects bad tokens", async () => {
  const deps = { fetch: fakeNet().fetch, now: () => NOW };
  const s = Math.floor(NOW / 1000);
  const bad = [
    await makeToken({ exp: s - 10 }),                       // expired
    await makeToken({ aud: "other-project" }),              // wrong project
    await makeToken({ iss: "https://evil.example" }),       // wrong issuer
    await makeToken({ sub: "" }),                           // no user
    await makeToken({ iat: s + 3600 }),                     // issued in the future
    await makeToken({}, "unknown-kid"),                     // unknown key
    (await makeToken()).slice(0, -4) + "AAAA",              // tampered signature
    "not.a.token",
    "",
  ];
  for (const t of bad) assert.equal(await W.verifyToken(t, PID, deps), null, t.slice(0, 40));
});

test("scan without a token is 401", async () => {
  const r = await call("POST", "/scan", { body: scanBody() });
  assert.equal(r.status, 401);
});

test("scan for a household you're not in is 403, and Firestore is asked with your token", async () => {
  const token = await makeToken({ sub: "u9" });
  const net = fakeNet();
  const r = await call("POST", "/scan", { body: scanBody(), token, net });
  assert.equal(r.status, 403);
  const fs1 = net.calls.find((c) => c.url.startsWith(HOUSE_URL));
  assert.equal(fs1.init.headers.authorization || fs1.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(net.apiCalls().length, 0);
});

test("unknown household is 403", async () => {
  const r = await call("POST", "/scan", { body: scanBody(1, { household: "nope" }), token: await makeToken() });
  assert.equal(r.status, 403);
});

// ---- input checks ----

test("bad scan bodies are 400", async () => {
  const token = await makeToken();
  for (const body of [
    scanBody(0),
    scanBody(6), // max 5 per call
    scanBody(1, { household: "../x" }),
    scanBody(1, { today: "13/10/2026" }),
    scanBody(1, { photos: [{ id: "p1" }] }),
    scanBody(1, { photos: [{ jpeg: "abc" }] }),
  ]) {
    const r = await call("POST", "/scan", { body, token });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
});

// ---- the scan itself ----

test("good photo: one Haiku call, answer tied to the photo id", async () => {
  const net = fakeNet({ answers: { "claude-haiku-5-5": ['{"name":"Chicken","date":"2026-10-16","kind":"main","bb":false}'] } });
  const r = await call("POST", "/scan", { body: scanBody(1), token: await makeToken(), net });
  assert.equal(r.status, 200);
  assert.equal(r.data.results.length, 1);
  const x = r.data.results[0];
  assert.equal(x.id, "p1");
  assert.equal(x.name, "Chicken");
  assert.equal(x.date, "2026-10-16");
  assert.equal(x.model, "claude-haiku-5-5");
  assert.equal(x.retried, false);
  assert.equal(x.needsCheck, false);
  const api = net.apiCalls();
  assert.equal(api.length, 1);
  assert.equal(api[0].model, "claude-haiku-5-5");
  assert.equal(api[0].thinking, undefined, "thinking left at the model default");
  assert.equal(api[0].messages[0].content[0].source.data, photo("p1").jpeg);
  assert.ok(api[0].messages[0].content[1].text.includes("Milk, Chicken"));
  const h = net.calls.find((c) => c.url === API_URL).init.headers;
  assert.equal(h["x-api-key"], "sk-test");
  assert.ok(h["anthropic-version"]);
});

test("no date on a non-veg item: Sonnet re-checks", async () => {
  const net = fakeNet({ answers: {
    "claude-haiku-5-5": ['{"name":"Ham","kind":"main"}'],
    "claude-sonnet-5-5": ['{"name":"Ham","date":"2026-10-18","kind":"main"}'],
  } });
  const r = await call("POST", "/scan", { body: scanBody(1), token: await makeToken(), net });
  const x = r.data.results[0];
  assert.equal(x.date, "2026-10-18");
  assert.equal(x.model, "claude-sonnet-5-5");
  assert.equal(x.retried, true);
  assert.equal(x.needsCheck, false);
  assert.deepEqual(net.apiCalls().map((a) => a.model), ["claude-haiku-5-5", "claude-sonnet-5-5"]);
});

test("veg with no date: no retry", async () => {
  const net = fakeNet({ answers: { "claude-haiku-5-5": ['{"name":"Carrots","kind":"veg"}'] } });
  const r = await call("POST", "/scan", { body: scanBody(1), token: await makeToken(), net });
  assert.equal(r.data.results[0].retried, false);
  assert.equal(r.data.results[0].needsCheck, false);
  assert.equal(net.apiCalls().length, 1);
});

test("still past after Sonnet: amber CHECK, photo kept as a test case", async () => {
  const e = env();
  const net = fakeNet({ answers: {
    "claude-haiku-5-5": ['{"name":"Ham","date":"2026-10-01","kind":"main"}'],
    "claude-sonnet-5-5": ['{"name":"Ham","date":"2026-10-02","kind":"main"}'],
  } });
  const r = await call("POST", "/scan", { body: scanBody(1), token: await makeToken(), net, e });
  const x = r.data.results[0];
  assert.equal(x.needsCheck, true);
  assert.ok(x.failKey && x.failKey.startsWith("fail:h1:"));
  const saved = JSON.parse(e.KV.m.get(x.failKey));
  assert.equal(saved.jpeg, photo("p1").jpeg);
  assert.equal(saved.household, "h1");
  assert.equal(saved.result.date, "2026-10-02");
  assert.equal(saved.date, null);
});

test("blank after Sonnet keeps Haiku's name, amber CHECK, photo kept", async () => {
  const e = env();
  const net = fakeNet({ answers: {
    "claude-haiku-5-5": ['{"name":"Pork ribs","kind":"main"}'],
    "claude-sonnet-5-5": ['{"kind":"main"}'],
  } });
  const r = await call("POST", "/scan", { body: scanBody(1), token: await makeToken(), net, e });
  const x = r.data.results[0];
  assert.equal(x.name, "Pork ribs");
  assert.equal(x.date, null);
  assert.equal(x.needsCheck, true);
  assert.ok(e.KV.m.has(x.failKey));
});

test("API errors on both models: amber CHECK, not a crash", async () => {
  const net = fakeNet({ apiFail: { "claude-haiku-5-5": true, "claude-sonnet-5-5": true } });
  const r = await call("POST", "/scan", { body: scanBody(1), token: await makeToken(), net });
  assert.equal(r.status, 200);
  assert.equal(r.data.results[0].needsCheck, true);
  assert.equal(r.data.results[0].date, null);
});

test("5 photos: 5 results in the same order as sent", async () => {
  const r = await call("POST", "/scan", { body: scanBody(5), token: await makeToken() });
  assert.deepEqual(r.data.results.map((x) => x.id), ["p1", "p2", "p3", "p4", "p5"]);
});

// ---- weekly cap ----

test("weekly cap: counts photos, refuses past the cap with 429", async () => {
  const e = env({ WEEKLY_CAP: "7" });
  const token = await makeToken();
  let r = await call("POST", "/scan", { body: scanBody(5), token, e });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.week, { used: 5, cap: 7 });
  const net = fakeNet();
  r = await call("POST", "/scan", { body: scanBody(3), token, e, net });
  assert.equal(r.status, 429);
  assert.deepEqual(r.data.week, { used: 5, cap: 7 });
  assert.equal(net.apiCalls().length, 0, "no Claude calls once capped");
  r = await call("POST", "/scan", { body: scanBody(2), token, e });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.week, { used: 7, cap: 7 });
});

test("weekly cap is per household and resets on Monday", () => {
  assert.equal(W.weekKey("h1", Date.UTC(2026, 9, 13)), "week:h1:2026-10-12"); // Tue -> Mon 12th
  assert.equal(W.weekKey("h1", Date.UTC(2026, 9, 18)), "week:h1:2026-10-12"); // Sun
  assert.equal(W.weekKey("h1", Date.UTC(2026, 9, 19)), "week:h1:2026-10-19"); // next Mon
  assert.equal(W.weekKey("h2", Date.UTC(2026, 9, 13)), "week:h2:2026-10-12");
});

// ---- cost log ----

test("cost log: calls and dollars per model for the month", async () => {
  const e = env();
  const net = fakeNet({ answers: {
    "claude-haiku-5-5": ['{"name":"Ham","kind":"main"}', '{"name":"Milk","date":"2026-10-20","kind":"misc"}'],
    "claude-sonnet-5-5": ['{"name":"Ham","date":"2026-10-18","kind":"main"}'],
  } });
  const r = await call("POST", "/scan", { body: scanBody(2), token: await makeToken(), net, e });
  // 1000 in / 100 out per call: Haiku $0.00015, Sonnet $0.003
  const m = r.data.month;
  assert.equal(m.month, "2026-10");
  assert.equal(m.calls["claude-haiku-5-5"], 2);
  assert.equal(m.calls["claude-sonnet-5-5"], 1);
  assert.ok(Math.abs(m.cost - (2 * 0.00015 + 0.003)) < 1e-9);
  const saved = JSON.parse(e.KV.m.get("cost:h1:2026-10"));
  assert.deepEqual(saved, m);
});

test("GET /usage shows this week and month", async () => {
  const e = env();
  const token = await makeToken();
  await call("POST", "/scan", { body: scanBody(2), token, e });
  const r = await call("GET", "/usage?household=h1", { token, e });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.week, { used: 2, cap: 100 });
  assert.equal(r.data.month.calls["claude-haiku-5-5"], 2);
  const none = await call("GET", "/usage?household=h1", { token: await makeToken({ sub: "u9" }), e });
  assert.equal(none.status, 403);
});

// ---- typing in the right date for a failed photo ----

test("POST /fail-date saves the real date on a kept photo", async () => {
  const e = env();
  const token = await makeToken();
  const net = fakeNet({ answers: { "claude-haiku-5-5": ['{"kind":"main"}'], "claude-sonnet-5-5": ['{"kind":"main"}'] } });
  const s = await call("POST", "/scan", { body: scanBody(1), token, net, e });
  const key = s.data.results[0].failKey;
  let r = await call("POST", "/fail-date", { body: { household: "h1", key, date: "2026-10-21" }, token, e });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(e.KV.m.get(key)).date, "2026-10-21");
  r = await call("POST", "/fail-date", { body: { household: "h1", key, date: "21/10" }, token, e });
  assert.equal(r.status, 400);
  r = await call("POST", "/fail-date", { body: { household: "h1", key: "fail:h2:x", date: "2026-10-21" }, token, e });
  assert.equal(r.status, 403, "can't touch another household's photo");
  r = await call("POST", "/fail-date", { body: { household: "h1", key: "fail:h1:missing", date: "2026-10-21" }, token, e });
  assert.equal(r.status, 404);
});

// ---- CORS + routing ----

test("CORS: preflight from the app is allowed, other sites are not", async () => {
  let r = await call("OPTIONS", "/scan");
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://app.example");
  assert.ok(/authorization/i.test(r.headers.get("access-control-allow-headers")));
  r = await call("OPTIONS", "/scan", { origin: "https://evil.example" });
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  r = await call("POST", "/scan", { body: scanBody(1), token: await makeToken() });
  assert.equal(r.headers.get("access-control-allow-origin"), "https://app.example");
});

test("unknown route is 404", async () => {
  const r = await call("GET", "/nope", { token: await makeToken() });
  assert.equal(r.status, 404);
});

test("default export hands fetch to handle", () => {
  assert.equal(typeof W.default.fetch, "function");
});

test("API key never appears in any reply", async () => {
  const net = fakeNet({ apiFail: { "claude-haiku-5-5": true, "claude-sonnet-5-5": true } });
  const r = await call("POST", "/scan", { body: scanBody(1), token: await makeToken(), net });
  assert.ok(!JSON.stringify(r.data).includes("sk-test"));
});

test("live entry point calls fetch the way Cloudflare allows (no 'Illegal invocation')", async () => {
  const net = fakeNet();
  const real = globalThis.fetch;
  // Cloudflare throws when fetch is called as a method of another object
  globalThis.fetch = function (url, init) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return net.fetch(url, init);
  };
  try {
    const req = new Request("https://worker.example/usage?household=h1", { headers: { authorization: `Bearer ${await makeToken()}` } });
    const realNow = Date.now;
    Date.now = () => NOW;
    let res;
    try { res = await W.default.fetch(req, env()); } finally { Date.now = realNow; }
    assert.equal(res.status, 200);
  } finally {
    globalThis.fetch = real;
  }
});

test("POST /fail-date accepts 'none' (Darren chose no date)", async () => {
  const e = env();
  const token = await makeToken();
  const net = fakeNet({ answers: { "claude-haiku-5-5": ['{"kind":"main"}'], "claude-sonnet-5-5": ['{"kind":"main"}'] } });
  const s = await call("POST", "/scan", { body: scanBody(1), token, net, e });
  const key = s.data.results[0].failKey;
  const r = await call("POST", "/fail-date", { body: { household: "h1", key, date: "none" }, token, e });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(e.KV.m.get(key)).date, "none");
});
