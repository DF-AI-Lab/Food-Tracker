// A food deleted from the fridge goes after 1 hour, like the shopping list (Darren 2026-10-16) — run with: npm test
// Live (v2/) and the V4 demo (demo/).
const test = require("node:test");
const assert = require("node:assert/strict");

const HOUR = 3600 * 1000;
const now = Date.UTC(2026, 9, 16, 12, 0, 0);
const today = "2026-10-16";

for (const dir of ["v2", "demo"]) {
  const FT = require(`../${dir}/js/logic.js`);

  test(`${dir}: markDeleted stamps the time`, () => {
    const d = FT.markDeleted({ id: 1, name: "Test", status: "in_fridge" }, today, now);
    assert.equal(d.status, "deleted");
    assert.equal(d.del, now);
  });

  test(`${dir}: the deleted list shows foods for 1 hour, newest first`, () => {
    const packs = [
      { id: 1, status: "deleted", del: now - 50 * 60 * 1000 },
      { id: 2, status: "deleted", del: now - 5 * 60 * 1000 },
      { id: 3, status: "deleted", del: now - HOUR - 1 },
      { id: 4, status: "deleted", del: "2026-10-16" },
      { id: 5, status: "in_fridge" },
    ];
    assert.deepEqual(FT.deletedList(packs, today, now).map(p => p.id), [2, 1]);
    assert.deepEqual(FT.expiredDeletes(packs, today, now).map(p => p.id).sort(), [3, 4]);
  });

  test(`${dir}: minutes left on a deleted food`, () => {
    assert.equal(FT.shopGoneIn({ del: now - 15 * 60 * 1000 }, now), 45);
  });
}
