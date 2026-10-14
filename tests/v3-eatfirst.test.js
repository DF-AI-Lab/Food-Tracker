// Eat first: "+2 more soon" opens the full list, "Show less" closes it (Darren 2026-10-14) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const TODAY = "2026-10-10";
const day = n => { const d = new Date(TODAY + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pack = (id, name, n) => ({ id, name, date: day(n), status: "in_fridge" });

for (const dir of ["v2", "v2-next"]) {
  const LOOK = require(path.join(__dirname, "..", dir, "js", "look.js"));
  const read = f => fs.readFileSync(path.join(__dirname, "..", dir, f), "utf8");

  test(`${dir}: eatFirst(…, all) gives every soon item; 'more' still counts the hidden ones`, () => {
    const packs = [pack("a", "A", 0), pack("b", "B", 1), pack("c", "C", 1), pack("d", "D", 2), pack("e", "E", 2), pack("f", "F", 6)];
    const short = LOOK.eatFirst(packs, TODAY);
    assert.equal(short.lines.length, 3);
    assert.equal(short.more, 2);
    const all = LOOK.eatFirst(packs, TODAY, true);
    assert.deepEqual(all.lines.map(l => l.id), ["a", "b", "c", "d", "e"]);
    assert.equal(all.more, 2);
  });

  test(`${dir}: page has a tappable "+N more soon" / "Show less" button`, () => {
    assert.match(read("index.html"), /<button[^>]*id="useSoonMore"/);
    const app = read("js/app.js");
    assert.match(app, /getElementById\('useSoonMore'\)\.addEventListener\('click'/);
    assert.match(app, /'Show less'/);
    assert.match(app, /LOOK\.eatFirst\(packs, today, eatAll\)/);
  });
}
