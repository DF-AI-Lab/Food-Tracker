// Tests for js/omr.js (reading ✕ marks off a photo of the printed sheet) — run with: npm test
// The photos are real phone photos of one printed sheet (SHEET 0910-1210), marked by hand.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const OMR = require("../js/omr.js");

const DIR = path.join(__dirname, "fixtures", "sheets");
const layout = JSON.parse(fs.readFileSync(path.join(DIR, "layout.json"), "utf8"));
const truth = JSON.parse(fs.readFileSync(path.join(DIR, "truth.json"), "utf8"));

// Read a gzipped binary PGM (P5) into { gray, width, height }
function loadPgm(name) {
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(DIR, name + ".pgm.gz")));
  const parts = [];
  let i = 0;
  while (parts.length < 4) {
    while (/\s/.test(String.fromCharCode(buf[i]))) i++;
    let s = "";
    while (!/\s/.test(String.fromCharCode(buf[i]))) s += String.fromCharCode(buf[i++]);
    parts.push(s);
  }
  i++; // one whitespace after maxval
  const width = Number(parts[1]), height = Number(parts[2]);
  return { gray: new Uint8Array(buf.buffer, buf.byteOffset + i, width * height), width, height };
}

const expected = (marks, no) => {
  const m = marks[no] || "";
  return { u: m.includes("u"), p: m.includes("p"), b: m.includes("b") };
};

test("layoutFromRects: box positions relative to the 4 corner marks", () => {
  const sq = (x, y) => ({ x: x - 5, y: y - 5, w: 10, h: 10 }); // centred on x,y
  const corners = { tl: sq(100, 100), tr: sq(300, 100), bl: sq(100, 500), br: sq(300, 500) };
  const rows = [{ no: "01", id: 7, name: "Milk", boxes: [{ x: 150, y: 200, w: 20, h: 40 }, { x: 200, y: 200, w: 20, h: 40 }, { x: 250, y: 200, w: 20, h: 40 }] }];
  const out = OMR.layoutFromRects(corners, rows);
  assert.deepEqual(out, [{ no: "01", id: 7, name: "Milk", boxes: [[0.25, 0.25, 0.1, 0.1], [0.5, 0.25, 0.1, 0.1], [0.75, 0.25, 0.1, 0.1]] }]);
});

test("readSheet: a blank image has no sheet in it", () => {
  const w = 300, h = 400;
  const r = OMR.readSheet({ gray: new Uint8Array(w * h).fill(230), width: w, height: h }, layout.rows);
  assert.equal(r.ok, false);
});

// The real test: 5 photos, every U / P / B box of every row.
// A few misses are allowed (the user checks everything on "Changes found"), but not many.
const results = {};
for (const name of Object.keys(truth)) {
  test(`readSheet: ${name} finds the sheet and reads the boxes`, () => {
    const r = OMR.readSheet(loadPgm(name), layout.rows);
    assert.equal(r.ok, true, "sheet corners found");
    let errors = [];
    for (const row of layout.rows) {
      const got = r.marks[row.no];
      assert.ok(got, "row " + row.no + " read");
      const want = expected(truth[name], row.no);
      for (const k of ["u", "p", "b"]) if (!!got[k] !== want[k]) errors.push(`${row.no}${k}:${got[k] ? "marked" : "empty"}`);
    }
    results[name] = errors;
    assert.ok(errors.length <= 1, `${name}: ${errors.length} wrong boxes: ${errors.join(", ")}`);
  });
}

test("readSheet: at most 2 wrong boxes over all 5 photos (390 boxes)", () => {
  assert.equal(Object.keys(results).length, 5, "all 5 photos were read");
  const all = Object.values(results).flat();
  assert.ok(all.length <= 2, `${all.length} wrong: ${all.join(", ")}`);
});
