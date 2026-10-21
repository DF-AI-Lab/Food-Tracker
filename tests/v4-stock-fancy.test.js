// V4 demo: stock check, By date list and Meals I fancy (Darren 2026-10-21) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const pack = (id, name, kind, extra = {}) => ({ id, name, kind, status: "in_fridge", date: null, added: "2026-10-15", ...extra });
const packs = [
  pack(1, "Chicken", "main", { date: "2026-10-25" }),
  pack(2, "Beef", "main", { date: "2026-10-22" }),
  pack(3, "Coleslaw", "side", { date: "2026-10-23", dateType: "best_before" }),
  pack(4, "Carrots", "veg"),
  pack(5, "Yoghurt", "misc", { date: "2026-10-21" }),
  pack(6, "Bread", "cupboard", { date: "2026-10-24" }),
  pack(7, "Peas", "veg", { status: "frozen", frozen: "2026-09-01" }),
  pack(8, "Old ham", "main", { status: "used", date: "2026-10-20" }),
  pack(9, "Milk", "misc", { added: "2026-10-10" }),
];

test("stockSections: 6 sections in order, only what is really there", () => {
  const s = FT.stockSections(packs);
  assert.deepEqual(s.map(x => x.key), ["main", "side", "veg", "misc", "freezer", "cupboard"]);
  assert.deepEqual(s.map(x => x.label), ["Mains", "Sides", "Veg", "Other", "Freezer", "Cupboard"]);
  const ids = key => s.find(x => x.key === key).items.map(p => p.id);
  assert.deepEqual(ids("main"), [2, 1]); // soonest first, used ham left out
  assert.deepEqual(ids("side"), [3]);
  assert.deepEqual(ids("veg"), [4]);   // frozen peas are in Freezer, not Veg
  assert.deepEqual(ids("misc"), [5, 9]); // dated first, then undated
  assert.deepEqual(ids("freezer"), [7]);
  assert.deepEqual(ids("cupboard"), [6]);
});

test("byDateList: fridge foods in one list, soonest first, undated last (oldest added first)", () => {
  const rows = FT.byDateList(packs);
  assert.deepEqual(rows.map(r => r.pack.id), [5, 2, 3, 1, 9, 4]); // no cupboard, freezer or used
  assert.deepEqual(rows.map(r => r.section), ["Other", "Mains", "Sides", "Mains", "Other", "Veg"]);
  assert.equal(rows[0].dateLabel, "UB 21 Oct");
  assert.equal(rows[2].dateLabel, "BB 23 Oct");
  assert.equal(rows[5].dateLabel, "added 15 Oct");
});

test("meals keep their fancy star (missing = not fancied)", () => {
  assert.equal(FT.normMeal({ name: "Curry", fresh: [], fancy: true }).fancy, true);
  assert.equal(FT.normMeal({ name: "Curry", fresh: [] }).fancy, false);
  const made = FT.makeMeal({ name: "Curry", fresh: [{ name: "Chicken" }], fancy: true }, []);
  assert.equal(made.meal.fancy, true);
});

test("fancyMeals: starred meals only, A to Z", () => {
  const meals = [{ id: 1, name: "Tacos", fancy: true }, { id: 2, name: "Pie" }, { id: 3, name: "Curry", fancy: true }];
  assert.deepEqual(FT.fancyMeals(meals).map(m => m.id), [3, 1]);
  assert.deepEqual(FT.fancyMeals([]), []);
});
