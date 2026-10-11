// Turn the V1 app's database (food.db) into a V2 backup file (V2 step 10, one-off).
// Usage: node v1-to-backup.js "C:\path\to\FoodTrackerData\food.db"
// Writes food-backup-from-v1-<date>.json next to food.db. Next step: open V2,
// go to ⚙️ Settings → ⬆️ Restore, and pick that file.
// food.db is opened read-only and never changed. Node built-ins only (node:sqlite, node:fs, node:path).
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const USAGE = 'Usage: node v1-to-backup.js "C:\\path\\to\\FoodTrackerData\\food.db"';

// Read the rows of one V1 list table, or [] if the table is missing.
function readList(db, table, prefix) {
  const found = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!found) return [];
  return db
    .prepare(`SELECT id, data FROM ${table} ORDER BY id`)
    .all()
    .map(row => ({ ...JSON.parse(row.data), id: prefix + row.id }));
}

// Build the V2 backup object from a V1 food.db file.
function convertDb(dbFile, madeIso) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const packs = readList(db, "packs", "v1-p");
    const shop = readList(db, "shop", "v1-s");
    const meals = readList(db, "meals", "v1-m");
    const hasRatings = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ratings'").get();
    const ratings = hasRatings
      ? db.prepare("SELECT name, rating FROM ratings ORDER BY name").all().map(r => ({ name: r.name, rating: r.rating }))
      : [];
    return { app: "food-tracker-v2", made: madeIso, packs, shop, meals, sheets: [], ratings };
  } finally {
    db.close();
  }
}

// Local date as YYYY-MM-DD (not UTC), for the file name.
function localDate(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = { convertDb };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`Can't find ${file}`);
    console.error(USAGE);
    process.exit(1);
  }
  try {
    const now = new Date();
    const backup = convertDb(file, now.toISOString());
    const out = path.join(path.dirname(file), `food-backup-from-v1-${localDate(now)}.json`);
    fs.writeFileSync(out, JSON.stringify(backup, null, 2));
    const inFridge = backup.packs.filter(p => p.status === "in_fridge").length;
    console.log(
      `Copied ${backup.packs.length} packs (${inFridge} in the fridge), ${backup.shop.length} shop items, ${backup.meals.length} meals, ${backup.ratings.length} ratings.`
    );
    console.log(`Saved: ${out}`);
    console.log("Next: open V2 → ⚙️ Settings → ⬆️ Restore → pick this file.");
  } catch (e) {
    console.error(`Couldn't convert ${file}: ${e.message}`);
    process.exit(1);
  }
}
