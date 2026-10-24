// Added today in 3 tabs: Added today / No date / Use in 3 days (Darren 2026-10-24) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../demo/js/logic.js");

const T = "2026-10-24";
const pack = (id, name, kind, extra = {}) => ({ id, name, kind, status: "in_fridge", date: null, added: T, ...extra });
const packs = [
  pack(1, "Bacon", "main", { date: "2026-11-14" }),
  pack(2, "Mince", "main", { date: "2026-10-27" }),        // 3 days: counts (24th + 3 = 27th)
  pack(3, "Ham", "misc", { date: "2026-10-26" }),          // 2 days: counts
  pack(12, "Ribs", "main", { date: "2026-10-28" }),        // 4 days: not soon
  pack(13, "Pie", "main", { date: "2026-10-22" }),         // already out: counts
  pack(4, "Cheese sauce", "side"),                         // no date, not veg
  pack(5, "Carrots", "veg"),                               // veg: never in No date
  pack(6, "Yoghurt", "misc", { dateMissing: true }),       // no date
  pack(7, "Bread", "cupboard"),                            // cupboard: not in No date
  pack(8, "Peas", "veg", { status: "frozen" }),
  pack(9, "Old ham", "main", { added: "2026-10-20" }),     // not today
  pack(10, "Chips", "side", { status: "frozen" }),          // freezer: no date is fine
  pack(11, "Steak", "main", { date: "2026-11-02", status: "used" }),
];

test("addedNoDate: added today, in the fridge, no date, mains / sides / other only", () => {
  assert.deepEqual(FT.addedNoDate(packs, T).map(p => p.id), [4, 6]);
});

test("addedLater: added today, to use within 3 days (out of date too)", () => {
  assert.deepEqual(FT.addedLater(packs, T).map(p => p.id), [2, 13, 3]);
  assert.deepEqual(FT.addedLater([], T), []);
});
