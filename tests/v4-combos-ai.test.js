// Combos v4: AI fill-in (copy text with instructions, read the answer back) and Stock check days + colours (Darren 2026-10-25)
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const T = "2026-10-25";
const pack = (id, name, kind, extra = {}) => ({ id, name, kind, status: "in_fridge", date: null, added: T, ...extra });
const packs = [
  pack(1, "Chicken", "main"),
  pack(2, "Sausages", "main"),
  pack(3, "Rice", "side"),
  pack(4, "Peas", "veg"),
  pack(5, "Gravy", "misc")
];
const combos = [
  { id: 1, type: "dish", name: "Pigs in blankets", foods: ["Sausages", "Bacon"], note: "wrapped in bacon" },
  { id: 2, a: "Chicken", b: "Peas", source: "hand", hidden: false },
  { id: 3, a: "Chicken", b: "Gravy", source: "hand", hidden: true }
];
const meals = [
  { id: 1, day: "2026-10-20", items: [{ name: "Chicken", slot: "main" }, { name: "Rice", slot: "side" }], takeaway: false },
  { id: 2, day: "2026-09-01", items: [{ name: "Old pie", slot: "main" }], takeaway: false }
];

test("aiComboText: instructions, foods by kind, dishes, pairs, hidden, last 4 weeks", () => {
  const t = FT.aiComboText({ packs, combos, meals, today: T });
  assert.match(t, /JSON/);
  assert.match(t, /"pairs"/);
  assert.match(t, /Mains: [^\n]*Chicken[^\n]*Sausages/);
  assert.match(t, /Sides: [^\n]*Rice/);
  assert.match(t, /Veg: [^\n]*Peas/);
  assert.match(t, /Pigs in blankets/);
  assert.match(t, /Chicken \+ Peas/);
  assert.match(t, /Don't suggest[^\n]*\n[^\n]*Chicken \+ Gravy/);
  assert.match(t, /2026-10-20: Chicken, Rice/);
  assert.doesNotMatch(t, /Old pie/);
});

test("parseAiCombos: reads JSON inside chat text and code fences", () => {
  const text = 'Sure! Here you go:\n```json\n{"pairs":[{"a":"Chicken","b":"Rice"},{"a":"Pigs in blankets","b":"Potatoes","note":"roast"}]}\n```\nEnjoy';
  const r = FT.parseAiCombos(text, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [
    { a: "Chicken", b: "Rice", source: "ai", hidden: false },
    { a: "Pigs in blankets", b: "Potatoes", note: "roast", source: "ai", hidden: false }
  ]);
});

test("parseAiCombos: a bare list works too", () => {
  const r = FT.parseAiCombos('[{"a":"Chicken","b":"Rice"}]', []);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
});

test("parseAiCombos: skips ones already there (shown or hidden), repeats, blanks and self-pairs", () => {
  const all = FT.comboPairs(combos, []);
  const existing = [...all.shown, ...all.hidden];
  const text = JSON.stringify({ pairs: [
    { a: "Chicken", b: "Peas" },        // already there
    { a: "peas", b: "chicken" },        // same pair, other way round
    { a: "Chicken", b: "Gravy" },       // hidden: still skipped
    { a: "Chicken", b: "Rice" },
    { a: "chicken", b: "rice" },        // repeat
    { a: "Chicken", b: "" },
    { a: "Rice", b: "Rice" },
    { a: "Chicken", b: "Rice", note: "egg fried" } // a new note is new
  ] });
  const r = FT.parseAiCombos(text, existing);
  assert.deepEqual(r.rows.map(x => `${x.a}+${x.b}${x.note ? "|" + x.note : ""}`), ["Chicken+Rice", "Chicken+Rice|egg fried"]);
});

test("parseAiCombos: not JSON gives a reason", () => {
  const r = FT.parseAiCombos("I can't help with that", []);
  assert.equal(r.ok, false);
  assert.ok(r.reason);
  assert.equal(FT.parseAiCombos("", []).ok, false);
});

test("stockWhen: soonest date with days, coloured by state; later dates after", () => {
  const p = (date, extra = {}) => ({ name: "X", date, added: "2026-10-10", ...extra });
  assert.deepEqual(FT.stockWhen([p("2026-10-17"), p("2026-10-24")], T), { main: "17 Oct · 8 days out", more: "24 Oct", state: "out" });
  assert.deepEqual(FT.stockWhen([p("2026-10-24")], T), { main: "24 Oct · 1 day out", more: "", state: "out" });
  assert.deepEqual(FT.stockWhen([p("2026-10-25")], T), { main: "25 Oct · today", more: "", state: "out" });
  assert.deepEqual(FT.stockWhen([p("2026-10-27")], T), { main: "27 Oct · 2 days", more: "", state: "soon" });
  assert.deepEqual(FT.stockWhen([p("2026-12-02")], T), { main: "2 Dec · 38 days", more: "", state: "ok" });
  assert.deepEqual(FT.stockWhen([p("2026-10-26", { dateType: "best_before" })], T), { main: "BB 26 Oct · 1 day", more: "", state: "soon" });
  assert.deepEqual(FT.stockWhen([p(null)], T), { main: "added 10 Oct", more: "", state: "" });
  assert.deepEqual(FT.stockWhen([p("2026-10-24"), p("2026-10-24")], T).more, "");
});

test("backups keep combos; an older backup without them reads as none", () => {
  const b = FT.backupFile({ combos: [{ id: 1, a: "Chicken", b: "Rice" }] }, T, "2026-10-25T10:00:00Z");
  const r = FT.readBackup(b.text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.combos, [{ id: 1, a: "Chicken", b: "Rice" }]);
  const old = FT.readBackup(JSON.stringify({ app: JSON.parse(b.text).app, packs: [] }));
  assert.deepEqual(old.data.combos, []);
  assert.ok("combos" in FT.restorePlan({}, r.data));
});
