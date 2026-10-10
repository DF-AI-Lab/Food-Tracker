// Tests for the V2 skeleton in v2/ (V2 step 2) — run with: npm test
// V2 is a static copy for GitHub Pages: no server, data kept in memory until step 4 (Firestore).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const V2 = path.join(__dirname, "..", "v2");
const read = f => fs.readFileSync(path.join(V2, f), "utf8");

test("v2 has its own copy of every app file", () => {
  for (const f of ["index.html", "css/style.css", "js/app.js", "js/logic.js", "js/omr.js", "js/db.js"]) {
    assert.ok(fs.existsSync(path.join(V2, f)), `v2/${f} should exist`);
  }
});

test("v2 index.html loads its files by relative path (works under /Food-Tracker/v2/)", () => {
  const html = read("index.html");
  for (const src of ["js/logic.js", "js/omr.js", "js/db.js", "js/app.js"]) {
    assert.ok(html.includes(`src="${src}"`), `should load ${src}`);
  }
  assert.ok(html.includes('href="css/style.css"'));
  assert.doesNotMatch(html, /(src|href)="\/(?!\/)/, "no root-absolute paths");
});

test("v2 logic and omr still load", () => {
  const FT = require(path.join(V2, "js/logic.js"));
  assert.equal(typeof FT, "object");
  const OMR = require(path.join(V2, "js/omr.js"));
  assert.equal(typeof OMR, "object");
});

// Load v2/js/db.js the way the browser does, with a fake window.
// Its objects come from another realm, so compare them as plain JSON.
function loadDB() {
  const window = {};
  vm.runInNewContext(read("js/db.js"), { window, console });
  return window.DB;
}
const plain = x => JSON.parse(JSON.stringify(x));

test("v2 db.js never calls the PC server", () => {
  assert.doesNotMatch(read("js/db.js"), /fetch\(|\/api\//);
});

test("v2 DB has the same shape as V1", () => {
  const DB = loadDB();
  assert.equal(typeof DB.open, "function");
  for (const s of [DB, DB.shop, DB.meals, DB.sheets]) {
    for (const fn of ["all", "get", "add", "put", "remove"]) assert.equal(typeof s[fn], "function");
  }
  assert.equal(typeof DB.ratings.all, "function");
  assert.equal(typeof DB.ratings.put, "function");
});

test("v2 DB starts empty and add / get / put / remove work", async () => {
  const DB = loadDB();
  await DB.open();
  assert.deepEqual(plain(await DB.all()), []);

  const id = await DB.add({ name: "Chicken", date: "2026-10-14" });
  assert.ok(id !== undefined && id !== null);
  assert.deepEqual(plain(await DB.get(id)), { id, name: "Chicken", date: "2026-10-14" });

  await DB.put({ id, name: "Chicken", date: "2026-10-15" });
  assert.equal((await DB.get(id)).date, "2026-10-15");
  assert.equal((await DB.all()).length, 1);

  await DB.remove(id);
  assert.deepEqual(plain(await DB.all()), []);
});

test("v2 DB lists are separate, and returned items are copies", async () => {
  const DB = loadDB();
  const a = await DB.add({ name: "Milk" });
  const b = await DB.shop.add({ name: "Bread" });
  assert.notEqual(a, b);
  assert.equal((await DB.all()).length, 1);
  assert.equal((await DB.shop.all()).length, 1);
  assert.equal((await DB.meals.all()).length, 0);

  const got = await DB.get(a);
  got.name = "changed";
  assert.equal((await DB.get(a)).name, "Milk");
});

test("v2 DB ratings are keyed by name", async () => {
  const DB = loadDB();
  await DB.ratings.put({ name: "Curry", rating: 1 });
  await DB.ratings.put({ name: "Curry", rating: -1 });
  assert.deepEqual(plain(await DB.ratings.all()), [{ name: "Curry", rating: -1 }]);
});

test("v2 has a version number the app shows (bumped on every merge)", () => {
  const window = {};
  vm.runInNewContext(read("js/version.js"), { window });
  assert.ok(Number.isInteger(window.FT_VERSION.n) && window.FT_VERSION.n > 0);
  assert.match(window.FT_VERSION.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(read("index.html").includes('src="js/version.js"'));
});
