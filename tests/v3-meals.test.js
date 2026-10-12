// V3 meals reset (issue #89, agreed 2026-10-12): pure logic in v2-next/js/logic.js — run with: npm test
// A meal = a name, fresh foods (checked against the fridge, each can be "some") and other items
// (cupboard bits). Planning a meal makes a meal plan { id, day, mealId, skip }; the fridge packs it
// uses carry mealPlanId. Food bought later joins the plan by itself (syncMealPlan).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const FT = require(path.join(__dirname, "..", "v2-next", "js", "logic.js"));

const TODAY = "2026-10-12";
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
  fresh: [{ name: "Chicken", some: false }, { name: "Bacon", some: true }, { name: "Mushrooms", some: false }, { name: "Pastry", some: false }],
  other: [{ name: "White sauce packet", qty: "x2" }]
};
const names = list => list.map(x => x.name);

// ---- tidyName: spelling help starts with tidy capitals and spaces ----

test("tidyName: trims, single spaces, capital first letter, rest as typed", () => {
  assert.equal(FT.tidyName("  yorkshire   puddings "), "Yorkshire puddings");
  assert.equal(FT.tidyName("sour Cream"), "Sour Cream");
  assert.equal(FT.tidyName("   "), "");
  assert.equal(FT.tidyName(null), "");
});

// ---- normMeal: old saved recipes (fresh as plain names) still work ----

test("normMeal: plain-name fresh foods become { name, some: false }; missing lists = empty", () => {
  assert.deepEqual(FT.normMeal({ id: "a", name: "Fajitas", fresh: ["Chicken", { name: "Peppers", some: true }] }), {
    id: "a", name: "Fajitas", fresh: [{ name: "Chicken", some: false }, { name: "Peppers", some: true }], other: []
  });
});

// ---- makeMeal: tidy, check, no duplicates ----

test("makeMeal: tidies names, drops blanks, dedupes fresh (any case), keeps some + qty", () => {
  const r = FT.makeMeal({
    name: "  chicken pie ",
    fresh: [{ name: " chicken" }, { name: "" }, { name: "CHICKEN" }, { name: "bacon", some: true }],
    other: [{ name: " white sauce packet ", qty: " x2 " }, { name: " ", qty: "1" }, { name: "salt", qty: "" }]
  }, []);
  assert.deepEqual(r, { meal: {
    name: "Chicken pie",
    fresh: [{ name: "Chicken", some: false }, { name: "Bacon", some: true }],
    other: [{ name: "White sauce packet", qty: "x2" }, { name: "Salt", qty: null }]
  } });
});

test("makeMeal: no name / nothing in it -> a message to show", () => {
  assert.deepEqual(FT.makeMeal({ name: " ", fresh: [{ name: "Chicken" }] }, []), { error: "Give the meal a name." });
  assert.deepEqual(FT.makeMeal({ name: "Pie", fresh: [], other: [] }, []), { error: "Add at least one food." });
});

test("makeMeal: same name as another meal (any case) is refused; editing itself is fine", () => {
  const meals = [{ id: "r1", name: "Fajitas", fresh: [{ name: "Chicken" }] }];
  assert.deepEqual(FT.makeMeal({ name: "fajitas", fresh: [{ name: "Chicken" }] }, meals), { error: "You already have Fajitas." });
  const r = FT.makeMeal({ id: "r1", name: "fajitas", fresh: [{ name: "Chicken" }] }, meals);
  assert.equal(r.meal.id, "r1");
  assert.equal(r.meal.name, "Fajitas");
});

// ---- suggestFoods: everyday foods known even if never bought; spelling slips ----

test("suggestFoods: knows everyday foods never bought, even with slips", () => {
  assert.equal(names(FT.suggestFoods([], "yorkshre pudings"))[0], "Yorkshire puddings");
  assert.ok(names(FT.suggestFoods([], "chik")).includes("Chicken"));
  assert.ok(names(FT.suggestFoods([], "musrooms")).includes("Mushrooms"));
});

