// V4 demo: dinner (midday, optional) and tea (evening) on the same day (#144) — run with: npm test
// Planned packs and meal plans carry mealTime: "dinner"; anything without it is tea (so old data is tea).
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const day = "2026-10-20";
const pack = (id, name, extra = {}) => ({ id, name, kind: "main", status: "in_fridge", date: "2026-10-25", added: "2026-10-15", ...extra });

test("mealTimeOf: dinner only when marked, else tea (old data is tea)", () => {
  assert.equal(FT.mealTimeOf({ mealTime: "dinner" }), "dinner");
  assert.equal(FT.mealTimeOf({ mealTime: "tea" }), "tea");
  assert.equal(FT.mealTimeOf({}), "tea");
  assert.equal(FT.mealTimeOf(null), "tea");
});

test("sitKey / sitOf: tea keeps the plain day, dinner gets its own key", () => {
  assert.equal(FT.sitKey(day, "tea"), day);
  assert.equal(FT.sitKey(day), day);
  assert.equal(FT.sitKey(day, "dinner"), day + "|dinner");
  assert.deepEqual(FT.sitOf(day), { day, mealTime: "tea" });
  assert.deepEqual(FT.sitOf(day + "|dinner"), { day, mealTime: "dinner" });
});

test("planPack / makeTakeaway / unplanPack carry the meal time", () => {
  assert.equal(FT.planPack(pack(1, "Chicken"), day, "main", "dinner").mealTime, "dinner");
  assert.equal(FT.planPack(pack(1, "Chicken"), day, "main").mealTime, "tea");
  assert.equal(FT.makeTakeaway(day, "dinner").mealTime, "dinner");
  assert.equal(FT.makeTakeaway(day).mealTime, "tea");
  assert.equal(FT.unplanPack({ ...pack(1, "Chicken"), plannedFor: day, mealTime: "dinner" }).mealTime, null);
});

test("dayMeals splits a day by meal time; no meal time given = the whole day", () => {
  const packs = [
    pack(1, "Sausage rolls", { plannedFor: day, slot: "main", mealTime: "dinner" }),
    pack(2, "Chicken", { plannedFor: day, slot: "main" }),
  ];
  assert.deepEqual(FT.dayMeals(packs, day, "dinner").map(p => p.id), [1]);
  assert.deepEqual(FT.dayMeals(packs, day, "tea").map(p => p.id), [2]);
  assert.equal(FT.dayMeals(packs, day).length, 2);
});

test("planMeal and syncMealPlan put the foods in the plan's meal time", () => {
  const meal = { id: "m1", name: "Pie", fresh: [{ name: "Chicken" }] };
  const packs = [pack(1, "Chicken")];
  assert.equal(FT.planMeal(meal, packs, day, "p1", [], "dinner")[0].mealTime, "dinner");
  assert.equal(FT.planMeal(meal, packs, day, "p1")[0].mealTime, "tea");
  const { plan } = FT.syncMealPlan({ id: "p1", day, mealId: "m1", skip: [], mealTime: "dinner" }, meal, packs, "2026-10-16");
  assert.equal(plan[0].mealTime, "dinner");
});

test("dayGroups and partDefaults only show the asked meal time", () => {
  const meals = [{ id: "m1", name: "Pie", fresh: [{ name: "Chicken", some: true }] }, { id: "m2", name: "Bol", fresh: [{ name: "Mince" }] }];
  const plans = [{ id: "p1", day, mealId: "m1", skip: [], mealTime: "dinner" }, { id: "p2", day, mealId: "m2", skip: [] }];
  const packs = [
    pack(1, "Chicken", { plannedFor: day, slot: "main", mealPlanId: "p1", mealTime: "dinner" }),
    pack(2, "Mince", { plannedFor: day, slot: "main", mealPlanId: "p2" }),
    pack(3, "Peas", { kind: "veg", plannedFor: day, slot: "veg", mealTime: "dinner" }),
  ];
  assert.deepEqual(FT.dayGroups(packs, plans, meals, day, "dinner").map(g => g.type === "meal" ? g.plan.id : g.pack.id), ["p1", 3]);
  assert.deepEqual(FT.dayGroups(packs, plans, meals, day, "tea").map(g => g.type === "meal" ? g.plan.id : g.pack.id), ["p2"]);
  assert.equal(FT.dayGroups(packs, plans, meals, day).length, 3);
  assert.deepEqual([...FT.partDefaults(packs, plans, meals, day, "dinner")], [1]);
  assert.deepEqual([...FT.partDefaults(packs, plans, meals, day, "tea")], []);
});

test("hasDinner: a day has dinner once a dinner food or meal is planned", () => {
  assert.equal(FT.hasDinner([], [], day), false);
  assert.equal(FT.hasDinner([pack(1, "Chicken", { plannedFor: day, mealTime: "dinner" })], [], day), true);
  assert.equal(FT.hasDinner([], [{ id: "p1", day, mealId: "m1", mealTime: "dinner" }], day), true);
  assert.equal(FT.hasDinner([pack(1, "Chicken", { plannedFor: day })], [{ id: "p2", day, mealId: "m1" }], day), false);
});

test("mealsToAsk: each meal asked on its own; today's dinner from 2pm, tea from 5pm", () => {
  const today = day;
  const y = "2026-10-19";
  const packs = [
    pack(1, "A", { plannedFor: y, mealTime: "dinner" }),
    pack(2, "B", { plannedFor: y }),
    pack(3, "C", { plannedFor: today, mealTime: "dinner" }),
    pack(4, "D", { plannedFor: today }),
  ];
  const keys = list => list.map(s => FT.sitKey(s.day, s.mealTime));
  assert.equal(FT.DINNER_HOUR, 14);
  assert.deepEqual(keys(FT.mealsToAsk(packs, today, 10)), [y + "|dinner", y]);
  assert.deepEqual(keys(FT.mealsToAsk(packs, today, 14)), [y + "|dinner", y, today + "|dinner"]);
  assert.deepEqual(keys(FT.mealsToAsk(packs, today, 17)), [y + "|dinner", y, today + "|dinner", today]);
  // a dinner already answered (no waiting pack) is not asked again
  assert.deepEqual(keys(FT.mealsToAsk(packs.filter(p => p.id !== 1), today, 10)), [y]);
});

test("mealRecord notes a dinner; tea records look as before", () => {
  assert.equal(FT.mealRecord(day, [], { mealTime: "dinner" }).mealTime, "dinner");
  assert.equal("mealTime" in FT.mealRecord(day, []), false);
});
