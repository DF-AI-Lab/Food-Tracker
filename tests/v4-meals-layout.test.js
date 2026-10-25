// Meals page layout (Darren 2026-10-25): Ideas for the week (each idea with the app's best day),
// Other day (the days its foods are still in date), and Move day (swap two days' plans).
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

test("weekIdeas: the week plan's ideas, each with its day, in day order", () => {
  const w = FT.weekIdeas(fridge, pairs, T);
  assert.deepEqual(w.map(r => [r.day, r.idea.key]), [
    ["2026-10-25", "chicken"], ["2026-10-26", "gammon"], ["2026-10-27", "sausages"], ["2026-10-28", "fish"]
  ]);
});

test("weekIdeas: planned days are left out; swaps (Not this day) move an idea on", () => {
  const w = FT.weekIdeas(fridge, pairs, T, { skipDays: ["2026-10-25"] });
  assert.equal(w[0].day, "2026-10-26");
  assert.equal(w[0].idea.key, "gammon");
  assert.ok(!w.some(r => r.day === "2026-10-25"));
  const w2 = FT.weekIdeas(fridge, pairs, T, { swaps: { "2026-10-26": ["gammon"] } });
  assert.equal(w2[1].day, "2026-10-26");
  assert.equal(w2[1].idea.key, "sausages");
  assert.ok(w2.some(r => r.idea.key === "gammon" && r.day > "2026-10-26"), "gammon comes on a later day");
});

test("ideaDays: only the given days on which every food is still in date", () => {
  const days = FT.mealDays(T);
  const gammon = FT.weekIdeas(fridge, pairs, T)[1].idea; // Gammon (30th) + Mash (28th)
  assert.deepEqual(FT.ideaDays(gammon, days), ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]);
  assert.deepEqual(FT.ideaDays(gammon, ["2026-10-26", "2026-10-29"]), ["2026-10-26"]);
  const undated = { main: pack(9, "Beans", "main", null), sides: [] };
  assert.deepEqual(FT.ideaDays(undated, days), days);
});

test("moveDayPlan: swaps one sitting's foods and meal plans between two days", () => {
  const packs = [
    pack(1, "Chicken", "main", "2026-11-05", { plannedFor: "2026-10-26", slot: "main", mealTime: "tea" }),
    pack(2, "Rice", "side", null, { plannedFor: "2026-10-26", slot: "side" }), // no mealTime = tea
    pack(3, "Fish", "main", "2026-11-05", { plannedFor: "2026-10-28", slot: "main", mealTime: "tea", mealPlanId: 7 }),
    pack(4, "Soup", "main", null, { plannedFor: "2026-10-26", slot: "main", mealTime: "dinner" }),
    pack(5, "Peas", "veg", null)
  ];
  const plans = [{ id: 7, day: "2026-10-28", mealId: 1, skip: [] }, { id: 8, day: "2026-10-26", mealId: 2, mealTime: "dinner", skip: [] }];
  const r = FT.moveDayPlan(packs, plans, "2026-10-26", "2026-10-28", "tea");
  const byId = Object.fromEntries(r.packs.map(p => [p.id, p]));
  assert.deepEqual(Object.keys(byId).map(Number).sort(), [1, 2, 3], "only the moved packs come back");
  assert.equal(byId[1].plannedFor, "2026-10-28");
  assert.equal(byId[2].plannedFor, "2026-10-28");
  assert.equal(byId[3].plannedFor, "2026-10-26");
  assert.deepEqual(r.plans, [{ id: 7, day: "2026-10-26", mealId: 1, skip: [] }], "the tea plan moves, dinner stays");
  // Moving to an empty day just moves
  const r2 = FT.moveDayPlan(packs, plans, "2026-10-26", "2026-10-30", "tea");
  assert.deepEqual(r2.packs.map(p => [p.id, p.plannedFor]), [[1, "2026-10-30"], [2, "2026-10-30"]]);
  assert.deepEqual(r2.plans, []);
});

test("moveDayPlan does not change the packs or plans passed in", () => {
  const packs = [pack(1, "Chicken", "main", null, { plannedFor: "2026-10-26", slot: "main" })];
  FT.moveDayPlan(packs, [], "2026-10-26", "2026-10-27", "tea");
  assert.equal(packs[0].plannedFor, "2026-10-26");
});
