// V2 step 7c: 🔔 what the other person did (pure logic in v2/js/logic.js) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const FT = require(path.join(__dirname, "..", "v2", "js", "logic.js"));

const pack = (extra = {}) => ({ id: "p1", name: "Chicken", kind: "main", status: "in_fridge", partUsed: false, ...extra });
const ch = (list, before, after) => FT.activityChange(list, before, after);

// ---------- which changes are news ----------

test("packs: added (fridge or freezer)", () => {
  assert.deepEqual(ch("packs", null, pack()), { verb: "added", name: "Chicken" });
  assert.deepEqual(ch("packs", undefined, pack({ status: "frozen" })), { verb: "added", name: "Chicken" });
});

test("packs: used, used some of, threw away", () => {
  assert.deepEqual(ch("packs", pack(), pack({ status: "used" })), { verb: "used", name: "Chicken" });
  assert.deepEqual(ch("packs", pack(), pack({ partUsed: true })), { verb: "used some of", name: "Chicken" });
  assert.deepEqual(ch("packs", pack(), pack({ status: "thrown_away" })), { verb: "threw away", name: "Chicken" });
});

test("packs: froze, defrosted, put back", () => {
  assert.deepEqual(ch("packs", pack(), pack({ status: "frozen" })), { verb: "froze", name: "Chicken" });
  assert.deepEqual(ch("packs", pack({ status: "frozen" }), pack()), { verb: "defrosted", name: "Chicken" });
  assert.deepEqual(ch("packs", pack({ status: "used" }), pack()), { verb: "put back", name: "Chicken" });
  assert.deepEqual(ch("packs", pack({ status: "thrown_away" }), pack()), { verb: "put back", name: "Chicken" });
});

test("packs: not news — delete (a mistake), edits, planning, takeaway plans", () => {
  assert.equal(ch("packs", pack(), pack({ status: "deleted" })), null);
  assert.equal(ch("packs", pack({ status: "deleted" }), pack()), null, "undo of a delete");
  assert.equal(ch("packs", pack(), pack({ name: "Turkey", date: "2026-10-20" })), null);
  assert.equal(ch("packs", pack(), pack({ plannedFor: "2026-10-12", slot: "main" })), null);
  assert.equal(ch("packs", null, { id: "t", name: "Takeaway", kind: "takeaway", status: "plan" }), null);
  assert.equal(ch("packs", pack({ partUsed: true }), pack({ partUsed: true })), null);
});

test("shop: added by hand is news; automatic adds and ticks are not", () => {
  const item = { id: "s1", name: "Milk", got: false, del: null, auto: null };
  assert.deepEqual(ch("shop", null, item), { verb: "added to the shopping list", name: "Milk" });
  assert.equal(ch("shop", null, { ...item, auto: "used" }), null);
  assert.equal(ch("shop", item, { ...item, got: true }), null);
});

test("meals: a meal had, or a takeaway", () => {
  const meal = { day: "2026-10-11", items: [{ name: "Mince", slot: "main" }, { name: "Leeks", slot: "veg" }], takeaway: false, cost: null };
  assert.deepEqual(ch("meals", null, meal), { verb: "had", name: "Mince and Leeks" });
  assert.deepEqual(ch("meals", null, { ...meal, items: [], takeaway: true, cost: 20 }), { verb: "had a takeaway", name: "" });
  assert.equal(ch("meals", meal, { ...meal, cost: 5 }), null, "changing a saved meal is not news");
});

test("other lists are never news", () => {
  assert.equal(ch("sheets", null, { id: "x", code: "1110-1800" }), null);
  assert.equal(ch("ratings", null, { name: "Mince", rating: 1 }), null);
});

// ---------- the 🔔 list ----------

const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 9, 11, 18, 0);
const e = (by, verb, name, minsAgo) => ({ by, verb, name, at: NOW - minsAgo * MIN });

test("feed: only other people's changes, newest first", () => {
  const feed = FT.activityFeed([
    e("sarah", "added", "Milk", 30),
    e("me", "used", "Ham", 20),
    e("sarah", "threw away", "Bread", 5),
  ], "me");
  assert.deepEqual(feed.map(g => g.names[0]), ["Bread", "Milk"]);
  assert.deepEqual(FT.activityFeed([], "me"), []);
});

test("feed: same person, same thing, within 10 min -> one line", () => {
  const feed = FT.activityFeed([
    e("sarah", "used", "Mince", 3),
    e("sarah", "used", "Sausages", 2),
    e("sarah", "used", "Leeks", 1),
    e("sarah", "used", "Ham", 40), // too long before
  ], "me");
  assert.equal(feed.length, 2);
  assert.deepEqual(feed[0], { by: "sarah", verb: "used", names: ["Leeks", "Sausages", "Mince"], at: NOW - 1 * MIN });
  assert.deepEqual(feed[1].names, ["Ham"]);
});

test("feed: different things or people are not merged", () => {
  const feed = FT.activityFeed([
    e("sarah", "used", "Mince", 3),
    e("sarah", "added", "Milk", 2),
    e("tom", "added", "Eggs", 1),
  ], "me");
  assert.equal(feed.length, 3);
});

test("feed: meals are never merged", () => {
  const feed = FT.activityFeed([e("sarah", "had", "Mince", 3), e("sarah", "had", "Pie", 2)], "me");
  assert.equal(feed.length, 2);
});

test("line text: name, what they did, list joined with 'and'", () => {
  const g = (verb, names) => ({ by: "sarah", verb, names, at: NOW });
  assert.equal(FT.activityText(g("added", ["Chicken"]), "Sarah"), "Sarah added Chicken");
  assert.equal(FT.activityText(g("used", ["Leeks", "Sausages", "Mince"]), "Sarah"), "Sarah used Leeks, Sausages and Mince");
  assert.equal(FT.activityText(g("added to the shopping list", ["Milk"]), "Sarah"), "Sarah added Milk to the shopping list");
  assert.equal(FT.activityText(g("had", ["Mince and Leeks"]), "Sarah"), "Sarah had Mince and Leeks");
  assert.equal(FT.activityText(g("had a takeaway", [""]), "Sarah"), "Sarah had a takeaway");
  assert.equal(FT.activityText(g("used some of", ["Milk"]), "Sarah"), "Sarah used some of Milk");
  assert.equal(FT.activityText(g("added", ["Milk"]), ""), "Someone added Milk", "no name known");
});

test("time ago", () => {
  assert.equal(FT.timeAgo(NOW - 20 * 1000, NOW), "just now");
  assert.equal(FT.timeAgo(NOW - 5 * MIN, NOW), "5 min ago");
  assert.equal(FT.timeAgo(NOW - 59 * MIN, NOW), "59 min ago");
  assert.equal(FT.timeAgo(NOW - 2 * 60 * MIN, NOW), "2 h ago");
  assert.equal(FT.timeAgo(NOW - 26 * 60 * MIN, NOW), "yesterday");
  assert.equal(FT.timeAgo(NOW - 3 * 24 * 60 * MIN, NOW), "3 days ago");
});

test("unread count: lines from others newer than 'seen up to'", () => {
  const entries = [
    e("sarah", "used", "Mince", 3),
    e("sarah", "used", "Leeks", 2),   // same line as Mince
    e("me", "added", "Milk", 1),      // mine: never counted
    e("sarah", "added", "Eggs", 60),  // seen already
  ];
  assert.equal(FT.unreadCount(entries, "me", NOW - 30 * MIN), 1);
  assert.equal(FT.unreadCount(entries, "me", NOW), 0);
  assert.equal(FT.unreadCount(entries, "me", 0), 2);
});
