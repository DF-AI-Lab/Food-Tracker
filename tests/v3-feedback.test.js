// Ideas & feedback in Settings (Darren 2026-10-15): jot ideas/problems while testing, copy them all into a Claude chat.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Demo first (Darren 2026-10-15): live v2/ gets it when it is swapped in — then add "v2" back here
for (const dir of ["v2", "v2-next"]) {
  const FT = require(path.join(__dirname, "..", dir, "js", "logic.js"));
  const read = f => fs.readFileSync(path.join(__dirname, "..", dir, f), "utf8");

  test(`${dir}: makeFeedback cleans the note and stamps it`, () => {
    const f = FT.makeFeedback("  Bar too fast  ", "problem", { by: "u1", name: "Darren", version: "v3.16", at: 1760000000000 });
    assert.deepEqual(f, { text: "Bar too fast", type: "problem", by: "u1", name: "Darren", version: "v3.16", at: 1760000000000 });
    assert.equal(FT.makeFeedback("   ", "idea", {}), null, "empty note is not saved");
    assert.equal(FT.makeFeedback("x", "nonsense", { at: 1 }).type, "idea", "unknown type = idea");
  });

  test(`${dir}: feedbackText = one plain list to paste into Claude, newest first`, () => {
    const items = [
      { text: "Kids version", type: "idea", name: "Darren", version: "v3.15", at: Date.UTC(2026, 9, 14, 9) },
      { text: "Bar too fast", type: "problem", name: "Sam", version: "v3.16", at: Date.UTC(2026, 9, 15, 9) },
    ];
    const t = FT.feedbackText(items, "v3.16");
    assert.equal(t.split("\n")[0], "Food Tracker ideas & feedback (app v3.16), 2 notes:");
    assert.match(t, /^- Problem: Bar too fast \(Thu 15 Oct, Sam, v3\.16\)$/m);
    assert.match(t, /^- Idea: Kids version \(Wed 14 Oct, Darren, v3\.15\)$/m);
    assert.ok(t.indexOf("Bar too fast") < t.indexOf("Kids version"), "newest first");
    assert.equal(FT.feedbackText([], "v3.16"), "");
  });

  test(`${dir}: stored with the household; Settings has the box, the list and the copy button`, () => {
    assert.match(read("js/db-firestore.js"), /const LISTS = \[[^\]]*"feedback"/);
    assert.match(read("js/db.js"), /feedback: store\("feedback"\)/);
    const html = read("index.html");
    for (const id of ["fbText", "fbIdea", "fbProblem", "fbList", "fbCopy"]) assert.match(html, new RegExp(`id="${id}"`), id);
    const app = read("js/app.js");
    assert.match(app, /DB\.feedback\.add\(/);
    assert.match(app, /FT\.feedbackText\(/);
    assert.match(app, /DB\.feedback\.remove\(/);
  });
}
