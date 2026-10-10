// Tests for tools/inbox-push.js (PC → Firestore inbox, V2 step 1) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { toFields, makeJwt, pushItems } = require("../tools/inbox-push.js");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = {
  project_id: "food-tracker-test",
  client_email: "bot@food-tracker-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
};

const b64json = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

test("toFields turns plain values into Firestore REST fields", () => {
  assert.deepEqual(
    toFields({ name: "Chicken", price: 3.5, packs: 3, bb: true, photo: null }),
    {
      name: { stringValue: "Chicken" },
      price: { doubleValue: 3.5 },
      packs: { integerValue: "3" },
      bb: { booleanValue: true },
      photo: { nullValue: null },
    }
  );
});

test("toFields skips undefined values", () => {
  assert.deepEqual(toFields({ name: "Milk", sub: undefined }), { name: { stringValue: "Milk" } });
});

test("makeJwt makes a signed RS256 token for the Firestore scope", () => {
  const jwt = makeJwt(key, 1000);
  const [h, p, sig] = jwt.split(".");
  assert.deepEqual(b64json(h), { alg: "RS256", typ: "JWT" });
  const claims = b64json(p);
  assert.equal(claims.iss, key.client_email);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claims.scope, "https://www.googleapis.com/auth/datastore");
  assert.equal(claims.iat, 1000);
  assert.equal(claims.exp, 1000 + 3600);
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, "base64url"));
  assert.ok(ok, "signature should verify with the public key");
});

function fakeFetch() {
  const calls = [];
  let n = 0;
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url === "https://oauth2.googleapis.com/token") {
      return { ok: true, json: async () => ({ access_token: "tok123" }) };
    }
    n++;
    return { ok: true, json: async () => ({ name: `.../inbox/doc${n}` }) };
  };
  return { fetch, calls };
}

test("pushItems gets a token once, then posts each item to the household inbox", async () => {
  const { fetch, calls } = fakeFetch();
  const names = await pushItems({
    key,
    household: "tryout",
    items: [{ name: "Chicken", date: "2026-10-14" }, { name: "Potatoes" }],
    fetch,
    now: 1000,
  });

  assert.deepEqual(names, [".../inbox/doc1", ".../inbox/doc2"]);
  assert.equal(calls.length, 3);

  const tokenCall = calls[0];
  assert.equal(tokenCall.opts.method, "POST");
  const form = new URLSearchParams(tokenCall.opts.body);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.ok(form.get("assertion").split(".").length === 3);

  const post = calls[1];
  assert.equal(
    post.url,
    "https://firestore.googleapis.com/v1/projects/food-tracker-test/databases/(default)/documents/households/tryout/inbox"
  );
  assert.equal(post.opts.method, "POST");
  assert.equal(post.opts.headers.Authorization, "Bearer tok123");
  assert.deepEqual(JSON.parse(post.opts.body), {
    fields: { name: { stringValue: "Chicken" }, date: { stringValue: "2026-10-14" } },
  });
});

test("pushItems throws a clear error when Firestore says no", async () => {
  const fetch = async (url) =>
    url.includes("oauth2")
      ? { ok: true, json: async () => ({ access_token: "t" }) }
      : { ok: false, status: 403, text: async () => "PERMISSION_DENIED" };
  await assert.rejects(
    pushItems({ key, household: "tryout", items: [{ name: "Milk" }], fetch, now: 1 }),
    /403.*PERMISSION_DENIED/
  );
});

test("pushItems throws when the token request fails", async () => {
  const fetch = async () => ({ ok: false, status: 400, text: async () => "invalid_grant" });
  await assert.rejects(
    pushItems({ key, household: "tryout", items: [{ name: "Milk" }], fetch, now: 1 }),
    /400.*invalid_grant/
  );
});
