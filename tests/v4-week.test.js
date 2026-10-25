// Plan my week and a day's top 3: worked out by the app from combos and dates, no AI (Darren 2026-10-25)
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const T = "2026-10-25"; // Sunday
const pack = (id, name, kind, date, extra = {}) => ({ id, name, kind, status: "in_fridge", date, added: "2026-10-20", ...extra });
const pair = (a, b) => ({ a, b, source: "hand", hidden: false });
const fridge = [
  pack(1, "Chicken", "main", "2026-10-25"),
  pack(2, "Rice", "side", "2026-10-26"),
  pack(3, "Gammon", "main", "2026-10-30"),
  pack(4, "Mash", "side", "2026-10-28"),
  pack(5, "Sausages", "main", "2026-10-29"),
  pack(6, "Chips", "side", "2026-10-31"),
  pack(7, "Fish", "main", "2026-11-01"),
  pack(8, "Peas", "veg", null)
];
const pairs = [pair("Chicken", "Rice"), pair("Gammon", "Mash"), pair("Sausages", "Chips"), pair("Fish", "Peas"), pair("Fish", "Chips")];

test("dayIdeas: top 3 for a day, only foods still in date that day", () => {
  const wed = FT.dayIdeas(fridge, pairs, "2026-10-28");
  assert.ok(wed.length <= 3);
  assert.deepEqual(wed.map(i => i.key), ["gammon", "sausages", "fish"]); // chicken and rice are out by Wed
  assert.ok(wed[0].why.text);
  const sun = FT.dayIdeas(fridge, pairs, T);
  assert.equal(sun.length, 3);
  assert.equal(sun[0].key, "chicken");
});

test("dayIdeas: skips planned packs and skip keys", () => {
  const ps = fridge.map(p => (p.id === 3 ? { ...p, plannedFor: "2026-10-26" } : p));
  assert.ok(!FT.dayIdeas(ps, pairs, "2026-10-28").some(i => i.key === "gammon"));
  assert.ok(!FT.dayIdeas(fridge, pairs, "2026-10-28", ["fish"]).some(i => i.key === "fish"));
});

test("weekPlan: 7 days, soonest out first, each pack once, no main twice, in date on its day", () => {
  const w = FT.weekPlan(fridge, pairs, T);
  assert.deepEqual(w.map(x => x.day), ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  assert.deepEqual(w.map(x => x.idea && x.idea.key), ["chicken", "gammon", "sausages", "fish", null, null, null]);
  const ids = w.filter(x => x.idea).flatMap(x => [x.idea.main, ...x.idea.sides].map(p => p.id));
  assert.equal(new Set(ids).size, ids.length, "each pack once");
  assert.deepEqual(w[3].idea.sides.map(p => p.name), ["Peas"], "chips went to sausages");
  for (const x of w.filter(x => x.idea)) for (const p of [x.idea.main, ...x.idea.sides]) assert.ok(!p.date || p.date >= x.day, p.name + " in date on " + x.day);
});

test("weekPlan: days already planned are skipped (kept for later days' food)", () => {
  const w = FT.weekPlan(fridge, pairs, T, { skipDays: ["2026-10-25"] });
  assert.equal(w[0].idea, null);
  assert.equal(w[0].skipped, true);
  assert.equal(w[1].idea.key, "gammon"); // chicken is out by Monday
});

test("weekPlan: swap skips an idea on that day only; it can come later", () => {
  const w = FT.weekPlan(fridge, pairs, T, { swaps: { "2026-10-25": ["chicken"] } });
  assert.equal(w[0].idea.key, "gammon");
  assert.ok(!w.some(x => x.idea && x.idea.key === "chicken"), "chicken is out after Sunday");
  const w2 = FT.weekPlan(fridge, pairs, T, { swaps: { "2026-10-26": ["gammon"] } });
  assert.deepEqual(w2.slice(0, 3).map(x => x.idea.key), ["chicken", "sausages", "gammon"]);
});

test("weekPlan: recent meals still count for no repeats", () => {
  const meals = [{ id: 1, day: "2026-10-24", items: [{ name: "Chicken", slot: "main" }], takeaway: false }];
  const w = FT.weekPlan(fridge, pairs, T, { meals });
  assert.notEqual(w[0].idea.key, "chicken");
});
