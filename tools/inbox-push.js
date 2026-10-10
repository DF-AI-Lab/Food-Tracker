// Push items from the PC into a household's Firestore inbox (V2 step 1).
// Usage: node tools/inbox-push.js <key-file.json> <household> <items.json>
// Uses Node built-ins only (node:crypto, global fetch, node:fs).
const crypto = require("node:crypto");
const fs = require("node:fs");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

// Plain object -> Firestore REST "fields" map. Skips undefined values.
function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v === null) fields[k] = { nullValue: null };
    else if (typeof v === "string") fields[k] = { stringValue: v };
    else if (typeof v === "boolean") fields[k] = { booleanValue: v };
    else if (typeof v === "number") {
      fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
  }
  return fields;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// Build a signed RS256 JWT that Google exchanges for an access token.
function makeJwt(key, nowSec) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const input = `${header}.${claims}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(input), key.private_key);
  return `${input}.${b64url(sig)}`;
}

// Throws an Error that includes the HTTP status and response body when not ok.
async function checkOk(res, what) {
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${await res.text()}`);
}

// Push each item into households/<household>/inbox. Returns the created doc names.
async function pushItems({ key, household, items, fetch = globalThis.fetch, now = Math.floor(Date.now() / 1000) }) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: makeJwt(key, now),
    }).toString(),
  });
  await checkOk(tokenRes, "Token request");
  const { access_token: token } = await tokenRes.json();

  const url = `https://firestore.googleapis.com/v1/projects/${key.project_id}/databases/(default)/documents/households/${household}/inbox`;
  const names = [];
  for (const item of items) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: toFields(item) }),
    });
    await checkOk(res, "Firestore write");
    names.push((await res.json()).name);
  }
  return names;
}

module.exports = { toFields, makeJwt, pushItems };

if (require.main === module) {
  (async () => {
    const [keyFile, household, itemsFile] = process.argv.slice(2);
    if (!keyFile || !household || !itemsFile) {
      console.log("usage: node tools/inbox-push.js <key-file.json> <household> <items.json>");
      process.exit(1);
    }
    try {
      const key = JSON.parse(fs.readFileSync(keyFile, "utf8"));
      const parsed = JSON.parse(fs.readFileSync(itemsFile, "utf8"));
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const names = await pushItems({ key, household, items });
      names.forEach((docName, i) => {
        console.log(`✅ sent ${items[i].name ?? "item"} → ${docName}`);
      });
    } catch (err) {
      console.log(`❌ ${err.message}`);
      process.exit(1);
    }
  })();
}
