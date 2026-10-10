// Household tests (V2 step 3): v2/js/household.js against the Firestore emulator with the real rules.
//   npm run check:rules
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const F = require("firebase/firestore");

let env, H;
const DAY = 24 * 3600 * 1000;
const alice = { uid: "alice", displayName: "Alice" };
const bob = { uid: "bob", displayName: "Bob" };
const eve = { uid: "eve", displayName: "Eve" };
const as = u => env.authenticatedContext(u.uid).firestore();

test.before(async () => {
  H = await import(path.join(__dirname, "..", "v2", "js", "household.js"));
  env = await initializeTestEnvironment({
    projectId: "demo-food-tracker",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
});
test.after(async () => env && env.cleanup());
test.beforeEach(async () => env.clearFirestore());

// ---------- pure helpers ----------

test("makeCode gives 8 easy-to-read characters (no 0/O, 1/I/L)", () => {
  for (let i = 0; i < 200; i++) {
    const c = H.makeCode();
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  }
  assert.notEqual(H.makeCode(), H.makeCode());
});

test("normaliseCode tidies what people type", () => {
  assert.equal(H.normaliseCode(" abcd-2345 "), "ABCD2345");
  assert.equal(H.normaliseCode("abcd 2345"), "ABCD2345");
});

test("inviteLink puts the code in the app link", () => {
  assert.equal(H.inviteLink("ABCD2345", "https://df-ai-lab.github.io/Food-Tracker/v2/"),
    "https://df-ai-lab.github.io/Food-Tracker/v2/?join=ABCD2345");
});

test("codeFromUrl reads ?join= from a link", () => {
  assert.equal(H.codeFromUrl("https://x/v2/?join=abcd2345"), "ABCD2345");
  assert.equal(H.codeFromUrl("https://x/v2/"), null);
});

// ---------- with the emulator ----------

test("new user has no household", async () => {
  assert.equal(await H.myHousehold(F, as(alice), alice.uid), null);
});

test("create a household: you are its only member", async () => {
  const id = await H.createHousehold(F, as(alice), alice, "Home");
  assert.ok(id);
  const h = await H.myHousehold(F, as(alice), alice.uid);
  assert.equal(h.id, id);
  assert.equal(h.name, "Home");
  assert.deepEqual(h.members, [{ uid: "alice", name: "Alice" }]);
});

test("invite → join: both see the same household", async () => {
  const id = await H.createHousehold(F, as(alice), alice, "Home");
  const inv = await H.createInvite(F, as(alice), id);
  assert.match(inv.code, /^[A-Z2-9]{8}$/);
  assert.ok(inv.expires > Date.now() + DAY - 60000, "lasts about 24 hours");

  const joined = await H.joinHousehold(F, as(bob), bob, inv.code.toLowerCase());
  assert.equal(joined, id);
  const h = await H.myHousehold(F, as(bob), bob.uid);
  assert.equal(h.id, id);
  assert.deepEqual(h.members.map(m => m.name).sort(), ["Alice", "Bob"]);
});

test("join with a wrong code gives a clear message", async () => {
  await H.createHousehold(F, as(alice), alice, "Home");
  await assert.rejects(H.joinHousehold(F, as(bob), bob, "NOPE2345"), /code is wrong or has run out/i);
  assert.equal(await H.myHousehold(F, as(bob), bob.uid), null);
});

test("join with an expired code gives the same message", async () => {
  const id = await H.createHousehold(F, as(alice), alice, "Home");
  const inv = await H.createInvite(F, as(alice), id, Date.now() - 2 * DAY);
  await assert.rejects(H.joinHousehold(F, as(bob), bob, inv.code), /code is wrong or has run out/i);
});

test("remove a member: they lose the household", async () => {
  const id = await H.createHousehold(F, as(alice), alice, "Home");
  const inv = await H.createInvite(F, as(alice), id);
  await H.joinHousehold(F, as(bob), bob, inv.code);
  await H.removeMember(F, as(alice), id, "bob");

  const h = await H.myHousehold(F, as(alice), alice.uid);
  assert.deepEqual(h.members, [{ uid: "alice", name: "Alice" }]);
  assert.equal(await H.myHousehold(F, as(bob), bob.uid), null, "bob is out");
});

test("a stranger cannot get in without a code", async () => {
  const id = await H.createHousehold(F, as(alice), alice, "Home");
  await assert.rejects(H.removeMember(F, as(eve), id, "alice"));
  assert.equal(await H.myHousehold(F, as(eve), eve.uid), null);
});

test("user with no name is shown by a fallback", async () => {
  await H.createHousehold(F, as({ uid: "x" }), { uid: "x", displayName: null }, "Home");
  const h = await H.myHousehold(F, as({ uid: "x" }), "x");
  assert.equal(h.members[0].name, "Someone");
});
