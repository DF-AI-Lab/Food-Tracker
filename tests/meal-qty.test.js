// A meal's fresh food can need 2 or 3 packs (Darren 2026-10-17, mock docs/mockups/meal-qty-mock.html).
// Live (live/) and the V4 demo (demo/). — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const day = "2026-10-20", today = "2026-10-17";
const pack = (id, name, extra = {}) => ({ id, name, kind: "main", status: "in_fridge", date: "2026-10-25", added: "2026-10-15", ...extra });

for (const dir of ["live", "demo"]) {
  const FT = require(`../${dir}/js/logic.js`);
  const meal = { id: "m1", name: "Fajitas", fresh: [{ name: "Whole Chicken", qty: 2 }, { name: "Peppers" }], other: [] };

  test(`${dir}: fresh foods keep their amount (1–3, default 1)`, () => {
    const m = FT.normMeal({ name: "X", fresh: [{ name: "A", qty: 2 }, { name: "B" }, { name: "C", qty: 9 }, { name: "D", qty: "x" }] });
    assert.deepEqual(m.fresh.map(f => f.qty), [2, 1, 3, 1]);
    const made = FT.makeMeal({ name: "Fajitas", fresh: [{ name: "whole chicken", qty: 2 }] }, []);
    assert.equal(made.meal.fresh[0].qty, 2);
  });

  test(`${dir}: planning a ×2 food takes 2 packs when there are 2`, () => {
    const packs = [pack(1, "Whole Chicken"), pack(2, "Whole Chicken"), pack(3, "Peppers", { kind: "veg" })];
    const planned = FT.planMeal(meal, packs, day, "p1");
    assert.deepEqual(planned.map(p => p.id).sort(), [1, 2, 3]);
  });

  test(`${dir}: only 1 of 2: the view says have 1, need 1 more, and it is missing (once)`, () => {
    const plan = { id: "p1", day, mealId: "m1", skip: [] };
    const packs = [pack(1, "Whole Chicken", { plannedFor: day, mealPlanId: "p1" }), pack(3, "Peppers", { kind: "veg", plannedFor: day, mealPlanId: "p1" })];
    const v = FT.mealPlanView(plan, meal, packs);
    const ch = v.foods.find(f => f.name === "Whole Chicken");
    assert.equal(ch.qty, 2);
    assert.equal(ch.have, 1);
    assert.equal(ch.need, 1);
    assert.equal(ch.pack.id, 1);
    assert.deepEqual(v.missing, ["Whole Chicken"]);
    assert.equal(v.warn, true);
  });

  test(`${dir}: a second pack bought later joins the plan; an extra one is let go`, () => {
    const plan = { id: "p1", day, mealId: "m1", skip: [] };
    const packs = [pack(1, "Whole Chicken", { plannedFor: day, mealPlanId: "p1" }), pack(2, "Whole Chicken")];
    const out = FT.syncMealPlan(plan, meal, packs, today);
    assert.deepEqual(out.plan.filter(p => p.name === "Whole Chicken").map(p => p.id), [2]);
    const three = [1, 2, 4].map(id => pack(id, "Whole Chicken", { plannedFor: day, mealPlanId: "p1" }));
    assert.equal(FT.syncMealPlan(plan, meal, three, today).unplan.length, 1);
  });

  test(`${dir}: My meals: only 1 of 2 in the fridge -> needs Whole Chicken (listed once)`, () => {
    const st = FT.mealStatus(meal, [], [pack(1, "Whole Chicken"), pack(3, "Peppers", { kind: "veg" })], today);
    assert.deepEqual(st.need, ["Whole Chicken"]);
  });
}
