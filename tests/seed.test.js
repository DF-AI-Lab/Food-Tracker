// Tests for server/seed.js (random test data) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { seedData } = require("../server/seed.js");
const { startServer } = require("../server/server.js");
const L = require("../js/logic.js");

const TODAY = "2026-10-09";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ft-seed-"));

async function readAll(dataDir) {
  const srv = await startServer({ port: 0, dataDir });
  const get = async u => (await fetch(`http://localhost:${srv.port}${u}`)).json();
  try {
    return { packs: await get("/api/packs"), meals: await get("/api/meals"), shop: await get("/api/shop"), info: await get("/api/info") };
  } finally { await srv.close(); }
}

test("seedData fills a test data folder with lots of random food and history", async () => {
  const dir = tmp();
  seedData(dir, TODAY);
  const { packs, meals } = await readAll(dir);
  const fridge = packs.filter(p => p.status === "in_fridge");
  assert.ok(fridge.length >= 20, "lots in the fridge");
  for (const k of ["main", "side", "veg", "misc"]) assert.ok(fridge.some(p => p.kind === k), "has " + k);
  assert.ok(packs.some(p => p.status === "frozen"), "something in the freezer");
  assert.ok(fridge.some(p => p.date && L.daysLeft(p.date, TODAY) <= 2), "something to use soon");
  // meal history with repeated combos -> meal ideas show
  assert.ok(meals.length >= 8);
  assert.ok(L.mealIdeas(meals, packs).length >= 3);
  assert.ok(meals.some(m => m.takeaway && m.cost > 0), "a takeaway with a cost");
  // a past day waiting for "Had this meal?" and something planned ahead
  assert.ok(L.pastToAsk(packs, TODAY).length >= 1);
  assert.ok(packs.some(p => p.plannedFor && p.plannedFor > TODAY));
});

test("seedData resets: running it again replaces the old data", async () => {
  const dir = tmp();
  seedData(dir, TODAY);
  const first = (await readAll(dir)).packs.length;
  seedData(dir, TODAY);
  const second = (await readAll(dir)).packs.length;
  assert.ok(second <= first + 5 && second >= 20, "not doubled up");
});

test("/api/info says whether this is the test copy", async () => {
  const dir = tmp();
  const srv = await startServer({ port: 0, dataDir: dir, test: true });
  try {
    const info = await (await fetch(`http://localhost:${srv.port}/api/info`)).json();
    assert.equal(info.test, true);
  } finally { await srv.close(); }
  const real = await startServer({ port: 0, dataDir: dir });
  try {
    const info = await (await fetch(`http://localhost:${real.port}/api/info`)).json();
    assert.equal(info.test, false);
  } finally { await real.close(); }
});
