// Score results files against the answer key.
// Usage: node tools/photo-test/score.js <expected.json> <results.json> [more results.json...]
// Exit code 1 if any run has a wrong date.
const fs = require("node:fs");
const path = require("node:path");
const { scoreRun } = require("./lib.js");

const shown = (e) => (e.noDate || !e.date ? "no date" : e.date);

function main(args) {
  const [expFile, ...resFiles] = args;
  if (!expFile || resFiles.length === 0) {
    console.log("usage: node tools/photo-test/score.js <expected.json> <results.json> [more results.json...]");
    return 1;
  }
  const expected = JSON.parse(fs.readFileSync(expFile, "utf8"));
  let failed = false;
  for (const file of resFiles) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    // run-api.js saves { settings, cost, results }; older files are the results object itself.
    const run = data && typeof data.results === "object" && data.results !== null ? data.results : data;
    const t = scoreRun(expected, run);
    const T = t.total;
    console.log(`${path.basename(file)}  ✅ right ${t.right}  ⚪ blank ${t.blank}  ❌ WRONG ${t.wrong}  names ${t.nameRight}/${T}  no brand ${t.brandFreeRight}/${T}  veg ${t.kindRight}/${T}  bb ${t.bbRight}/${T}  price ${t.priceRight}/${T}`);
    for (const r of t.rows) {
      if (!r.name && r.got.name != null) console.log(`  🏷 ${r.file}: expected ${[].concat(r.expected.name)[0]}, got ${r.got.name}`);
      if (r.date === "wrong") console.log(`  ❌ ${r.file}: expected ${shown(r.expected)}, got ${r.got.date}`);
      else if (r.date === "blank") console.log(`  ⚪ ${r.file}: expected ${shown(r.expected)}, got blank`);
    }
    if (t.wrong > 0) failed = true;
  }
  return failed ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main };
