// Ideas for tonight v2: a why line (soonest food, fridge colours) and no repeats (a main had in the last 3 days) (Darren 2026-10-25)
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const T = "2026-10-25";
const pack = (id, name, kind, date, extra = {}) => ({ id, name, kind, status: "in_fridge", date, added: "2026-10-20", ...extra });
const pair = (a, b) => ({ a, b, source: "hand", hidden: false });
const fridge = [
  pack(1, "Chicken", "main", "2026-10-25"),
  pack(2, "Rice", "side", "2026-10-26"),
  pack(3, "Gammon", "main", "2026-10-30"),
  pack(4, "Mash", "side", "2026-10-28"),
  pack(5, "Fish", "main", null),
  pack(6, "Peas", "veg", null)
];
const pairs = [pair("Chicken", "Rice"), pair("Gammon", "Mash"), pair("Fish", "Peas")];
const meal = (day, names) => ({ id: day, day, items: names.map(n => ({ name: n, slot: "main" })), takeaway: false });

test("why: the soonest food and how long it has, coloured like the fridge", () => {
  const ideas = FT.tonightIdeas(fridge, pairs, T);
  assert.deepEqual(ideas.map(i => i.why), [
    { text: "⚠ Chicken goes out today", state: "out" },
    { text: "Mash goes out in 3 days", state: "ok" },
    { text: "", state: "" }
  ]);
});

test("why: tomorrow, already out, and best before", () => {
  const w = (date, extra = {}) => FT.tonightIdeas([pack(1, "Chicken", "main", date, extra), pack(2, "Rice", "side", null)], [pair("Chicken", "Rice")], T)[0].why;
  assert.deepEqual(w("2026-10-26"), { text: "Chicken goes out tomorrow", state: "soon" });
  assert.deepEqual(w("2026-10-27"), { text: "Chicken goes out in 2 days", state: "soon" });
  assert.deepEqual(w("2026-10-23"), { text: "⚠ Chicken went out 2 days ago", state: "out" });
  assert.deepEqual(w("2026-10-24"), { text: "⚠ Chicken went out yesterday", state: "out" });
  assert.deepEqual(w("2026-10-26", { dateType: "best_before" }), { text: "Chicken best before tomorrow", state: "soon" });
});

test("no repeats: a main had in the last 3 days is skipped; 4 days ago or planned later is fine", () => {
  const keys = meals => FT.tonightIdeas(fridge, pairs, T, [], [], meals).map(i => i.key);
  assert.deepEqual(keys([]), ["chicken", "gammon", "fish"]);
  assert.deepEqual(keys([meal("2026-10-22", ["chicken", "Rice"])]), ["gammon", "fish"]);
  assert.deepEqual(keys([meal("2026-10-24", ["Gammon"])]), ["chicken", "fish"]);
  assert.deepEqual(keys([meal("2026-10-21", ["Chicken"])]), ["chicken", "gammon", "fish"]);
  assert.deepEqual(keys([meal("2026-10-26", ["Fish"])]), ["chicken", "gammon", "fish"]);
  assert.deepEqual(keys([{ ...meal("2026-10-24", ["Gammon"]), takeaway: true }]), ["chicken", "gammon", "fish"]);
});

test("no repeats: a dish is skipped when all its foods were had in the last 3 days", () => {
  const ps = [pack(1, "Sausages", "main", "2026-10-27"), pack(2, "Bacon", "misc", "2026-10-29"), pack(3, "Potatoes", "side", null)];
  const dishes = [{ id: 9, type: "dish", name: "Pigs in blankets", foods: ["Sausages", "Bacon"] }];
  const ps2 = [pair("Pigs in blankets", "Potatoes")];
  const keys = meals => FT.tonightIdeas(ps, ps2, T, [], dishes, meals).map(i => i.key);
  assert.ok(keys([]).includes("dish:pigs in blankets"));
  assert.ok(!keys([meal("2026-10-23", ["Sausages", "Bacon", "Potatoes"])]).includes("dish:pigs in blankets"));
  assert.ok(keys([meal("2026-10-23", ["Bacon"])]).includes("dish:pigs in blankets"));
});
