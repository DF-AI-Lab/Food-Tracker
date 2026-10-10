// V2 step 5 sync rules (pure logic in v2/js/logic.js) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const FT = require(path.join(__dirname, "..", "v2", "js", "logic.js"));

test("sync sign: synced, waiting, offline", () => {
  assert.equal(FT.syncLabel({ online: true, waiting: 0 }), "✅ synced");
  assert.equal(FT.syncLabel({ online: true, waiting: 1 }), "⏳ 1 waiting");
  assert.equal(FT.syncLabel({ online: true, waiting: 3 }), "⏳ 3 waiting");
  assert.equal(FT.syncLabel({ online: false, waiting: 0 }), "📴 offline");
  assert.equal(FT.syncLabel({ online: false, waiting: 2 }), "📴 offline · 2 waiting");
});

test("undo allowed when nothing changed it since, or I changed it", () => {
  const current = { a: { id: "a", updatedBy: "me" }, b: { id: "b", updatedBy: "me" } };
  assert.equal(FT.undoBlocked(["a", "b"], current, "me"), false);
});

test("undo blocked when another phone changed it since", () => {
  const current = { a: { id: "a", updatedBy: "me" }, b: { id: "b", updatedBy: "other" } };
  assert.equal(FT.undoBlocked(["a", "b"], current, "me"), true);
});

test("undo blocked when another phone deleted it", () => {
  assert.equal(FT.undoBlocked(["a"], {}, "me"), true);
});

test("memory-only mode (no who-stamps, no uid) never blocks", () => {
  assert.equal(FT.undoBlocked(["a"], { a: { id: "a" } }, null), false);
});

test("the message is the one from the plan", () => {
  assert.equal(FT.UNDO_BLOCKED_MSG, "Changed on another phone, can't undo");
});
