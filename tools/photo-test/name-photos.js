// Rename Drive test photos to pNN.jpg using pack-facts.json (drive name -> key).
// Usage: node tools/photo-test/name-photos.js <photoFolder>
// Files not in the facts are listed as unknown (new photos Claude has not read yet).
const fs = require("node:fs");
const path = require("node:path");

// Map each file name to its key, in the order the files are given.
function renamePlan(fileNames, facts) {
  const keyByDrive = new Map();
  for (const [key, f] of Object.entries(facts.photos || {})) keyByDrive.set(f.drive, key);
  const moves = [];
  const unknown = [];
  for (const name of fileNames) {
    if (keyByDrive.has(name)) moves.push([name, keyByDrive.get(name)]);
    else unknown.push(name);
  }
  return { moves, unknown };
}

function main(args) {
  const [folder] = args;
  if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.log("usage: node tools/photo-test/name-photos.js <photoFolder>");
    return 1;
  }
  const facts = JSON.parse(fs.readFileSync(path.join(__dirname, "pack-facts.json"), "utf8"));
  const names = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort();
  const plan = renamePlan(names, facts);
  let renamed = 0;
  for (const [from, to] of plan.moves) {
    const target = path.join(folder, to);
    if (fs.existsSync(target)) {
      console.log(`skip ${from}: ${to} already exists`);
      continue;
    }
    fs.renameSync(path.join(folder, from), target);
    renamed++;
  }
  console.log(`Renamed ${renamed}, unknown: ${plan.unknown.length ? plan.unknown.join(", ") : "none"}`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { renamePlan, main };