test("suggestFoods: fridge spelling wins over the everyday list; excludes foods already in the meal", () => {
  const r = names(FT.suggestFoods([pack("a", "chicken thighs", "main", null)], "chicken", ["Chicken"]));
  assert.ok(r.includes("chicken thighs"));
  assert.equal(r.includes("Chicken"), false);
});

test("newFoodName: offers '+ Add new' only when the typed food isn't already suggested", () => {
  assert.equal(FT.newFoodName("toad in the hole", []), "Toad in the hole");
  assert.equal(FT.newFoodName("chicken", [{ name: "Chicken", kind: "main" }]), null);
  assert.equal(FT.newFoodName("  ", []), null);
});

// ---- planMeal: the free packs it uses, soonest first ----

test("planMeal: plans the soonest free pack per fresh food, marked with the plan id", () => {
  const packs = [
    pack("c1", "Chicken", "main", day(4)),
    pack("c2", "chicken", "main", day(1)),
    pack("b1", "Bacon", "main", null),
    pack("m1", "Mushrooms", "veg", day(3), { plannedFor: day(2), slot: "veg" }), // taken
    pack("x", "Milk", "misc", day(2))
  ];
  const planned = FT.planMeal(pie, packs, day(2), "mp1");
  assert.deepEqual(planned.map(p => [p.id, p.plannedFor, p.slot, p.mealPlanId]), [
    ["c2", day(2), "main", "mp1"],
    ["b1", day(2), "main", "mp1"]
  ]);
  assert.equal(packs[1].plannedFor, null); // input not changed
});

test("planMeal: skipped foods aren't planned; misc goes in the misc slot", () => {
  const packs = [pack("c", "Chicken", "main", day(4)), pack("s", "Sour cream", "misc", day(4))];
  const faj = { id: "r2", name: "Fajitas", fresh: [{ name: "Chicken" }, { name: "Sour cream" }] };
  assert.deepEqual(FT.planMeal(faj, packs, TODAY, "mp", ["Chicken"]).map(p => [p.id, p.slot]), [["s", "misc"]]);
});

test("unplanPack: clears the meal plan id too", () => {
  const p = FT.unplanPack(pack("c", "Chicken", "main", day(4), { plannedFor: TODAY, slot: "main", mealPlanId: "mp1" }));
  assert.equal(p.plannedFor, null);
  assert.equal(p.mealPlanId, null);
});

// ---- syncMealPlan: food bought later joins; edits and skips are followed ----

test("syncMealPlan: a missing food bought later joins the plan", () => {
  const plan = { id: "mp1", day: day(3), mealId: "r1", skip: [] };
  const packs = [
    pack("c", "Chicken", "main", day(5), { plannedFor: day(3), slot: "main", mealPlanId: "mp1" }),
    pack("p", "Pastry", "side", day(9)) // just bought
  ];
  const r = FT.syncMealPlan(plan, pie, packs, TODAY);
  assert.deepEqual(r.plan.map(p => [p.id, p.plannedFor, p.mealPlanId]), [["p", day(3), "mp1"]]);
  assert.deepEqual(r.unplan, []);
});

test("syncMealPlan: foods taken out of the meal, or skipped, come off the day", () => {
  const plan = { id: "mp1", day: day(1), mealId: "r1", skip: ["Bacon"] };
  const packs = [
    pack("c", "Chicken", "main", day(5), { plannedFor: day(1), slot: "main", mealPlanId: "mp1" }),
    pack("b", "Bacon", "main", day(5), { plannedFor: day(1), slot: "main", mealPlanId: "mp1" }),
    pack("o", "Onions", "veg", null, { plannedFor: day(1), slot: "veg", mealPlanId: "mp1" }) // no longer in the meal
  ];
  const r = FT.syncMealPlan(plan, pie, packs, TODAY);
  assert.deepEqual(r.unplan.map(p => [p.id, p.plannedFor, p.mealPlanId]).sort(), [["b", null, null], ["o", null, null]]);
  assert.deepEqual(r.plan, []);
});

