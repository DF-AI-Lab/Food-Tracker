// V2 step 9: backups (pure logic in v2/js/logic.js) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const FT = require(path.join(__dirname, "..", "v2", "js", "logic.js"));

const data = {
  packs: [{ id: "p1", name: "Chicken", kind: "main", status: "in_fridge" }],
  shop: [{ id: "s1", name: "Milk", got: false, del: null }],
  meals: [{ id: "m1", day: "2026-10-10", items: [], takeaway: true, cost: 20 }],
  sheets: [{ id: "x1", code: "1110-1059", printed: "2026-10-11T10:59", rows: [] }],
  ratings: [{ name: "Chicken", rating: 1 }],
};

// ---------- the file ----------

test("backup file: dated name, and everything in it", () => {
  const f = FT.backupFile(data, "2026-10-11", "2026-10-11T18:05:00Z");
  assert.equal(f.name, "food-backup-2026-10-11.json");
  const back = JSON.parse(f.text);
  assert.equal(back.app, "food-tracker-v2");
  assert.equal(back.made, "2026-10-11T18:05:00Z");
  for (const k of ["packs", "shop", "meals", "sheets", "ratings"]) assert.deepEqual(back[k], data[k]);
});

test("read backup: a good file comes back whole", () => {
  const r = FT.readBackup(FT.backupFile(data, "2026-10-11", "2026-10-11T18:05:00Z").text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.packs, data.packs);
  assert.equal(r.data.made, "2026-10-11T18:05:00Z");
});

test("read backup: not JSON, or not ours, is refused with a reason", () => {
  for (const text of ["", "hello", "{}", JSON.stringify({ app: "other", packs: [] }), JSON.stringify({ app: "food-tracker-v2", packs: "x" })]) {
    const r = FT.readBackup(text);
    assert.equal(r.ok, false, text);
    assert.equal(r.reason, "This isn't a Food Tracker backup file.");
  }
});

test("read backup: a missing list counts as empty", () => {
  const r = FT.readBackup(JSON.stringify({ app: "food-tracker-v2", made: "x", packs: [] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.shop, []);
  assert.deepEqual(r.data.ratings, []);
});

// ---------- restore ----------

test("restore plan: put back every saved item, remove what wasn't in the backup", () => {
  const now = {
    packs: [{ id: "p1", name: "Chicken", status: "used" }, { id: "p2", name: "New" }],
    shop: [], meals: [{ id: "m1" }, { id: "m9" }], sheets: [], ratings: [],
  };
  const plan = FT.restorePlan(now, data);
  assert.deepEqual(plan.packs.put, data.packs);
  assert.deepEqual(plan.packs.remove, ["p2"]);
  assert.deepEqual(plan.shop.put, data.shop);
  assert.deepEqual(plan.shop.remove, []);
  assert.deepEqual(plan.meals.remove, ["m9"]);
  assert.deepEqual(plan.ratings.put, data.ratings);
  assert.deepEqual(Object.keys(plan).sort(), ["mealPlans", "meals", "packs", "ratings", "recipes", "sheets", "shop"]); // V3: meals (recipes) + meal plans backed up too
});

// ---------- the "back up now?" reminder ----------

const at = n => ({ by: "a", verb: "added", name: "X", at: n });

test("changes since the last backup: from both phones", () => {
  const entries = [at(100), at(200), { ...at(300), by: "b" }];
  assert.equal(FT.changesSinceBackup(entries, 150), 2);
  assert.equal(FT.changesSinceBackup(entries, null), 3, "never backed up: all count");
  assert.equal(FT.changesSinceBackup([], 0), 0);
});

test("reminder: asks at 5 changes", () => {
  assert.equal(FT.BACKUP_EVERY, 5);
  assert.equal(FT.backupDue(4, null, 100), false);
  assert.equal(FT.backupDue(5, null, 100), true);
  assert.equal(FT.backupDue(12, null, 100), true);
});

test("reminder: 'No' asks again after 5 more changes", () => {
  const snooze = { lastBackup: 100, count: 6 };
  assert.equal(FT.backupDue(6, snooze, 100), false);
  assert.equal(FT.backupDue(10, snooze, 100), false);
  assert.equal(FT.backupDue(11, snooze, 100), true);
});

test("reminder: a 'No' from before the last backup is forgotten", () => {
  const old = { lastBackup: 100, count: 9 };
  assert.equal(FT.backupDue(5, old, 500), true, "backed up since: back to every 5");
  assert.equal(FT.backupDue(5, old, null), true);
});

test("last backup line for Settings", () => {
  assert.equal(FT.lastBackupLabel(null), "Never backed up");
  const ms = new Date(2026, 9, 11, 18, 5).getTime(); // local time, like the phone
  assert.equal(FT.lastBackupLabel(ms), "Last backup: Sun 11 Oct, 18:05");
  assert.equal(FT.lastBackupLabel(new Date(2026, 9, 11, 9, 7).getTime()), "Last backup: Sun 11 Oct, 09:07");
});

// ---------- the backup time is kept in the 🔔 activity list (shared by both phones) ----------

test("last backup = the newest 'backed up' entry", () => {
  const entries = [at(100), { by: "b", verb: "backed up", name: "", at: 200 }, { by: "a", verb: "backed up", name: "", at: 150 }, at(300)];
  assert.equal(FT.lastBackupFrom(entries), 200);
  assert.equal(FT.lastBackupFrom([at(100)]), null);
  assert.equal(FT.lastBackupFrom([]), null);
});

test("a backup is not itself a change to back up", () => {
  const entries = [{ by: "a", verb: "backed up", name: "", at: 205 }, at(300)];
  assert.equal(FT.changesSinceBackup(entries, 200), 1);
});

test("bell: 'Alice backed up', never merged", () => {
  const feed = FT.activityFeed([
    { by: "alice", verb: "backed up", name: "", at: 100 },
    { by: "alice", verb: "backed up", name: "", at: 110 },
  ], "me");
  assert.equal(feed.length, 2);
  assert.equal(FT.activityText(feed[0], "Alice"), "Alice backed up");
});
