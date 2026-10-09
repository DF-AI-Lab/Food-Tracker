// Makes the TEST copy's data: a fresh food.db full of random food and meal history.
// Run with: node server/seed.js [folder]   (default: FoodTrackerTestData, next to the app folder)
// Every run deletes the old food.db in that folder, so you always get a clean test copy.
// Uses Node built-ins only (plus js/logic.js for date maths).
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const L = require("../js/logic.js");

const APP_DIR = path.join(__dirname, "..");

const MAINS = ["Chicken", "Sausages", "Mince", "Gammon", "Bacon", "Pork chops", "Salmon", "Lamb", "Beef burgers", "Turkey"];
const SIDES = ["Mash", "Chips", "Rice", "Tagliatelle", "Coleslaw", "Potatoes", "Pasta", "Yorkshire puddings"];
const VEG = ["Peas", "Carrots", "Broccoli", "Sweetcorn", "Green beans", "Cauliflower"];
const MISC = ["Milk", "Butter", "Cheese", "Yoghurt", "Ketchup", "Eggs"];
const SHOP_NAMES = ["Bread", "Bananas", "Washing-up liquid", "Oat milk", "Kitchen roll", "Tea bags", "Apples", "Onions"];

// Home meals, as [name, name, ...] in slot order (main, side, veg)
const COMBOS = [
  ...Array(3).fill(["Chicken", "Mash", "Peas"]),
  ...Array(2).fill(["Sausages", "Mash", "Peas"]),
  ...Array(2).fill(["Gammon", "Chips", "Peas"]),
  ...Array(2).fill(["Mince", "Tagliatelle"]),
  ["Salmon", "Rice", "Broccoli"]
];
const SLOTS = ["main", "side", "veg"];

function localToday() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function rnd(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// Fisher-Yates shuffle (returns a new array)
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// n names from the list, in random order (repeats only if n is longer than the list)
function pickNames(list, n) {
  const mixed = shuffle(list);
  return Array.from({ length: n }, (_, i) => mixed[i % mixed.length]);
}

// Same shape as the app's packs (see makePacks in js/logic.js), plus plan fields
function makePack({ name, kind, date = null, status = "in_fridge", added, frozen = null, plannedFor = null, slot = null }) {
  return {
    name, kind, date,
    dateType: date ? "use_by" : null,
    status,
    added,
    left: null,
    frozen,
    sub: null,
    price: null,
    plannedFor,
    slot
  };
}

function buildPacks(today) {
  // 30 in the fridge: 10 mains, 8 sides, 6 veg, 6 misc
  const specs = [
    ...pickNames(MAINS, 10).map(name => ({ name, kind: "main", dated: true })),
    ...pickNames(SIDES, 8).map(name => ({ name, kind: "side", dated: true })),
    ...pickNames(VEG, 6).map(name => ({ name, kind: "veg", dated: Math.random() < 0.2 })), // veg mostly undated
    ...pickNames(MISC, 6).map(name => ({ name, kind: "misc", dated: true }))
  ];

  // Dates from yesterday to two weeks ahead
  for (const s of specs.filter(s => s.dated)) s.offset = rnd(-1, 14);
  // Make sure some food is due soon (the "use soon" strip)
  const dated = specs.filter(s => s.dated);
  dated[0].offset = -1;
  dated.find(s => s.kind === "misc").offset = 1;

  // A past day with a main, side and veg planned (waiting for "Had this meal?")
  const mains = specs.filter(s => s.kind === "main");
  const sides = specs.filter(s => s.kind === "side");
  const vegs = specs.filter(s => s.kind === "veg");
  const past = L.addDays(today, -1);
  Object.assign(mains[0], { plannedFor: past, slot: "main" });
  Object.assign(sides[0], { plannedFor: past, slot: "side" });
  Object.assign(vegs[0], { plannedFor: past, slot: "veg" });
  // A main planned ahead
  Object.assign(mains[1], { plannedFor: L.addDays(today, 2), slot: "main" });

  const packs = specs.map(s => makePack({
    name: s.name,
    kind: s.kind,
    date: s.dated ? L.addDays(today, s.offset) : null,
    added: L.addDays(today, -rnd(1, 6)),
    plannedFor: s.plannedFor || null,
    slot: s.slot || null
  }));

  // 3 in the freezer, frozen some days ago
  const freezer = [["main", MAINS], ["side", SIDES], ["veg", VEG]];
  for (const [kind, list] of freezer) {
    const frozen = L.addDays(today, -rnd(2, 10));
    packs.push(makePack({
      name: pickNames(list, 1)[0],
      kind,
      status: "frozen",
      added: L.addDays(frozen, -1),
      frozen
    }));
  }
  return packs;
}

function buildMeals(today) {
  const monthStart = today.slice(0, 8) + "01";
  const thisMonth = d => (d < monthStart ? monthStart : d);

  // Home meals spread over the last 30 days
  const offsets = shuffle([2, 3, 6, 8, 11, 14, 17, 20, 23, 27]);
  const meals = COMBOS.map((names, i) => ({
    day: L.addDays(today, -offsets[i]),
    items: names.map((name, j) => ({ name, slot: SLOTS[j] })),
    takeaway: false,
    cost: null
  }));

  // Two takeaways this month, with costs
  meals.push({ day: thisMonth(L.addDays(today, -1)), items: [], takeaway: true, cost: 18.5 });
  meals.push({ day: thisMonth(L.addDays(today, -4)), items: [], takeaway: true, cost: 24 });

  return meals.sort((a, b) => a.day.localeCompare(b.day));
}

function buildShop(today) {
  return pickNames(SHOP_NAMES, 4).map(name => ({ name, got: false, del: null, auto: null, added: today }));
}

// Creates a fresh food.db in dataDir with random test data. Synchronous.
function seedData(dataDir, today = localToday()) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, "food.db");
  fs.rmSync(dbFile, { force: true }); // reset: throw away the old test data

  const db = new DatabaseSync(dbFile);
  try {
    // Same tables as server/server.js (withDb)
    db.exec("CREATE TABLE IF NOT EXISTS packs (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS shop (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS meals (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS ratings (name TEXT PRIMARY KEY, rating INTEGER NOT NULL)");

    const insert = (table, rows) => {
      const stmt = db.prepare(`INSERT INTO ${table} (data) VALUES (?)`);
      for (const row of rows) stmt.run(JSON.stringify(row));
    };
    insert("packs", buildPacks(today));
    insert("meals", buildMeals(today));
    insert("shop", buildShop(today));
  } finally {
    db.close();
  }
}

function defaultTestDir() {
  return path.join(path.dirname(APP_DIR), "FoodTrackerTestData");
}

module.exports = { seedData, defaultTestDir };

if (require.main === module) {
  seedData(process.argv[2] || defaultTestDir());
  console.log("Test data ready");
}
