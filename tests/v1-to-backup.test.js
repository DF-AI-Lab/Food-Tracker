// V2 step 10: turn the V1 PC database (food.db) into a V2 backup file, to load with ⬆️ Restore.
// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { seedData } = require("../server/seed.js");
const { convertDb } = require("../tools/v1-to-backup.js");
const FT = require("../v2/js/logic.js");

const MADE = "2026-10-11T19:00:00.000Z";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ft-v1-"));

// A V1 data folder with lots of random food, plus a rating and a printed sheet
function v1Folder() {
  const dir = tmp();
  seedData(dir, "2026-10-11");
  const db = new DatabaseSync(path.join(dir, "food.db"));
  db.exec("CREATE TABLE IF NOT EXISTS ratings (name TEXT PRIMARY KEY, rating INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS sheets (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
  db.prepare("INSERT INTO ratings (name, rating) VALUES (?, ?)").run("Chicken", 1);
  db.prepare("INSERT INTO sheets (data) VALUES (?)").run(JSON.stringify({ code: "1010-1200", rows: [] }));
  const counts = {
    packs: db.prepare("SELECT COUNT(*) AS n FROM packs").get().n,
    shop: db.prepare("SELECT COUNT(*) AS n FROM shop").get().n,
    meals: db.prepare("SELECT COUNT(*) AS n FROM meals").get().n,
  };
  db.close();
  return { dir, file: path.join(dir, "food.db"), counts };
}

test("everything comes across: packs (all statuses), shop, meals, ratings", () => {
  const { file, counts } = v1Folder();
  const b = convertDb(file, MADE);
  assert.equal(b.app, "food-tracker-v2");
  assert.equal(b.made, MADE);
  assert.equal(b.packs.length, counts.packs);
  assert.equal(b.shop.length, counts.shop);
  assert.equal(b.meals.length, counts.meals);
  assert.deepEqual(b.ratings, [{ name: "Chicken", rating: 1 }]);
  assert.ok(b.packs.some(p => p.status === "in_fridge"));
  assert.ok(b.packs.some(p => p.status !== "in_fridge"), "history kept too (used, binned, frozen)");
});

test("old printed sheets are left behind (they can't be scanned in V2)", () => {
  const { file } = v1Folder();
  assert.deepEqual(convertDb(file, MADE).sheets, []);
});

test("ids become text, unique per list (cloud doc ids)", () => {
  const { file } = v1Folder();
  const b = convertDb(file, MADE);
  for (const list of ["packs", "shop", "meals"]) {
    const ids = b[list].map(x => x.id);
    assert.ok(ids.every(id => typeof id === "string" && id.length > 0), list);
    assert.equal(new Set(ids).size, ids.length, list + " ids unique");
  }
  assert.match(b.packs[0].id, /^v1-p\d+$/);
});

test("the fields of each pack are kept as they were", () => {
  const { file } = v1Folder();
  const db = new DatabaseSync(file, { readOnly: true });
  const row = db.prepare("SELECT id, data FROM packs ORDER BY id LIMIT 1").get();
  db.close();
  const b = convertDb(file, MADE);
  const { id, ...rest } = b.packs[0];
  assert.equal(id, "v1-p" + row.id);
  assert.deepEqual(rest, JSON.parse(row.data));
});

test("the result is a backup V2's Restore accepts", () => {
  const { file } = v1Folder();
  const r = FT.readBackup(JSON.stringify(convertDb(file, MADE)));
  assert.equal(r.ok, true);
});

test("food.db is only read, never changed", () => {
  const { file } = v1Folder();
  const before = fs.readFileSync(file);
  convertDb(file, MADE);
  assert.deepEqual(fs.readFileSync(file), before);
});

test("a food.db without ratings or sheets tables still works", () => {
  const dir = tmp();
  seedData(dir, "2026-10-11");
  const db = new DatabaseSync(path.join(dir, "food.db"));
  db.exec("DROP TABLE IF EXISTS ratings; DROP TABLE IF EXISTS sheets");
  db.close();
  const b = convertDb(path.join(dir, "food.db"), MADE);
  assert.deepEqual(b.ratings, []);
});

test("command line: writes the file next to food.db and says what it copied", () => {
  const { dir, file, counts } = v1Folder();
  const out = execFileSync(process.execPath, [path.join(__dirname, "..", "tools", "v1-to-backup.js"), file], { encoding: "utf8" });
  const files = fs.readdirSync(dir).filter(f => /^food-backup-from-v1-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  assert.equal(files.length, 1);
  const b = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
  assert.equal(b.packs.length, counts.packs);
  assert.match(out, new RegExp(`${counts.packs} packs`));
  assert.match(out, /in the fridge/);
  assert.match(out, new RegExp(files[0].replace(/\./g, "\\.")));
});

test("command line: a missing file says so, no crash dump", () => {
  let err;
  try {
    execFileSync(process.execPath, [path.join(__dirname, "..", "tools", "v1-to-backup.js"), path.join(tmp(), "nope.db")], { encoding: "utf8", stdio: "pipe" });
  } catch (e) { err = e; }
  assert.ok(err, "exits with an error");
  assert.match(err.stderr, /Can't find/);
  assert.doesNotMatch(err.stderr, /at Object\./);
});
