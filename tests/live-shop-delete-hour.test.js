// Live app (v2/): a deleted shopping item goes after 1 hour, not next day (Darren's note, 16 Oct) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const FT = require("../v2/js/logic.js");

const HOUR = 3600 * 1000;
const now = Date.UTC(2026, 9, 16, 12, 0, 0);

test("deleted items are kept for 1 hour, then removed", () => {
  const items = [
    { id: 1, name: "Milk", del: now - 30 * 60 * 1000 },
    { id: 2, name: "Bread", del: now - HOUR - 1 },
    { id: 3, name: "Eggs", del: null },
  ];
  assert.deepEqual(FT.expiredShopDeletes(items, "2026-10-16", now).map(i => i.id), [2]);
});

test("old items deleted under the day rule (a date) go too", () => {
  const items = [{ id: 1, name: "Milk", del: "2026-10-16" }, { id: 2, name: "Jam", del: "2026-10-15" }];
  assert.deepEqual(FT.expiredShopDeletes(items, "2026-10-16", now).map(i => i.id), [1, 2]);
});

test("goneIn: minutes left for a deleted item (at least 1)", () => {
  assert.equal(FT.shopGoneIn({ del: now - 15 * 60 * 1000 }, now), 45);
  assert.equal(FT.shopGoneIn({ del: now - HOUR + 10 * 1000 }, now), 1);
  assert.equal(FT.shopGoneIn({ del: "2026-10-16" }, now), 0);
});
