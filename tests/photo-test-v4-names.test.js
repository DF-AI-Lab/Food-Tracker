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

test("V4 answer key: V3 photos plus new ones, new names, no brands", () => {
  const v3 = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
  const v4 = JSON.parse(fs.readFileSync(path.join(dir, "expected-v4.json"), "utf8"));
  for (const file of Object.keys(v3)) assert.ok(v4[file], `${file} kept`);
  for (const [file, e] of Object.entries(v4)) {
    const names = [].concat(e.name);
    for (const n of names) assert.equal(scoreOne(e, { name: n }).brandFree, true, `${file}: ${n}`);
    if (v3[file]) assert.equal(e.date, v3[file].date, `${file}: date unchanged`);
  }
  assert.deepEqual([].concat(v4["p05.jpg"].name)[0], "Whole chicken");
  assert.deepEqual([].concat(v4["p02.jpg"].name)[0], "Beef mince");
});

test("pack facts: one entry per V4 photo, with its Drive name and the same answer", () => {
  const v4 = JSON.parse(fs.readFileSync(path.join(dir, "expected-v4.json"), "utf8"));
  const { photos } = JSON.parse(fs.readFileSync(path.join(dir, "pack-facts.json"), "utf8"));
  assert.deepEqual(Object.keys(photos).sort(), Object.keys(v4).sort());
  const drives = new Set();
  for (const [file, f] of Object.entries(photos)) {
    assert.ok(f.drive && f.printed, `${file}: drive + printed`);
    assert.deepEqual(f.answer, v4[file], `${file}: answer matches key`);
    drives.add(f.drive);
  }
  assert.equal(drives.size, Object.keys(photos).length, "each Drive photo used once");
});

test("name-photos: renames Drive files to p01.jpg… and skips unknown ones", () => {
  const os = require("node:os");
  const { renamePlan } = require("../tools/photo-test/name-photos.js");
  const facts = { photos: { "p01.jpg": { drive: "968.jpg" }, "p02.jpg": { drive: "a(0).jpg" } } };
  const plan = renamePlan(["968.jpg", "a(0).jpg", "other.jpg"], facts);
  assert.deepEqual(plan.moves, [["968.jpg", "p01.jpg"], ["a(0).jpg", "p02.jpg"]]);
  assert.deepEqual(plan.unknown, ["other.jpg"]);
});

test("V4 answer key accepts Gammon (p01) and Sour cream dip (p40)", () => {
  const v4 = JSON.parse(fs.readFileSync(path.join(dir, "expected-v4.json"), "utf8"));
  assert.equal(scoreOne(v4["p01.jpg"], { name: "Gammon" }).name, true);
  assert.equal(scoreOne(v4["p40.jpg"], { name: "Sour cream dip" }).name, true);
});

test("prompt keeps the veg type and drops product names", () => {
  const p = buildPrompt(["Potatoes"], 2026, "prompt-v4.txt");
  assert.match(p, /Baking potatoes/);
  assert.match(p, /Yoghurts/);
  assert.match(p, /Yoghurt corner/);
});

test("score.js reads a run-api results file (results inside { settings, cost, results })", () => {
  const os = require("node:os");
  const { main } = require("../tools/photo-test/score.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "score-"));
  const exp = path.join(tmp, "e.json");
  const res = path.join(tmp, "r.json");
  fs.writeFileSync(exp, JSON.stringify({ "a.jpg": { name: "Beef mince", date: "2026-10-18" } }));
  fs.writeFileSync(res, JSON.stringify({ settings: {}, cost: {}, results: { "a.jpg": { name: "Beef mince", date: "2026-10-18" } } }));
  const lines = [];
  const log = console.log;
  console.log = (s) => lines.push(String(s));
  try { assert.equal(main([exp, res]), 0); } finally { console.log = log; }
  assert.match(lines[0], /right 1 .*names 1\/1/);
});

test("prompt keeps the cut over a short app name, and veg type only when the packet says it", () => {
  const p = buildPrompt(["Bacon", "Sausages", "Potatoes"], 2026, "prompt-v4.txt");
  assert.match(p, /"Smoked back bacon", not "Bacon"/);
  assert.match(p, /"Pork chipolatas", not "Sausages"/);
  assert.match(p, /only when the packet/i);
});
