// Merge raw/<size>-<n>.json helper answers into out/results-haiku-<size>.json (parsed like the app will).
const fs = require("fs");
const path = require("path");
const { parseReply } = require("./lib.js");

const out = path.join(__dirname, "out");
const sizes = {};
for (const f of fs.readdirSync(path.join(out, "raw"))) {
  const size = f.split("-")[0];
  const raw = JSON.parse(fs.readFileSync(path.join(out, "raw", f), "utf8"));
  sizes[size] = sizes[size] || {};
  for (const [file, answer] of Object.entries(raw)) {
    sizes[size][file] = parseReply(typeof answer === "string" ? answer : JSON.stringify(answer));
  }
}
for (const [size, results] of Object.entries(sizes)) {
  fs.writeFileSync(path.join(out, `results-haiku-${size}.json`), JSON.stringify(results, null, 2));
  console.log(size, Object.keys(results).length, "photos");
}
