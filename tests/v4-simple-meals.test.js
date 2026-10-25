// Simple Meals page, part 1 (Darren 2026-10-25): a Use soon strip on Meals, one ✨ Plan my week button
// (Ask AI for dinner gone for now), Ideas for the week gone, All combos + Ask AI for combos kept.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const FT = require("../demo/js/logic.js");

const read = f => fs.readFileSync(path.join(__dirname, "..", "demo", f), "utf8");
const T = "2026-10-25"; // Sunday
const pack = (id, name, date, extra = {}) => ({ id, name, kind: "main", status: "in_fridge", date, added: "2026-10-20", ...extra });

test("mealsUseSoon: in-fridge foods going off in 3 days or less, soonest first", () => {
  const packs = [
    pack(1, "Mince", "2026-10-28"),               // 3 days: in
    pack(2, "Sausages", "2026-10-26"),            // 1 day: in
    pack(3, "Bacon", "2026-10-29"),               // 4 days: out
    pack(4, "Peas", null),                        // no date: out
    pack(5, "Ham", "2026-10-25", { status: "used" }), // used: out
    pack(6, "Milk", "2026-10-24")                 // already out of date: in, first
  ];
  const s = FT.mealsUseSoon(packs, T);
  assert.deepEqual(s.map(x => x.id), [6, 2, 1]);
  assert.deepEqual(s.map(x => x.days), [-1, 1, 3]);
  assert.equal(s[1].name, "Sausages");
});

test("mealsUseSoon: planned says which day, not planned is null", () => {
  const packs = [pack(1, "Chicken", "2026-10-26", { plannedFor: "2026-10-26" }), pack(2, "Potatoes", "2026-10-27")];
  const s = FT.mealsUseSoon(packs, T);
  assert.equal(s[0].plannedFor, "2026-10-26");
  assert.equal(s[1].plannedFor, null);
});

test("mealsUseSoon: empty fridge gives an empty list", () => {
  assert.deepEqual(FT.mealsUseSoon([], T), []);
});

test("Meals page: Use soon strip, one Plan my week button, no AI dinner, no Ideas for the week", () => {
  const html = read("index.html");
  const meals = html.slice(html.indexOf('data-tab-pane="meals"'));
  assert.match(meals, /id="mealsSoon"/);
  assert.ok(meals.indexOf('id="mealsSoon"') < meals.indexOf('id="weekBtn"'), "Use soon sits above Plan my week");
  assert.match(meals, /id="weekBtn"[^>]*>✨ Plan my week</);
  assert.doesNotMatch(html, /id="dinnerBtn"|id="dinnerBox"|Ask AI for dinner/);
  assert.doesNotMatch(html, /id="ideasWeek"|Ideas for the week/);
  // kept
  for (const id of ["weekPanel", "dayList", "myMealsFold", "combosFold", "allCombosFold", "comboAdd", "aiAsk"]) {
    assert.match(html, new RegExp(`id="${id}"`), id + " kept");
  }
});

test("app.js: no AI dinner or Ideas for the week code left, draws the Use soon strip", () => {
  const app = read("js/app.js");
  assert.doesNotMatch(app, /dinnerBtn|dinnerBox|dinnerIdeas|aiDinnerRequest|parseAiDinner/);
  assert.doesNotMatch(app, /ideasWeek/);
  assert.match(app, /FT\.mealsUseSoon\(/);
  assert.match(app, /mealsSoon/);
});

test("version bumped to d.v4.49 (n 90), sw.js matches", () => {
  const m = /n:\s*(\d+),\s*label:\s*"([\d.]+)"/.exec(read("js/version.js"));
  assert.equal(Number(m[1]), 90);
  assert.equal(m[2], "4.49");
  assert.equal(Number(/const VERSION = (\d+)/.exec(read("sw.js"))[1]), 90);
});
