// Meal ideas step 1 (Darren 2026-10-24): pairs (combos) and Ideas for tonight — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const pack = (id, name, kind, extra = {}) => ({ id, name, kind, status: "in_fridge", date: null, added: "2026-10-20", ...extra });
const meal = (day, items, extra = {}) => ({ day, items: items.map(([name, slot]) => ({ name, slot })), takeaway: false, ...extra });

test("pairKey: same pair whatever the order or case", () => {
  assert.equal(FT.pairKey("Chicken", " chips"), FT.pairKey("chips", "CHICKEN"));
  assert.notEqual(FT.pairKey("Chicken", "Chips"), FT.pairKey("Chicken", "Peas"));
});

test("comboPairs: learned from meals had 2+ times (main with each other food)", () => {
  const meals = [
    meal("2026-10-01", [["Chicken", "main"], ["Chips", "side"], ["Peas", "veg"]]),
    meal("2026-10-08", [["chicken", "main"], ["Chips", "side"]]),
    meal("2026-10-09", [["Fish", "main"], ["Rice", "side"]]),
    meal("2026-10-10", [["Takeaway", "main"], ["Chips", "side"]], { takeaway: true }),
    meal("2026-10-11", [["Takeaway", "main"], ["Chips", "side"]], { takeaway: true }),
  ];
  const { shown, hidden } = FT.comboPairs([], meals);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].key, FT.pairKey("Chicken", "Chips"));
  assert.equal(shown[0].a, "Chicken");
  assert.equal(shown[0].b, "Chips");
  assert.equal(shown[0].count, 2);
  assert.equal(shown[0].source, "learned");
  assert.deepEqual(hidden, []);
});

test("comboPairs: hand and AI pairs, hidden ones go to hidden, no doubles", () => {
  const meals = [
    meal("2026-10-01", [["Chicken", "main"], ["Chips", "side"]]),
    meal("2026-10-02", [["Chicken", "main"], ["Chips", "side"]]),
  ];
  const combos = [
    { id: "c1", a: "Pizza", b: "Coleslaw", source: "hand" },
    { id: "c2", a: "chips", b: "chicken", source: "hand" },      // same as learned: one row, count kept
    { id: "c3", a: "Fish", b: "Rice", source: "ai", hidden: true },
  ];
  const { shown, hidden } = FT.comboPairs(combos, meals);
  assert.deepEqual(shown.map(p => `${p.a} + ${p.b}`), ["Chicken + Chips", "Pizza + Coleslaw"]);
  assert.equal(shown[0].count, 2);
  assert.equal(shown[0].id, "c2");
  assert.equal(shown[1].source, "hand");
  assert.equal(shown[1].count, 0);
  assert.deepEqual(hidden.map(p => p.id), ["c3"]);
  assert.equal(hidden[0].source, "ai");
});

test("comboPairs: a learned pair said 'not for me' stays hidden", () => {
  const meals = [meal("2026-10-01", [["Fish", "main"], ["Rice", "side"]]), meal("2026-10-02", [["Fish", "main"], ["Rice", "side"]])];
  const { shown, hidden } = FT.comboPairs([{ id: "c9", a: "Fish", b: "Rice", source: "learned", hidden: true }], meals);
  assert.deepEqual(shown, []);
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].count, 2);
});

const pairs = [
  { key: FT.pairKey("Chicken", "Chips"), a: "Chicken", b: "Chips" },
  { key: FT.pairKey("Chicken", "Cauli cheese"), a: "Chicken", b: "Cauli cheese" },
  { key: FT.pairKey("Coleslaw", "Pizza"), a: "Coleslaw", b: "Pizza" },
  { key: FT.pairKey("Ribs", "Rice"), a: "Ribs", b: "Rice" },
];
const fridge = [
  pack(1, "Chicken", "main", { date: "2026-10-27" }),
  pack(2, "Chips", "side"),
  pack(3, "Cauli cheese", "side", { date: "2026-10-25" }),
  pack(4, "Pizza", "main", { date: "2026-10-30" }),
  pack(5, "Coleslaw", "side", { date: "2026-10-26", dateType: "best_before" }),
  pack(6, "Ribs", "main", { date: "2026-10-24" }),             // no Rice in: no idea
  pack(7, "Chicken", "main", { date: "2026-10-29" }),          // 2nd chicken: still one idea
  pack(8, "Chips", "side", { plannedFor: "2026-10-26" }),     // planned: not free
];

test("tonightIdeas: every meal the pairs can make, soonest date first", () => {
  const ideas = FT.tonightIdeas(fridge, pairs, "2026-10-24");
  assert.deepEqual(ideas.map(i => i.main.id), [1, 4]);
  assert.equal(ideas[0].key, "chicken");
  assert.deepEqual(ideas[0].sides.map(p => p.id), [2, 3]); // base (Chips) first, then goes-with (Cauli cheese)
  assert.equal(ideas[0].pairs.length, 2);
  assert.deepEqual(ideas[1].sides.map(p => p.id), [5]);
  assert.equal(ideas[1].pairs.length, 1);
});

test("tonightIdeas: Not tonight keys are left out; nothing in = nothing out", () => {
  assert.deepEqual(FT.tonightIdeas(fridge, pairs, "2026-10-24", ["chicken"]).map(i => i.key), ["pizza"]);
  assert.deepEqual(FT.tonightIdeas([], pairs, "2026-10-24"), []);
  assert.deepEqual(FT.tonightIdeas(fridge, [], "2026-10-24"), []);
});

test("tonightIdeas: at most 1 base and 2 goes-with sides", () => {
  const many = ["A", "B", "C", "D"].map(n => ({ key: FT.pairKey("Chicken", n), a: "Chicken", b: n }));
  const ps = [pack(1, "Chicken", "main", { date: "2026-10-27" }), ...["A", "B", "C", "D"].map((n, i) => pack(10 + i, n, "veg"))];
  assert.equal(FT.tonightIdeas(ps, many, "2026-10-24")[0].sides.length, 2);
});

test("ideaWarn: foods that are out of date by the chosen day", () => {
  const idea = FT.tonightIdeas(fridge, pairs, "2026-10-24")[0];
  assert.deepEqual(FT.ideaWarn(idea, "2026-10-24"), []);
  assert.deepEqual(FT.ideaWarn(idea, "2026-10-26").map(p => p.name), ["Cauli cheese"]);
  assert.deepEqual(FT.ideaWarn(idea, "2026-10-28").map(p => p.name), ["Chicken", "Cauli cheese"]);
});