test("syncMealPlan: past plans are left alone", () => {
  const plan = { id: "mp1", day: day(-1), mealId: "r1", skip: [] };
  const r = FT.syncMealPlan(plan, pie, [pack("p", "Pastry", "side", day(9))], TODAY);
  assert.deepEqual(r, { plan: [], unplan: [] });
});

test("syncMealPlan: planned twice, the second plan gets its own packs (or none)", () => {
  const p1 = { id: "mp1", day: day(1), mealId: "r1", skip: [] };
  const packs = [pack("c", "Chicken", "main", day(5), { plannedFor: day(1), slot: "main", mealPlanId: "mp1" })];
  const p2 = { id: "mp2", day: day(3), mealId: "r1", skip: [] };
  assert.deepEqual(FT.syncMealPlan(p2, pie, packs, TODAY).plan, []);
});

// ---- mealPlanView: what the day's drop-down shows ----

test("mealPlanView: each food with its pack, need, skipped or out-of-date; other items listed", () => {
  const plan = { id: "mp1", day: day(2), mealId: "r1", skip: ["Mushrooms"] };
  const packs = [
    pack("c", "Chicken", "main", day(1), { plannedFor: day(2), slot: "main", mealPlanId: "mp1" }), // out by then
    pack("b", "Bacon", "main", day(6), { plannedFor: day(2), slot: "main", mealPlanId: "mp1" })
  ];
  const v = FT.mealPlanView(plan, pie, packs);
  assert.equal(v.name, "Chicken pie");
  assert.deepEqual(v.foods.map(f => [f.name, f.some, f.pack ? f.pack.id : null, f.skipped, f.out]), [
    ["Chicken", false, "c", false, 1],
    ["Bacon", true, "b", false, 0],
    ["Mushrooms", false, null, true, 0],
    ["Pastry", false, null, false, 0]
  ]);
  assert.deepEqual(v.missing, ["Pastry"]);
  assert.equal(v.warn, true); // something missing or out by the day
  assert.deepEqual(v.other, [{ name: "White sauce packet", qty: "x2" }]);
});

test("mealPlanView: a deleted meal shows as gone, not a crash", () => {
  const v = FT.mealPlanView({ id: "mp1", day: TODAY, mealId: "gone", skip: [] }, null, []);
  assert.equal(v, null);
});

// ---- mealShopNames: what's offered for the shopping list ----

test("mealShopNames: missing fresh foods, then other items with their amount", () => {
  const v = FT.mealPlanView({ id: "mp1", day: TODAY, mealId: "r1", skip: [] }, pie, []);
  assert.deepEqual(FT.mealShopNames(v), ["Chicken", "Bacon", "Mushrooms", "Pastry", "White sauce packet x2"]);
});

// ---- dayGroups: one chip per meal plan, then single foods ----

test("dayGroups: meal plans first (even with no packs yet), then single foods", () => {
  const d = day(1);
  const plans = [{ id: "mp1", day: d, mealId: "r1", skip: [] }, { id: "mp2", day: day(2), mealId: "r1", skip: [] }];
  const packs = [
    pack("pe", "Peas", "veg", null, { plannedFor: d, slot: "veg" }),
    pack("c", "Chicken", "main", day(3), { plannedFor: d, slot: "main", mealPlanId: "mp1" })
  ];
  const g = FT.dayGroups(packs, plans, [pie], d);
  assert.deepEqual(g.map(x => x.type), ["meal", "pack"]);
  assert.equal(g[0].plan.id, "mp1");
  assert.equal(g[0].view.name, "Chicken pie");
  assert.equal(g[1].pack.id, "pe");
});

test("dayGroups: packs of a deleted plan show as single foods", () => {
  const d = day(1);
  const packs = [pack("c", "Chicken", "main", day(3), { plannedFor: d, slot: "main", mealPlanId: "old" })];
  assert.deepEqual(FT.dayGroups(packs, [], [pie], d).map(x => x.type), ["pack"]);
});

