// V4 shopping match: photo test rig scores the new names (main food + cut, no brand) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scoreOne, scoreRun, buildPrompt } = require("../tools/photo-test/lib.js");

const dir = path.join(__dirname, "../tools/photo-test");

test("scoreOne: name can be a list of OK names", () => {
  const e = { name: ["Beef mince", "Steak mince"], date: "2026-10-18" };
  assert.equal(scoreOne(e, { name: "Steak mince", date: "2026-10-18" }).name, true);
  assert.equal(scoreOne(e, { name: "beef mince", date: "2026-10-18" }).name, true);
  assert.equal(scoreOne(e, { name: "Mince", date: "2026-10-18" }).name, false);
});

test("scoreOne: a shop or brand in the name fails brandFree", () => {
  const e = { name: "Whole chicken", date: "2026-10-10" };
  assert.equal(scoreOne(e, { name: "Whole chicken" }).brandFree, true);
  assert.equal(scoreOne(e, { name: "Asda whole chicken" }).brandFree, false);
  assert.equal(scoreOne(e, { name: "M&S scotch eggs" }).brandFree, false);
  assert.equal(scoreOne(e, {}).brandFree, true);
});

test("scoreRun counts brand-free names", () => {
  const t = scoreRun(
    { "a.jpg": { name: "Whole chicken" }, "b.jpg": { name: "Beef mince" } },
    { "a.jpg": { name: "Asda whole chicken" }, "b.jpg": { name: "Beef mince" } },
  );
  assert.equal(t.brandFreeRight, 1);
});

test("prompt keeps the cut in the name and the brand out", () => {
  const p = buildPrompt(["Chicken"], 2026, "prompt-v4.txt");
  assert.doesNotMatch(p, /No brand, size, "fillets"/);
  assert.match(p, /Chicken fillets/);
  assert.match(p, /Whole chicken/);
  assert.match(p, /never the shop or brand/i);
});

test("V3 prompt is still the default", () => {
  assert.match(buildPrompt(["Chicken"], 2026), /No brand, size, "fillets"/);
});

test("run-api takes --prompt", () => {
  const { parseArgs } = require("../tools/photo-test/run-api.js");
  assert.equal(parseArgs(["photos", "--prompt", "prompt-v4.txt"]).prompt, "prompt-v4.txt");
  assert.equal(parseArgs(["photos"]).prompt, "prompt.txt");
});

test("V4 answer key: same photos as V3, new names, no brands", () => {
  const v3 = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
  const v4 = JSON.parse(fs.readFileSync(path.join(dir, "expected-v4.json"), "utf8"));
  assert.deepEqual(Object.keys(v4), Object.keys(v3));
  for (const [file, e] of Object.entries(v4)) {
    const names = [].concat(e.name);
    for (const n of names) assert.equal(scoreOne(e, { name: n }).brandFree, true, `${file}: ${n}`);
    assert.equal(e.date, v3[file].date, `${file}: date unchanged`);
  }
  assert.deepEqual([].concat(v4["p05.jpg"].name)[0], "Whole chicken");
  assert.deepEqual([].concat(v4["p02.jpg"].name)[0], "Beef mince");
});
