// Firestore over its REST API (no SDK). Works in Cloudflare Workers and Node 18+.

const SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// ---- plain object <-> Firestore field values ----

export function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) fields[k] = toValue(v);
  return fields;
}

function toValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}

export function fromFields(fields = {}) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) obj[k] = fromValue(v);
  return obj;
}

function fromValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue; // kept as an ISO string
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields);
  return null;
}

// ---- store over the REST API: households/{hid}/{col}/{id} ----

export function makeStore({ projectId, householdId, getToken }) {
  // Never guess a household: without one, every tool call fails clearly
  if (!projectId || !householdId) throw new Error("HOUSEHOLD_ID / FIREBASE_PROJECT_ID not set on the MCP worker");
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/households/${householdId}`;

  // Returns parsed JSON, or null for a 404 on GET
  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404 && method === "GET") return null;
    if (!res.ok) throw new Error(`Firestore ${method} failed (${res.status}): ${await res.text()}`);
    return res.json();
  }

  const docOf = d => ({ id: d.name.split("/").pop(), ...fromFields(d.fields) });

  return {
    async list(col) {
      const out = [];
      let token = "";
      do {
        const page = await call("GET", `${base}/${col}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
        out.push(...(page.documents || []).map(docOf));
        token = page.nextPageToken || "";
      } while (token);
      return out;
    },
    async get(col, id) {
      const doc = await call("GET", `${base}/${col}/${encodeURIComponent(id)}`);
      return doc ? docOf(doc) : null;
    },
    // PATCH with no updateMask replaces the whole document
    async put(col, id, data) {
      await call("PATCH", `${base}/${col}/${encodeURIComponent(id)}`, { fields: toFields(data) });
      return id;
    },
    async add(col, data) {
      const doc = await call("POST", `${base}/${col}`, { fields: toFields(data) });
      return doc.name.split("/").pop();
    },
  };
}

// ---- service account -> OAuth access token (RS256 JWT, cached in memory) ----

let cache = { token: null, expMs: 0 };

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = obj => b64url(new TextEncoder().encode(JSON.stringify(obj)));

export async function getServiceAccountToken(serviceAccountJson) {
  if (cache.token && Date.now() < cache.expMs - 60000) return cache.token; // refresh 1 min early

  const sa = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64urlJson({ alg: "RS256", typ: "JWT" })}.${b64urlJson({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  })}`;

  // PEM -> DER bytes, then sign with RSASSA-PKCS1-v1_5 / SHA-256
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${b64url(sig)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status}): ${await res.text()}`);
  const j = await res.json();
  cache = { token: j.access_token, expMs: Date.now() + j.expires_in * 1000 };
  return cache.token;
}
