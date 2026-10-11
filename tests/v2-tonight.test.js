// V2 step 7b: confirm tonight's meal from 5pm (pure logic in v2/js/logic.js) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const FT = require(path.join(__dirname, "..", "v2", "js", "logic.js"));

const T = "2026-10-09";
const plan = (id, day, extra = {}) =>
  ({ id, name: "Pie", kind: "main", status: "in_fridge", date: "2026-10-20", plannedFor: day, slot: "main", ...extra });

test("tonight starts at 5pm", () => {
  assert.equal(FT.TONIGHT_HOUR, 17);
});

test("before 5pm: today's plan is not asked yet", () => {
  const packs = [plan(1, "2026-10-08"), plan(2, T)];
  assert.deepEqual(FT.pastToAsk(packs, T, 16), ["2026-10-08"]);
  assert.deepEqual(FT.pastToAsk(packs, T, 0), ["2026-10-08"]);
});

test("from 5pm: today's waiting plan is asked too, last", () => {
  const packs = [plan(1, "2026-10-08"), plan(2, T)];
  assert.deepEqual(FT.pastToAsk(packs, T, 17), ["2026-10-08", T]);
  assert.deepEqual(FT.pastToAsk(packs, T, 23), ["2026-10-08", T]);
});

test("from 5pm: a takeaway planned for today is asked", () => {
  const packs = [{ id: 3, name: "Takeaway", kind: "takeaway", status: "plan", plannedFor: T, slot: "main" }];
  assert.deepEqual(FT.pastToAsk(packs, T, 18), [T]);
});

test("from 5pm: nothing planned or already confirmed today -> nothing to ask", () => {
  assert.deepEqual(FT.pastToAsk([], T, 18), []);
  assert.deepEqual(FT.pastToAsk([plan(1, T, { status: "used" })], T, 18), []);
});

test("no hour given: works as before (past days only)", () => {
  assert.deepEqual(FT.pastToAsk([plan(1, "2026-10-08"), plan(2, T)], T), ["2026-10-08"]);
});

test("tomorrow's plan is never asked", () => {
  assert.deepEqual(FT.pastToAsk([plan(1, "2026-10-10")], T, 23), []);
});
