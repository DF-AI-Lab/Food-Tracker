// Suggestions look at My meals first, then combos: tonight, a day's top 3 and Plan my week (Darren 2026-10-25)
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const T = "2026-10-25";
const pack = (id, name, kind, date, extra = {}) => ({ id, name, kind, status: "in_fridge", date, added: "2026-10-20", ...extra });
const pair = (a, b) => ({ a, b, source: "hand", hidden: false });
const fridge = [
  pack(1, "Chicken", "main", "2026-10-27"),
  pack(2, "Peppers", "veg", "2026-10-28"),
  pack(3, "Wraps", "cupboard", null),
  pack(4, "Steak", "main", "2026-10-30"),
  pack(5, "Gammon", "main", "2026-10-26"),
  pack(6, "Mash", "side", "2026-10-29")
];
const recipes = [
  { id: 1, name: "Fajitas", fresh: ["Chicken", "Peppers", "Wraps"], other: [] },
  { id: 2, name: "Pie night", fresh: ["Steak", "Pastry"], other: [] } // no pastry: can't make
];
const pairs = [pair("Gammon", "Mash")];

test("savedMealIdeas: saved meals with every fresh food free and in date", () => {
  const m = FT.savedMealIdeas(recipes, fridge, T);
  assert.equal(m.length, 1);
  assert.equal(m[0].key, "meal:1");
  assert.equal(m[0].title, "Fajitas");
  assert.equal(m[0].recipe.id, 1);
  assert.deepEqual([m[0].main, ...m[0].sides].map(p => p.id), [1, 2, 3]);
  assert.deepEqual(m[0].pairs, []);
  assert.deepEqual(m[0].why, { text: "Chicken goes out in 2 days", state: "soon" });
  assert.equal(FT.savedMealIdeas(recipes, fridge, "2026-10-29").length, 0, "peppers out by then");
  assert.equal(FT.savedMealIdeas(recipes, fridge, T, ["meal:1"]).length, 0, "skip key");
  const planned = fridge.map(p => (p.id === 2 ? { ...p, plannedFor: "2026-10-26" } : p));
  assert.equal(FT.savedMealIdeas(recipes, planned, T).length, 0, "planned pack not free");
});

test("savedMealIdeas: qty 2 needs 2 packs", () => {
  const r = [{ id: 3, name: "Big fajitas", fresh: [{ name: "Chicken", qty: 2 }, "Wraps"], other: [] }];
  assert.equal(FT.savedMealIdeas(r, fridge, T).length, 0);
  assert.equal(FT.savedMealIdeas(r, [...fridge, pack(9, "Chicken", "main", "2026-10-28")], T).length, 1);
});

test("dayIdeas: my meals first, then combos (even if a combo goes out sooner)", () => {
  const d = FT.dayIdeas(fridge, pairs, T, [], [], [], recipes);
  assert.deepEqual(d.map(i => i.key), ["meal:1", "gammon"]);
});

test("weekPlan: my meals first; each pack once", () => {
  const w = FT.weekPlan(fridge, pairs, T, { recipes });
  assert.deepEqual(w.slice(0, 3).map(x => x.idea && x.idea.key), ["meal:1", "gammon", null]);
  const ids = w.filter(x => x.idea).flatMap(x => [x.idea.main, ...x.idea.sides].map(p => p.id));
  assert.equal(new Set(ids).size, ids.length);
});
