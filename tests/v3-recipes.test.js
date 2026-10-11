// V3 meals as recipes (issue #89): pure logic in v2-next/js/logic.js — run with: npm test
// A recipe = a name, fresh foods (checked against the fridge) and other things
// (cupboard bits like "White sauce packet x2", never in the fridge).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const FT = require(path.join(__dirname, "..", "v2-next", "js", "logic.js"));

const TODAY = "2026-10-11";
const day = n => {
  const d = new Date(TODAY + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const pack = (id, name, kind, date, extra = {}) =>
  ({ id, name, kind, date, status: "in_fridge", plannedFor: null, slot: null, added: TODAY, ...extra });

const pie = {
  id: "r1",
  name: "Chicken pie",
  fresh: ["Chicken", "Bacon", "Mushrooms", "Pastry"],
  other: [{ name: "White sauce packet", qty: "x2" }]
};

// ---- makeRecipe: tidy what was typed ----

test("makeRecipe: trims, drops blanks, keeps fresh and other apart", () => {
  const r = FT.makeRecipe({
    name: "  Chicken pie ",
    fresh: [" Chicken", "", "Bacon  ", "   "],
    other: [{ name: " White sauce packet ", qty: " x2 " }, { name: "", qty: "1" }]
  });
  assert.deepEqual(r, {
    name: "Chicken pie",
    fresh: ["Chicken", "Bacon"],
    other: [{ name: "White sauce packet", qty: "x2" }]
  });
});

test("makeRecipe: same fresh food twice (any case) is kept once, first spelling wins", () => {
  const r = FT.makeRecipe({ name: "Pie", fresh: ["Chicken", "chicken", "CHICKEN", "Bacon"], other: [] });
  assert.deepEqual(r.fresh, ["Chicken", "Bacon"]);
});

test("makeRecipe: no amount = null qty", () => {
  const r = FT.makeRecipe({ name: "Pie", fresh: [], other: [{ name: "Gravy", qty: "  " }, { name: "Salt" }] });
  assert.deepEqual(r.other, [{ name: "Gravy", qty: null }, { name: "Salt", qty: null }]);
});

test("makeRecipe: no name, or nothing in it -> null", () => {
  assert.equal(FT.makeRecipe({ name: "  ", fresh: ["Chicken"], other: [] }), null);
  assert.equal(FT.makeRecipe({ name: "Pie", fresh: ["", " "], other: [{ name: " ", qty: "2" }] }), null);
  assert.equal(FT.makeRecipe({ name: "Pie" }), null);
});

test("makeRecipe: keeps the id when editing", () => {
  const r = FT.makeRecipe({ id: "r9", name: "Pie", fresh: ["Chicken"], other: [] });
  assert.equal(r.id, "r9");
});

// ---- recipeCheck: is it all in the fridge for that day? ----

test("recipeCheck: what's there, what's missing, other things listed as they are", () => {
  const packs = [
    pack("p1", "chicken", "main", day(3)),
    pack("p2", "Bacon", "main", day(5)),
    pack("p3", "Mushrooms", "veg", null)
  ];
  const c = FT.recipeCheck(pie, packs, day(1));
  assert.deepEqual(c.have.map(h => [h.name, h.pack.id, h.out]), [
    ["chicken", "p1", 0],   // casing as in the fridge
    ["Bacon", "p2", 0],
    ["Mushrooms", "p3", 0]
  ]);
  assert.deepEqual(c.missing, ["Pastry"]);
  assert.deepEqual(c.other, [{ name: "White sauce packet", qty: "x2" }]);
  assert.equal(c.ready, false);
});

test("recipeCheck: all fresh foods there -> ready (other things don't count)", () => {
  const packs = ["Chicken", "Bacon", "Mushrooms", "Pastry"].map((n, i) => pack("p" + i, n, "main", day(4)));
  assert.equal(FT.recipeCheck(pie, packs, TODAY).ready, true);
});

test("recipeCheck: uses the soonest-dated free pack; undated after dated", () => {
  const packs = [
    pack("a", "Chicken", "main", day(6)),
    pack("b", "Chicken", "main", day(2)),
    pack("c", "Chicken", "main", null),
    pack("d", "Bacon", "main", null),
    pack("e", "Bacon", "main", day(9))
  ];
  const c = FT.recipeCheck({ name: "X", fresh: ["Chicken", "Bacon"], other: [] }, packs, TODAY);
  assert.equal(c.have[0].pack.id, "b");
  assert.equal(c.have[1].pack.id, "e");
});

test("recipeCheck: planned, used, frozen, deleted packs and takeaways don't count", () => {
  const packs = [
    pack("a", "Chicken", "main", day(2), { plannedFor: day(1), slot: "main" }),
    pack("b", "Chicken", "main", day(2), { status: "used" }),
    pack("c", "Chicken", "main", day(2), { status: "frozen" }),
    pack("d", "Chicken", "main", day(2), { status: "deleted" }),
    pack("e", "Chicken", "takeaway", null)
  ];
  const c = FT.recipeCheck({ name: "X", fresh: ["Chicken"], other: [] }, packs, TODAY);
  assert.deepEqual(c.missing, ["Chicken"]);
  assert.deepEqual(c.have, []);
});

test("recipeCheck: planned for 2 days' time, a pack out by then is flagged with days out", () => {
  const packs = [pack("p1", "Chicken", "main", day(0)), pack("p2", "Bacon", "main", day(5))];
  const c = FT.recipeCheck({ name: "X", fresh: ["Chicken", "Bacon"], other: [] }, packs, day(2));
  assert.equal(c.have[0].out, 2);
  assert.equal(c.have[1].out, 0);
  assert.deepEqual(c.outNames, ["Chicken"]);
});

test("recipeCheck: a recipe with no other list still works", () => {
  const c = FT.recipeCheck({ name: "X", fresh: ["Chicken"] }, [], TODAY);
  assert.deepEqual(c.other, []);
  assert.deepEqual(c.missing, ["Chicken"]);
});

// ---- planRecipe: plan what's there for the day ----

test("planRecipe: plans the matched packs for the day, slot from the pack's kind", () => {
  const packs = [
    pack("p1", "Chicken", "main", day(3)),
    pack("p2", "Pastry", "side", day(3)),
    pack("p3", "Mushrooms", "veg", null),
    pack("p4", "Bacon", "misc", day(4))
  ];
  const planned = FT.planRecipe(pie, packs, day(1));
  assert.deepEqual(planned.map(p => [p.id, p.plannedFor, p.slot]), [
    ["p1", day(1), "main"],
    ["p4", day(1), "misc"],   // misc has its own picker tab now
    ["p3", day(1), "veg"],
    ["p2", day(1), "side"]
  ]);
});

test("planRecipe: nothing in the fridge -> nothing planned", () => {
  assert.deepEqual(FT.planRecipe(pie, [], TODAY), []);
});

test("planRecipe: doesn't change the packs it was given", () => {
  const packs = [pack("p1", "Chicken", "main", day(3))];
  FT.planRecipe(pie, packs, TODAY);
  assert.equal(packs[0].plannedFor, null);
});

// ---- recipeShopList: missing names not already on the list ----

test("recipeShopList: skips names already to get (any case), keeps ticked/deleted ones", () => {
  const shop = [
    { id: "s1", name: "pastry", got: false, del: null },
    { id: "s2", name: "Bacon", got: true, del: null },
    { id: "s3", name: "Mushrooms", got: false, del: "2026-10-10" }
  ];
  assert.deepEqual(
    FT.recipeShopList(["Pastry", "Bacon", "Mushrooms", "Chicken", "chicken"], shop),
    ["Bacon", "Mushrooms", "Chicken"]
  );
});

// ---- recipes are kept in backups ----

test("backups include recipes and restore them", () => {
  const data = { packs: [], shop: [], meals: [], sheets: [], ratings: [], recipes: [pie] };
  const back = FT.readBackup(FT.backupFile(data, TODAY, TODAY + "T10:00:00Z").text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.data.recipes, [pie]);
  const plan = FT.restorePlan({ recipes: [{ id: "old" }] }, back.data);
  assert.deepEqual(plan.recipes, { put: [pie], remove: ["old"] });
});

test("old backups with no recipes still read fine", () => {
  const r = FT.readBackup(JSON.stringify({ app: "food-tracker-v2", made: "x", packs: [] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.recipes, []);
});

test("recipe changes are not 🔔 news", () => {
  assert.equal(FT.activityChange("recipes", null, pie), null);
});

// ---- suggestFoods: chips while typing a fresh food, forgiving of spelling slips ----

const saved = [
  pack("s1", "Chicken", "main", day(2)),
  pack("s2", "Chicken tenders", "main", day(2)),
  pack("s3", "Bacon", "main", day(2)),
  pack("s4", "Pork", "main", day(2))
];
const names = list => list.map(x => x.name);

test("suggestFoods: 'chic' brings up the chicken foods, name-starts first", () => {
  const r = names(FT.suggestFoods(saved, "chic"));
  assert.deepEqual(r.slice(0, 2), ["Chicken", "Chicken tenders"]);
});

test("suggestFoods: spelling slips still find it", () => {
  assert.equal(names(FT.suggestFoods(saved, "chiken"))[0], "Chicken");
  assert.ok(names(FT.suggestFoods(saved, "bacn")).includes("Bacon"));
  assert.ok(names(FT.suggestFoods([], "musrooms")).includes("Mushrooms")); // starter food
});

test("suggestFoods: exact matches come before slips", () => {
  const r = names(FT.suggestFoods([pack("a", "Park ham", "main", null), ...saved], "pork"));
  assert.equal(r[0], "Pork");
});

test("suggestFoods: no wild guesses, blank = nothing, short text = no slips", () => {
  assert.equal(names(FT.suggestFoods(saved, "cat")).includes("Chicken"), false);
  assert.deepEqual(FT.suggestFoods(saved, "  "), []);
  assert.deepEqual(names(FT.suggestFoods(saved, "zq")), []);
});

test("suggestFoods: leaves out foods already in the recipe (any case), max 10", () => {
  const r = names(FT.suggestFoods(saved, "chic", ["chicken"]));
  assert.equal(r.includes("Chicken"), false);
  assert.ok(r.includes("Chicken tenders"));
  assert.ok(FT.suggestFoods([], "o").length <= 10);
});

test("suggestFoods: each row has name and kind", () => {
  assert.deepEqual(FT.suggestFoods(saved, "bacon")[0], { name: "Bacon", kind: "main" });
});

// ---- Misc tab in the meal picker (Darren 2026-10-11) ----

test("mealPick misc: misc foods, dated or not, soonest date first then undated by added", () => {
  const packs = [
    pack("m1", "Milk", "misc", day(4)),
    pack("m2", "Eggs", "misc", null, { added: day(-3) }),
    pack("m3", "Butter", "misc", day(1)),
    pack("m4", "Ketchup", "misc", null, { added: day(-1) }),
    pack("m5", "Milk", "misc", day(2)),
    pack("x1", "Chicken", "main", day(1)),
    pack("x2", "Cheese", "misc", day(1), { plannedFor: day(0), slot: "misc" })
  ];
  const rows = FT.mealPick(packs, "misc");
  assert.deepEqual(rows.map(r => [r.name, r.count]), [["Butter", 1], ["Milk", 2], ["Eggs", 1], ["Ketchup", 1]]);
  assert.equal(rows[1].pack.id, "m5"); // soonest Milk
});

test("mealPick: other slots still leave misc out", () => {
  const packs = [pack("m1", "Milk", "misc", day(4)), pack("m2", "Eggs", "misc", null)];
  for (const s of ["main", "side", "veg"]) assert.deepEqual(FT.mealPick(packs, s), []);
});

test("dayMeals: misc comes after main, side and veg", () => {
  const d = day(0);
  const packs = [
    pack("a", "Milk", "misc", day(3), { plannedFor: d, slot: "misc" }),
    pack("b", "Peas", "veg", null, { plannedFor: d, slot: "veg" }),
    pack("c", "Chicken", "main", day(3), { plannedFor: d, slot: "main" })
  ];
  assert.deepEqual(FT.dayMeals(packs, d).map(p => p.slot), ["main", "veg", "misc"]);
});

test("planRecipe: a misc food is planned in the misc slot", () => {
  const planned = FT.planRecipe({ name: "X", fresh: ["Milk"] }, [pack("m", "Milk", "misc", day(2))], TODAY);
  assert.equal(planned[0].slot, "misc");
});
