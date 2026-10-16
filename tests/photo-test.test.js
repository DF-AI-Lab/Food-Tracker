// Tests for tools/photo-test/lib.js (V3 photo test rig) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { parseReply, scoreOne, scoreRun, estimateTokens, costUSD } = require("../tools/photo-test/lib.js");

// ---- parseReply: model text → one clean entry, never a guess ----

test("parseReply reads plain JSON", () => {
  const r = parseReply('{"name":"Chicken","sub":"Asda whole chicken","date":"2026-10-14","bb":true,"price":4.5}');
  assert.equal(r.name, "Chicken");
  assert.equal(r.sub, "Asda whole chicken");
  assert.equal(r.date, "2026-10-14");
  assert.equal(r.bb, true);
  assert.equal(r.price, 4.5);
  assert.equal(r.needsCheck, false);
});

test("parseReply strips fences and chatter", () => {
  const r = parseReply('Here you go:\n```json\n{"name":"Milk","date":"2026-10-15"}\n```');
  assert.equal(r.name, "Milk");
  assert.equal(r.date, "2026-10-15");
});

test("parseReply blanks a badly formed date and flags it", () => {
  const r = parseReply('{"name":"Mince","date":"10 Oct"}');
  assert.equal(r.date, null);
  assert.equal(r.needsCheck, true);
});

test("parseReply blanks an impossible date", () => {
  assert.equal(parseReply('{"name":"Mince","date":"2026-02-31"}').date, null);
});

test("parseReply keeps noDate items without flagging them", () => {
  const r = parseReply('{"name":"Potatoes","noDate":true}');
  assert.equal(r.date, null);
  assert.equal(r.noDate, true);
  assert.equal(r.needsCheck, false);
});

test("parseReply treats text 'null' as no date", () => {
  assert.equal(parseReply('{"name":"Ham","date":"null"}').date, null);
});

test("parseReply drops a price that is not a number", () => {
  assert.equal(parseReply('{"name":"Ham","date":"2026-10-15","price":"cheap"}').price, null);
});

test("parseReply returns an error for unreadable text", () => {
  const r = parseReply("sorry, I can't read that");
  assert.ok(r.error);
  assert.equal(r.needsCheck, true);
});

// ---- scoreOne: right / blank / wrong ----

test("scoreOne: same date is right", () => {
  const s = scoreOne({ name: "Chicken", date: "2026-10-14" }, { name: "chicken", date: "2026-10-14" });
  assert.equal(s.date, "right");
  assert.equal(s.name, true);
});

test("scoreOne: missing date is blank, not wrong", () => {
  assert.equal(scoreOne({ name: "Chicken", date: "2026-10-14" }, { name: "Chicken", date: null }).date, "blank");
});

test("scoreOne: different date is wrong", () => {
  assert.equal(scoreOne({ name: "Chicken", date: "2026-10-14" }, { name: "Chicken", date: "2026-10-04" }).date, "wrong");
});

test("scoreOne: a date on a no-date item is wrong", () => {
  assert.equal(scoreOne({ name: "Potatoes", noDate: true }, { name: "Potatoes", date: "2026-10-14" }).date, "wrong");
});

test("scoreOne: no date on a no-date item is right", () => {
  assert.equal(scoreOne({ name: "Potatoes", noDate: true }, { name: "Potatoes", date: null }).date, "right");
});

test("scoreOne: best before vs use by is checked", () => {
  const s = scoreOne({ name: "Milk", date: "2026-10-15", bb: true }, { name: "Milk", date: "2026-10-15" });
  assert.equal(s.bb, false);
});

test("scoreOne: price must match when the answer key has one", () => {
  assert.equal(scoreOne({ name: "Ham", date: "2026-10-15", price: 2 }, { name: "Ham", date: "2026-10-15", price: 2 }).price, true);
  assert.equal(scoreOne({ name: "Ham", date: "2026-10-15", price: 2 }, { name: "Ham", date: "2026-10-15" }).price, false);
  assert.equal(scoreOne({ name: "Ham", date: "2026-10-15" }, { name: "Ham", date: "2026-10-15" }).price, true);
});

test("scoreOne: an error counts as blank", () => {
  assert.equal(scoreOne({ name: "Ham", date: "2026-10-15" }, { error: "API error 500" }).date, "blank");
});

// ---- scoreRun: totals for one run ----

test("scoreRun totals right, blank and wrong", () => {
  const expected = {
    "a.jpg": { name: "Chicken", date: "2026-10-14" },
    "b.jpg": { name: "Milk", date: "2026-10-15" },
    "c.jpg": { name: "Ham", date: "2026-10-16" },
    "d.jpg": { name: "Eggs", date: "2026-10-20" },
  };
  const results = {
    "a.jpg": { name: "Chicken", date: "2026-10-14" },
    "b.jpg": { name: "Milk", date: null },
    "c.jpg": { name: "Ham", date: "2026-10-06" },
    // d.jpg missing
  };
  const t = scoreRun(expected, results);
  assert.equal(t.total, 4);
  assert.equal(t.right, 1);
  assert.equal(t.blank, 2);
  assert.equal(t.wrong, 1);
  assert.equal(t.rows.length, 4);
  assert.equal(t.rows.find(r => r.file === "c.jpg").date, "wrong");
});

// ---- cost helpers ----

test("estimateTokens: small photo is width x height / 750", () => {
  assert.equal(estimateTokens(1000, 750), 1000);
});

test("estimateTokens: big phone photo is capped like the API does", () => {
  const t = estimateTokens(4000, 3000);
  assert.ok(t >= 1500 && t <= 1600, `got ${t}`);
});

test("costUSD uses price per million tokens", () => {
  const c = costUSD({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, { in: 1, out: 5 });
  assert.equal(c, 6);
});

// ---- photos never go in the repo ----

test("test photos and results are git-ignored", () => {
  const root = path.join(__dirname, "..");
  for (const p of ["tools/photo-test/photos/a.jpg", "tools/photo-test/out/1000/a.jpg", "Food test photos/968.jpg", "Food test photos/results-api-x.json"]) {
    try {
      execFileSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: root });
    } catch {
      assert.fail(`${p} should be ignored`);
    }
  }
});

// ---- veg: kind "veg", never a date (the app counts from the day it goes in) ----

test("parseReply keeps kind veg and does not flag it", () => {
  const r = parseReply('{"name":"Carrots","kind":"veg"}');
  assert.equal(r.kind, "veg");
  assert.equal(r.date, null);
  assert.equal(r.needsCheck, false);
});

test("parseReply drops a date on a veg item", () => {
  assert.equal(parseReply('{"name":"Carrots","kind":"veg","date":"2026-10-23"}').date, null);
});

test("parseReply ignores an unknown kind", () => {
  assert.equal(parseReply('{"name":"Ham","kind":"meat","date":"2026-10-15"}').kind, null);
});

test("scoreOne: veg must come back as veg", () => {
  assert.equal(scoreOne({ name: "Carrots", kind: "veg" }, { name: "Carrots", kind: "veg", date: null }).kind, true);
  assert.equal(scoreOne({ name: "Carrots", kind: "veg" }, { name: "Carrots", date: null }).kind, false);
  assert.equal(scoreOne({ name: "Ham", date: "2026-10-15" }, { name: "Ham", date: "2026-10-15" }).kind, true);
});

test("parseReply: veg is never best before", () => {
  assert.equal(parseReply('{"name":"Peppers","kind":"veg","bb":true}').bb, false);
});