// ---- mealStatus: what My meals says ----

test("mealStatus: planned days from today on", () => {
  const plans = [
    { id: "a", day: day(3), mealId: "r1", skip: [] },
    { id: "b", day: day(0), mealId: "r1", skip: [] },
    { id: "c", day: day(-2), mealId: "r1", skip: [] },
    { id: "d", day: day(1), mealId: "r9", skip: [] }
  ];
  assert.deepEqual(FT.mealStatus(pie, plans, [], TODAY), { planned: [day(0), day(3)], need: [] });
});

test("mealStatus: not planned -> what's missing from the free fridge food", () => {
  const packs = [
    pack("c", "Chicken", "main", day(3)),
    pack("b", "Bacon", "main", day(3), { plannedFor: day(1), slot: "main" }) // taken
  ];
  assert.deepEqual(FT.mealStatus(pie, [], packs, TODAY), { planned: [], need: ["Bacon", "Mushrooms", "Pastry"] });
});

// ---- partDefaults: "some" foods start as part used on "How much did you use?" ----

test("partDefaults: pack ids of 'some' foods in the day's meal plans", () => {
  const d = TODAY;
  const plans = [{ id: "mp1", day: d, mealId: "r1", skip: [] }];
  const packs = [
    pack("c", "Chicken", "main", day(3), { plannedFor: d, slot: "main", mealPlanId: "mp1" }),
    pack("b", "Bacon", "main", day(3), { plannedFor: d, slot: "main", mealPlanId: "mp1" }),
    pack("pe", "Peas", "veg", null, { plannedFor: d, slot: "veg" })
  ];
  assert.deepEqual([...FT.partDefaults(packs, plans, [pie], d)], ["b"]);
});

// ---- old plans tidy away ----

test("expiredMealPlans: more than 3 days old", () => {
  const plans = [{ id: "a", day: day(-4) }, { id: "b", day: day(-3) }, { id: "c", day: day(1) }];
  assert.deepEqual(FT.expiredMealPlans(plans, TODAY).map(p => p.id), ["a"]);
});

// ---- kept from v3 recipes: misc tab, shopping de-dupe, backups ----

test("mealPick misc: misc foods, dated first by date, then undated by added", () => {
  const packs = [
    pack("m1", "Milk", "misc", day(4)),
    pack("m2", "Eggs", "misc", null, { added: day(-3) }),
    pack("m3", "Butter", "misc", day(1)),
    pack("m5", "Milk", "misc", day(2))
  ];
  assert.deepEqual(FT.mealPick(packs, "misc").map(r => [r.name, r.count]), [["Butter", 1], ["Milk", 2], ["Eggs", 1]]);
});

test("recipeShopList: skips names already to get (any case)", () => {
  const shop = [{ id: "s1", name: "pastry", got: false, del: null }, { id: "s2", name: "Bacon", got: true, del: null }];
  assert.deepEqual(FT.recipeShopList(["Pastry", "Bacon", "Chicken", "chicken"], shop), ["Bacon", "Chicken"]);
});

test("backups include meals and meal plans", () => {
  const data = { packs: [], shop: [], meals: [], sheets: [], ratings: [], recipes: [pie], mealPlans: [{ id: "mp1", day: TODAY, mealId: "r1", skip: [] }] };
  const back = FT.readBackup(FT.backupFile(data, TODAY, TODAY + "T10:00:00Z").text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.data.recipes, [pie]);
  assert.equal(back.data.mealPlans.length, 1);
  assert.deepEqual(FT.readBackup(JSON.stringify({ app: "food-tracker-v2", made: "x" })).data.mealPlans, []);
});

test("meal and meal plan changes are not 🔔 news", () => {
  assert.equal(FT.activityChange("recipes", null, pie), null);
  assert.equal(FT.activityChange("mealPlans", null, { id: "mp1" }), null);
});
