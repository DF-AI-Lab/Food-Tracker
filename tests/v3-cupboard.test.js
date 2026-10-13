// Fridge / Freezer / Cupboard (Darren, 2026-10-13; mock docs/mockups/cupboard-mock.html) — run with: npm test
// Fridge = Mains · Sides · Veg · Other (the old Misc, same "misc" kind underneath). Cupboard = new "cupboard" kind.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const FT = require(path.join(__dirname, "..", "v2-next", "js", "logic.js"));
const HTML = fs.readFileSync(path.join(__dirname, "..", "v2-next", "index.html"), "utf8");
const APP = fs.readFileSync(path.join(__dirname, "..", "v2-next", "js", "app.js"), "utf8");

test("cupboard is a kind; labels say Other (misc) and Cupboard", () => {
  assert.equal(FT.kindLabel("main"), "Main");
  assert.equal(FT.kindLabel("side"), "Side");
  assert.equal(FT.kindLabel("veg"), "Veg");
  assert.equal(FT.kindLabel("misc"), "Other");
  assert.equal(FT.kindLabel("cupboard"), "Cupboard");
});

test("Quick fill takes a cupboard row; makePacks wants a date or No date, like Other", () => {
  const r = FT.quickFillRow({ name: "Bread", kind: "cupboard", date: "2026-10-16", bb: true });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "cupboard");
  const p = FT.makePacks({ name: "Bread", kind: "cupboard", date: "2026-10-16", count: 1 }, "2026-10-13");
  assert.equal(p[0].kind, "cupboard");
  assert.equal(p[0].status, "in_fridge", "same status as fridge food; the kind says where it lives");
  assert.throws(() => FT.makePacks({ name: "Crisps", kind: "cupboard", count: 1 }, "2026-10-13"));
  assert.doesNotThrow(() => FT.makePacks({ name: "Crisps", kind: "cupboard", noDate: true, count: 1 }, "2026-10-13"));
});

test("top tabs: Fridge · Freezer · Cupboard (no Misc tab)", () => {
  const tabs = HTML.slice(HTML.indexOf('id="fridgeTabs"'), HTML.indexOf('id="fridgeTabs"') + 600);
  assert.match(tabs, /data-view="fridge"/);
  assert.match(tabs, /data-view="freezer"/);
  assert.match(tabs, /data-view="cupboard"[^>]*>Cupboard · <span id="tabCupboardN">/);
  assert.doesNotMatch(tabs, /data-view="misc"/);
  assert.match(HTML, /data-view-pane="cupboard"/);
  assert.match(HTML, /id="cupboardList"/);
});

test("Fridge page has Mains, Sides, Veg, Other boxes", () => {
  const pane = HTML.slice(HTML.indexOf('data-view-pane="fridge"'), HTML.indexOf('data-view-pane="freezer"'));
  for (const name of ["Mains", "Sides", "Veg", "Other"]) assert.match(pane, new RegExp(`class="sec">${name} `));
  assert.match(pane, /id="misc"/, "Other box keeps the misc list id");
});

test("kind buttons offer Other and Cupboard (One item + Quick fill)", () => {
  assert.match(HTML, /data-kind="misc" class="sb">Other</);
  assert.match(HTML, /data-kind="cupboard" class="sb">Cupboard</);
  assert.match(APP, /\['misc', 'Other'\]/);
  assert.match(APP, /\['cupboard', 'Cupboard'\]/);
});
