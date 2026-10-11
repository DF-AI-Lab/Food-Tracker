// V2 step 8: fridge sheet layout + scan "already done" (pure logic in v2/js/logic.js) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const FT = require(path.join(__dirname, "..", "v2", "js", "logic.js"));

const TODAY = "2026-10-11"; // a Sunday
const pk = (id, name, kind, date, extra = {}) => ({
  id, name, kind, date, dateType: date ? "use_by" : null, status: "in_fridge",
  added: "2026-10-01", left: null, frozen: null, ...extra,
});

// ---------- print layout ----------

test("sheet: a strip of the next 7 days after printing", () => {
  const s = FT.printSheet([], TODAY);
  assert.deepEqual(s.days, ["Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16", "Sat 17", "Sun 18"]);
});

test("sheet: the strip crosses into the next month", () => {
  assert.deepEqual(FT.printSheet([], "2026-10-29").days, ["Fri 30", "Sat 31", "Sun 1", "Mon 2", "Tue 3", "Wed 4", "Thu 5"]);
});

test("sheet: no meals on the sheet any more", () => {
  const s = FT.printSheet([pk(1, "Pie", "main", "2026-10-20", { plannedFor: TODAY, slot: "main" })], TODAY);
  assert.equal(s.meals, undefined);
  assert.equal(s.range, undefined);
});

test("sheet: more rows per column now the bottom boxes are gone (at least 24)", () => {
  const mains = [];
  for (let i = 0; i < 60; i++) mains.push(pk(i + 1, "M" + i, "main", FT.addDays(TODAY, 5 + i)));
  const s = FT.printSheet(mains, TODAY);
  // one section: header + rows + "+N more" line
  assert.ok(s.left[0].rows.length >= 22, "shown: " + s.left[0].rows.length);
  assert.ok(s.shown >= 22);
  assert.equal(s.total, 60);
});

test("sheet: numbering and sections work as before", () => {
  const s = FT.printSheet([pk(1, "Chicken", "main", "2026-10-12"), pk(2, "Rice", "side", null)], TODAY);
  assert.deepEqual(s.left.map(x => x.key), ["soon"]);
  assert.deepEqual(s.left[0].rows.map(r => [r.no, r.name]), [["01", "Chicken"]]);
  assert.deepEqual(s.right[0].rows.map(r => [r.no, r.name]), [["02", "Rice"]]);
});

// ---------- scan: food changed on a phone after printing ----------

const rows = [{ no: "01", id: "a", name: "Chicken" }, { no: "02", id: "b", name: "Milk" }, { no: "03", id: "c", name: "Ham" }];
const marks = { "01": { u: true }, "02": { b: true }, "03": { u: true } };

test("scan: marked food still in the fridge is a change, as before", () => {
  const packs = [pk("a", "Chicken", "main", null), pk("b", "Milk", "misc", null), pk("c", "Ham", "main", null)];
  const out = FT.sheetChanges(rows, marks, packs);
  assert.deepEqual(out.map(c => [c.no, c.mark, !!c.done]), [["01", "u", false], ["02", "b", false], ["03", "u", false]]);
});

test("scan: marked food already used / binned / frozen / deleted on a phone shows as 'already done'", () => {
  const packs = [
    pk("a", "Chicken", "main", null, { status: "used" }),
    pk("b", "Milk", "misc", null, { status: "thrown_away" }),
    pk("c", "Ham", "main", null),
  ];
  const out = FT.sheetChanges(rows, marks, packs);
  assert.deepEqual(out.map(c => [c.no, c.done === true]), [["01", true], ["02", true], ["03", false]]);
  assert.equal(out[0].note, "already done");
  const frozen = FT.sheetChanges(rows, marks, [pk("a", "Chicken", "main", null, { status: "frozen" })]);
  assert.equal(frozen[0].done, true);
});

test("scan: food gone for good from the database is 'already done' too", () => {
  const out = FT.sheetChanges(rows, { "01": { u: true } }, []);
  assert.deepEqual(out.map(c => [c.no, c.name, c.done]), [["01", "Chicken", true]]);
});

test("scan: part used on a phone, then P marked on the sheet -> already done", () => {
  const out = FT.sheetChanges(rows, { "01": { p: true } }, [pk("a", "Chicken", "main", null, { partUsed: true })]);
  assert.equal(out[0].done, true);
});

test("scan: unmarked rows are never listed, done or not", () => {
  const out = FT.sheetChanges(rows, {}, [pk("a", "Chicken", "main", null, { status: "used" })]);
  assert.deepEqual(out, []);
});
