// Cloud data layer tests (V2 step 4): v2/js/db-firestore.js against the Firestore emulator
// with the real rules. Same DB shape as V1 (all / get / add / put / remove per list).
//   npm run check:rules
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const F = require("firebase/firestore");

let env, makeCloudDB;
const H = "home1";
const as = uid => env.authenticatedContext(uid).firestore();
const wait = ms => new Promise(r => setTimeout(r, ms));
// Retry an assertion for up to 5s (the other phone sees changes a moment later)
async function until(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= 50) throw e; await wait(100); }
  }
}

test.before(async () => {
  ({ makeCloudDB } = await import(path.join(__dirname, "..", "v2", "js", "db-firestore.js")));
  env = await initializeTestEnvironment({
    projectId: "demo-food-tracker",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
});
test.after(async () => env && env.cleanup());

// alice and bob share home1; eve is a stranger
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    await F.setDoc(F.doc(ctx.firestore(), "households", H),
      { name: "Home", members: ["alice", "bob"], names: { alice: "Alice", bob: "Bob" } });
  });
});

async function openAs(uid) {
  const DB = makeCloudDB(F, as(uid), H, uid);
  await DB.open();
  return DB;
}

test("DB has the same shape as V1, plus onChange", async () => {
  const DB = await openAs("alice");
  assert.equal(typeof DB.open, "function");
  for (const s of [DB, DB.shop, DB.meals, DB.sheets]) {
    for (const fn of ["all", "get", "add", "put", "remove"]) assert.equal(typeof s[fn], "function");
  }
  assert.equal(typeof DB.ratings.all, "function");
  assert.equal(typeof DB.ratings.put, "function");
  assert.equal(typeof DB.onChange, "function");
  DB.close();
});

test("starts empty; add / get / put / remove work and stamp who and when", async () => {
  const DB = await openAs("alice");
  assert.deepEqual(await DB.all(), []);

  const id = await DB.add({ name: "Chicken", kind: "main", status: "in_fridge", date: "2026-10-14" });
  assert.equal(typeof id, "string");
  const got = await DB.get(id);
  assert.equal(got.id, id);
  assert.equal(got.name, "Chicken");
  assert.equal(got.updatedBy, "alice");
  assert.equal(typeof got.updatedAt, "number", "updatedAt is a plain number (ms)");
  assert.equal((await DB.all()).length, 1);

  await DB.put({ ...got, status: "used", left: "2026-10-12" });
  assert.equal((await DB.get(id)).status, "used");
  assert.equal((await DB.all()).length, 1);

  await DB.remove(id);
  assert.deepEqual(await DB.all(), []);
  assert.equal(await DB.get(id), undefined);
  DB.close();
});

test("writes really reach the cloud (a fresh read sees them)", async () => {
  const DB = await openAs("alice");
  const id = await DB.add({ name: "Milk", status: "in_fridge" });
  await until(async () => {
    const snap = await F.getDoc(F.doc(as("alice"), "households", H, "packs", id));
    assert.ok(snap.exists());
    assert.equal(snap.data().name, "Milk");
    assert.equal(snap.data().updatedBy, "alice");
    assert.ok(!("id" in snap.data()), "id is the doc name, not a field");
  });
  DB.close();
});

test("returned items are copies", async () => {
  const DB = await openAs("alice");
  const id = await DB.add({ name: "Milk" });
  const got = await DB.get(id);
  got.name = "changed";
  assert.equal((await DB.get(id)).name, "Milk");
  DB.close();
});

test("lists are separate", async () => {
  const DB = await openAs("alice");
  await DB.add({ name: "Milk" });
  await DB.shop.add({ name: "Bread" });
  await DB.meals.add({ day: "2026-10-10" });
  await DB.sheets.add({ code: "A1", rows: [] });
  assert.equal((await DB.all()).length, 1);
  assert.equal((await DB.shop.all()).length, 1);
  assert.equal((await DB.meals.all()).length, 1);
  assert.equal((await DB.sheets.all()).length, 1);
  DB.close();
});

test("ratings are keyed by name (even names with a slash)", async () => {
  const DB = await openAs("alice");
  await DB.ratings.put({ name: "Fish/chips", rating: 1 });
  await DB.ratings.put({ name: "Fish/chips", rating: -1 });
  const all = await DB.ratings.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].name, "Fish/chips");
  assert.equal(all[0].rating, -1);
  DB.close();
});

test("adding a pack keeps the foods memory up to date", async () => {
  const DB = await openAs("alice");
  await DB.add({ name: "Chicken", kind: "main", status: "in_fridge" });
  await DB.add({ name: "chicken", kind: "main", status: "in_fridge" });
  await DB.shop.add({ name: "Chicken" }); // shop items do not count
  await until(async () => {
    const snaps = await F.getDocs(F.collection(as("alice"), "households", H, "foods"));
    assert.equal(snaps.size, 1, "one entry per food, ignoring case");
    const f = snaps.docs[0].data();
    assert.equal(f.timesAdded, 2);
    assert.equal(f.kind, "main");
  });
  DB.close();
});

test("the other phone sees changes live, through onChange", async () => {
  const A = await openAs("alice");
  const B = await openAs("bob");
  let calls = 0;
  B.onChange(() => { calls++; });

  const id = await A.add({ name: "Eggs", status: "in_fridge" });
  await until(async () => {
    assert.ok(calls >= 1, "bob was told");
    assert.equal((await B.get(id))?.name, "Eggs");
  });

  await A.put({ ...(await A.get(id)), status: "used" });
  await until(async () => assert.equal((await B.get(id)).status, "used"));

  await A.remove(id);
  await until(async () => assert.equal(await B.get(id), undefined));
  A.close(); B.close();
});

test("your own changes do not call onChange (no flicker)", async () => {
  const A = await openAs("alice");
  let calls = 0;
  A.onChange(() => { calls++; });
  const id = await A.add({ name: "Ham" });
  await A.put({ ...(await A.get(id)), name: "Ham slices" });
  await A.remove(id);
  await wait(1500);
  assert.equal(calls, 0);
  A.close();
});

test("a stranger cannot open the household", async () => {
  const DB = makeCloudDB(F, as("eve"), H, "eve");
  await assert.rejects(DB.open());
  DB.close();
});
