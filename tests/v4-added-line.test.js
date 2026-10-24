// Fridge rows: "added Mon 19 Oct · 5 days ago" under the line (Darren 2026-10-24) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

test("addedLine: today", () => {
  assert.equal(FT.addedLine("2026-10-24", "2026-10-24"), "added today");
});
test("addedLine: 1 day ago", () => {
  assert.equal(FT.addedLine("2026-10-23", "2026-10-24"), "added Fri 23 Oct · 1 day ago");
});
test("addedLine: 5 days ago", () => {
  assert.equal(FT.addedLine("2026-10-19", "2026-10-24"), "added Mon 19 Oct · 5 days ago");
});
test("addedLine: no added date gives empty", () => {
  assert.equal(FT.addedLine(null, "2026-10-24"), "");
});
