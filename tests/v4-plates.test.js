// Plates (Darren 2026-10-25): an idea is 1 main + 1 base (potatoes, rice, pasta…) + up to 2 goes-with,
// not a main with any 3 foods. Ask AI for dinner: the AI picks plates from the fridge; Save keeps them as combos.
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const T = "2026-10-25";
const pack = (id, name, kind, date, extra = {}) => ({ id, name, kind, status: "in_fridge", date, added: "2026-10-20", ...extra });
const pair = (a, b, extra = {}) => ({ a, b, source: "hand", hidden: false, ...extra });

test("foodRole: potatoes, rice, pasta and the like are a base; the rest go with", () => {
  for (const n of ["Potatoes", "Baby potatoes", "Chips", "Mash", "Rice", "Pasta", "Spaghetti", "Noodles", "Couscous", "Naan", "Wraps"]) assert.equal(FT.foodRole(n), "base", n);
  for (const n of ["Peas", "Beans", "Gravy", "Mushrooms", "Eggs", "Sweetcorn", "Onions"]) assert.equal(FT.foodRole(n), "side", n);
});

test("pairRole: a stored role wins; otherwise the other food's role", () => {
  assert.equal(FT.pairRole(pair("Sausages", "Peas", { role: "base" }), "Sausages"), "base");
  assert.equal(FT.pairRole(pair("Sausages", "Chips"), "Sausages"), "base");
  assert.equal(FT.pairRole(pair("Chips", "Sausages"), "Sausages"), "base");
  assert.equal(FT.pairRole(pair("Sausages", "Peas"), "Sausages"), "side");
});

test("tonightIdeas: 1 base (soonest) and up to 2 goes-with, base first", () => {
  const fridge = [
    pack(1, "Sausages", "main", "2026-10-26"),
    pack(2, "Chips", "side", "2026-10-30"),
    pack(3, "Rice", "side", "2026-10-27"),
    pack(4, "Peas", "veg", "2026-10-28"),
    pack(5, "Beans", "misc", "2026-10-29"),
    pack(6, "Gravy", "misc", "2026-11-05")
  ];
  const pairs = ["Chips", "Rice", "Peas", "Beans", "Gravy"].map(b => pair("Sausages", b));
  const [idea] = FT.tonightIdeas(fridge, pairs, T);
  assert.deepEqual(idea.sides.map(p => p.name), ["Rice", "Peas", "Beans"]);
  assert.equal(idea.title, "Sausages + Rice + Peas + Beans");
});

test("tonightIdeas: a base's note shows in the title (Potatoes (mash))", () => {
  const fridge = [pack(1, "Sausages", "main", "2026-10-26"), pack(2, "Potatoes", "side", "2026-10-27"), pack(3, "Peas", "veg", null)];
  const pairs = [pair("Sausages", "Potatoes", { note: "mash" }), pair("Sausages", "Peas")];
  const [idea] = FT.tonightIdeas(fridge, pairs, T);
  assert.equal(idea.title, "Sausages + Potatoes (mash) + Peas");
});

test("tonightIdeas: no base is fine (main + goes-with only)", () => {
  const fridge = [pack(1, "Bacon", "main", "2026-10-26"), pack(2, "Eggs", "misc", "2026-10-27"), pack(3, "Mushrooms", "veg", "2026-10-28"), pack(4, "Beans", "misc", null)];
  const pairs = ["Eggs", "Mushrooms", "Beans"].map(b => pair("Bacon", b));
  const [idea] = FT.tonightIdeas(fridge, pairs, T);
  assert.deepEqual(idea.sides.map(p => p.name), ["Eggs", "Mushrooms"]);
});

test("aiComboRequest: each pair has a role (base or side)", () => {
  const body = FT.aiComboRequest({ packs: [], combos: [], meals: [], today: T });
  const item = body.output_config.format.schema.properties.pairs.items;
  assert.ok(item.required.includes("role"));
  assert.deepEqual(item.properties.role.enum, ["base", "side"]);
  assert.match(body.system, /base/i);
});

test("parseAiCombos: keeps the role", () => {
  const allowed = new Set(["sausages", "chips", "peas"]);
  const r = FT.parseAiCombos(JSON.stringify({ pairs: [{ a: "Sausages", b: "Chips", note: "", role: "base" }, { a: "Sausages", b: "Peas", note: "", role: "side" }] }), [], allowed);
  assert.deepEqual(r.rows.map(x => x.role), ["base", "side"]);
});

const fridge = [
  pack(1, "Sausages", "main", "2026-10-26"),
  pack(2, "Potatoes", "side", "2026-10-27"),
  pack(3, "Peas", "veg", null),
  pack(4, "Chicken", "main", "2026-10-25"),
  pack(5, "Rice", "side", "2026-11-20"),
  pack(6, "Old ham", "main", "2026-10-20"),
  pack(7, "Bacon", "main", "2026-10-29", { status: "planned" })
];

test("aiDinnerRequest: sends the free, in-date fridge food with dates, asks for plates", () => {
  const body = FT.aiDinnerRequest({ packs: fridge, combos: [pair("Chicken", "Rice")], meals: [], today: T });
  assert.equal(body.model, "claude-haiku-5-5");
  const text = body.messages[0].content;
  assert.match(text, /Sausages/);
  assert.match(text, /Potatoes/);
  assert.doesNotMatch(text, /Old ham/, "out of date");
  assert.doesNotMatch(text, /Bacon/, "already planned");
  assert.match(text, /Chicken \+ Rice/, "plates they like");
  const plate = body.output_config.format.schema.properties.plates.items;
  for (const k of ["main", "base", "note", "sides", "why"]) assert.ok(plate.required.includes(k), k);
  assert.match(body.system, /base/i);
});

test("parseAiDinner: each plate becomes an idea with the fridge packs, title and the pairs to save", () => {
  const text = JSON.stringify({ plates: [
    { main: "Sausages", base: "Potatoes", note: "mash", sides: ["Peas", "Quinoa"], why: "Sausages go out tomorrow" },
    { main: "Chicken", base: "Rice", note: "", sides: [], why: "Chicken today" },
    { main: "Steak", base: "Rice", note: "", sides: [], why: "not in the fridge" }
  ] });
  const r = FT.parseAiDinner(text, fridge, T);
  assert.equal(r.ok, true);
  assert.equal(r.ideas.length, 2, "Steak is not in the fridge");
  const [a, b] = r.ideas;
  assert.equal(a.title, "Sausages + Potatoes (mash) + Peas");
  assert.equal(a.main.id, 1);
  assert.deepEqual(a.sides.map(p => p.id), [2, 3]);
  assert.equal(a.aiWhy, "Sausages go out tomorrow");
  assert.deepEqual(a.pairs, [
    { a: "Sausages", b: "Potatoes", note: "mash", role: "base" },
    { a: "Sausages", b: "Peas", role: "side" }
  ]);
  assert.equal(b.title, "Chicken + Rice");
  assert.ok(a.key && a.key !== b.key);
});

test("parseAiDinner: bad answer says so", () => {
  assert.equal(FT.parseAiDinner("nope", fridge, T).ok, false);
});

test("newComboRows: only the pairs not stored yet, as AI rows", () => {
  const rows = FT.newComboRows(
    [{ a: "Sausages", b: "Potatoes", note: "mash", role: "base" }, { a: "Sausages", b: "Peas", role: "side" }],
    [pair("Peas", "Sausages")]
  );
  assert.deepEqual(rows, [{ a: "Sausages", b: "Potatoes", note: "mash", role: "base", source: "ai", hidden: false }]);
});
