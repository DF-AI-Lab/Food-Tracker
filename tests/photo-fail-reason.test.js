// A photo the AI couldn't read says WHY (bad key, no credit, busy), not a blank "(no name)" row.
// Darren 2026-11-16: expired Claude key made every scan come back blank. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

let W;
test.before(async () => { W = await import("../worker/src/index.js"); });

const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

// ---- Worker: failReason(status, bodyText) -> short code ----
test("worker failReason: key, credit, busy, other", () => {
  assert.equal(W.failReason(401, ""), "key");
  assert.equal(W.failReason(403, ""), "key");
  assert.equal(W.failReason(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'), "credit");
  assert.equal(W.failReason(429, ""), "busy");
  assert.equal(W.failReason(529, ""), "busy");
  assert.equal(W.failReason(500, ""), "busy");
  assert.equal(W.failReason(400, '{"error":{"message":"bad model"}}'), "error 400");
  assert.equal(W.failReason(0, ""), "network");
});

// ---- Worker: scanOne result carries `fail` when both Claude calls failed ----
async function scanWith(fetchImpl) {
  const ctx = { env: { ANTHROPIC_API_KEY: "sk-test" }, deps: { fetch: fetchImpl }, prompt: "p", today: "2026-11-16" };
  return W.scanOne({ id: "p1", jpeg: "eA==" }, ctx);
}

test("scanOne: expired key -> result.fail is 'key', never shows the key", async () => {
  const { result } = await scanWith(async () => json({ error: { type: "authentication_error", message: "invalid x-api-key" } }, 401));
  assert.equal(result.fail, "key");
  assert.equal(result.name, null);
  assert.equal(result.needsCheck, true);
  assert.ok(!JSON.stringify(result).includes("sk-test"));
});

test("scanOne: no credit -> result.fail is 'credit'", async () => {
  const { result } = await scanWith(async () => json({ error: { message: "Your credit balance is too low" } }, 400));
  assert.equal(result.fail, "credit");
});

test("scanOne: network throw -> result.fail is 'network'", async () => {
  const { result } = await scanWith(async () => { throw new Error("down"); });
  assert.equal(result.fail, "network");
});

test("scanOne: good answer has no fail field", async () => {
  const { result } = await scanWith(async () => json({ content: [{ type: "text", text: '{"name":"Milk","date":"2026-11-20","kind":"misc"}' }], usage: {} }, 200));
  assert.equal(result.name, "Milk");
  assert.equal(result.fail, undefined);
});

// ---- App (demo and live): the row says why ----
for (const folder of ["demo", "live"]) {
  const P = require(path.join(__dirname, "..", folder, "js", "photos.js"));
  const FT = require(path.join(__dirname, "..", folder, "js", "logic.js"));

  test(`${folder}: failText words for each code`, () => {
    assert.equal(P.failText("key"), "Couldn't read photo: Claude key not working");
    assert.equal(P.failText("credit"), "Couldn't read photo: Claude credit ran out");
    assert.equal(P.failText("busy"), "Couldn't read photo: AI busy, try again");
    assert.equal(P.failText("network"), "Couldn't read photo: no connection to AI");
    assert.equal(P.failText("error 400"), "Couldn't read photo (error 400)");
    assert.equal(P.failText(undefined), null);
  });

  test(`${folder}: toQuickFill passes the reason; normal rows have none`, () => {
    const [bad, good] = P.toQuickFill([
      { id: "a", name: null, date: null, needsCheck: true, fail: "key" },
      { id: "b", name: "Milk", date: "2026-11-20", kind: "misc", needsCheck: false },
    ]);
    assert.equal(bad.fail, "Couldn't read photo: Claude key not working");
    assert.equal("fail" in good, false);
  });

  test(`${folder}: quickFillRow shows the reason instead of "Needs a name"`, () => {
    const r = FT.quickFillRow({ name: "", fail: "Couldn't read photo: Claude key not working", check: true });
    assert.equal(r.ok, false);
    assert.equal(r.problem, "Couldn't read photo: Claude key not working");
    const plain = FT.quickFillRow({ name: "" });
    assert.equal(plain.problem, "Needs a name");
  });
}
