// Combos v3: a combo can be a dish (2+ foods, name, note); goes-with foods can carry a note (Darren 2026-10-24)
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const T = "2026-10-24";
const pack = (id, name, kind, extra = {}) => ({ id, name, kind, status: "in_fridge", date: null, added: T, ...extra });
const combos = [
  { id: 1, type: "dish", name: "Pigs in blankets", foods: ["Sausages", "Bacon"], note: "wrapped in bacon" },
  { id: 2, type: "dish", name: "Cauli cheese", foods: ["Cauliflower", "Cheese sauce"], note: "" },
  { id: 3, a: "Pigs in blankets", b: "Potatoes", note: "chips", source: "hand", hidden: false },
  { id: 4, a: "Pigs in blankets", b: "Potatoes", note: "mash", source: "hand", hidden: false },
  { id: 5, a: "Pigs in blankets", b: "Cauli cheese", source: "hand", hidden: false },
];

test("comboDishes: the dishes A to Z", () => {
  assert.deepEqual(FT.comboDishes(combos).map(d => d.name), ["Cauli cheese", "Pigs in blankets"]);
  assert.deepEqual(FT.comboDishes(combos)[1].foods, ["Sausages", "Bacon"]);
});

test("comboPairs: dishes are not pairs; the same food with 2 notes is 2 pairs", () => {
  const { shown } = FT.comboPairs(combos, []);
  assert.equal(shown.length, 3);
  assert.deepEqual(shown.filter(r => r.b === "Potatoes").map(r => r.note).sort(), ["chips", "mash"]);
});

test("comboKey: the note counts, case does not", () => {
  assert.equal(FT.comboKey("A", "Potatoes", "Chips"), FT.comboKey("a", "potatoes", "chips"));
  assert.notEqual(FT.comboKey("A", "Potatoes", "chips"), FT.comboKey("A", "Potatoes", "mash"));
  assert.equal(FT.comboKey("A", "B"), FT.pairKey("A", "B"));
});

test("newComboRows: a note with commas makes one pair per note; pairs already there are skipped", () => {
  const { shown } = FT.comboPairs(combos, []);
  const rows = FT.newComboRows("Pigs in blankets", [
    { name: "Potatoes", note: "chips, roast" },
    { name: "Peas" },
    "Gravy",
  ], shown);
  assert.deepEqual(rows, [
    { a: "Pigs in blankets", b: "Potatoes", note: "roast", source: "hand", hidden: false },
    { a: "Pigs in blankets", b: "Peas", source: "hand", hidden: false },
    { a: "Pigs in blankets", b: "Gravy", source: "hand", hidden: false },
  ]);
});

test("comboGroups: a dish with no pairs still gets a group, and carries its foods", () => {
  const { shown } = FT.comboPairs(combos, []);
  const g = FT.comboGroups(shown, FT.comboDishes(combos));
  assert.deepEqual(g.map(x => x.name), ["Cauli cheese", "Pigs in blankets"]);
  assert.equal(g[0].rows.length, 0);
  assert.deepEqual(g[0].dish.foods, ["Cauliflower", "Cheese sauce"]);
  assert.equal(g[1].rows.length, 3);
});

test("tonightIdeas: a dish shows when all its foods are in; its goes-with can be a dish too", () => {
  const fridge = [
    pack(1, "Sausages", "main", { date: "2026-10-26" }),
    pack(2, "Bacon", "main", { date: "2026-10-28" }),
    pack(3, "Potatoes", "veg"),
    pack(4, "Cauliflower", "veg"),
    pack(5, "Cheese sauce", "side", { date: "2026-10-30" }),
  ];
  const { shown } = FT.comboPairs(combos, []);
  const ideas = FT.tonightIdeas(fridge, shown, T, [], FT.comboDishes(combos));
  const pib = ideas.find(i => i.key === "dish:pigs in blankets");
  assert.ok(pib, "Pigs in blankets idea");
  const ids = [pib.main, ...pib.sides].map(p => p.id).sort();
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
  assert.match(pib.title, /^Pigs in blankets \+ /);
  assert.match(pib.title, /Potatoes \((chips|mash)\)/);
  assert.match(pib.title, /Cauli cheese/);
  // Not tonight on the dish
  assert.equal(FT.tonightIdeas(fridge, shown, T, ["dish:pigs in blankets"], FT.comboDishes(combos))
    .some(i => i.key === "dish:pigs in blankets"), false);
});

test("tonightIdeas: no dish when a food is missing", () => {
  const fridge = [pack(1, "Sausages", "main"), pack(3, "Potatoes", "veg")];
  const { shown } = FT.comboPairs(combos, []);
  const ideas = FT.tonightIdeas(fridge, shown, T, [], FT.comboDishes(combos));
  assert.equal(ideas.some(i => i.key === "dish:pigs in blankets"), false);
});
