// Combos v2: pick a food, tick what goes with it (Darren 2026-10-24) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const packs = [
  { id: 1, name: "Pizza", kind: "main", status: "in_fridge", added: "2026-10-20" },
  { id: 2, name: "Beans", kind: "cupboard", status: "in_fridge", added: "2026-10-20" },
];

test("comboFoods: foods of that kind A to Z, yours and the usual ones", () => {
  const mains = FT.comboFoods(packs, "main");
  assert.ok(mains.includes("Pizza"));
  assert.ok(mains.includes("Sausages"));
  assert.deepEqual(mains, [...mains].sort((a, b) => a.localeCompare(b)));
  assert.ok(FT.comboFoods(packs, "side").includes("Chips"));
  assert.ok(!FT.comboFoods(packs, "main").includes("Chips"));
});

test("comboGroups: one group per food, A to Z, its pairs A to Z", () => {
  const rows = [
    { key: "a", a: "Sausages", b: "Peas" },
    { key: "b", a: "Chicken", b: "Chips" },
    { key: "c", a: "sausages", b: "Mash" },
  ];
  const g = FT.comboGroups(rows);
  assert.deepEqual(g.map(x => x.name), ["Chicken", "Sausages"]);
  assert.deepEqual(g[1].rows.map(r => r.b), ["Mash", "Peas"]);
});

test("newComboRows: skips blanks, itself, doubles and pairs already there", () => {
  const existing = [{ key: FT.pairKey("Sausages", "Mash") }];
  const rows = FT.newComboRows("Sausages", ["Mash", "Chips", "chips", "", "Sausages", "Peas"], existing);
  assert.deepEqual(rows, [
    { a: "Sausages", b: "Chips", source: "hand", hidden: false },
    { a: "Sausages", b: "Peas", source: "hand", hidden: false },
  ]);
});
