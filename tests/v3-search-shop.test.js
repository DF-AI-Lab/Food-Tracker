// Search everywhere, one shopping line per food, Install app ✕ (Darren 2026-10-15) — run with: npm test
// Mock: docs/mockups/search-shop-install-mock.html
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

for (const dir of ["v2", "v2-next"]) {
  const FT = require(path.join(__dirname, "..", dir, "js", "logic.js"));
  const read = f => fs.readFileSync(path.join(__dirname, "..", dir, f), "utf8");

  test(`${dir}: searchPacks finds food in the fridge, freezer and cupboard`, () => {
    const packs = [
      { id: 1, name: "Chicken thighs", kind: "main", status: "in_fridge", date: "2026-10-16" },
      { id: 2, name: "Chicken", kind: "main", status: "frozen", frozen: "2026-10-01" },
      { id: 3, name: "Chicken stock", kind: "cupboard", status: "in_fridge", date: "2027-03-01" },
      { id: 4, name: "Chicken", kind: "main", status: "used" },
      { id: 5, name: "Milk", kind: "misc", status: "in_fridge", sub: "Chicken farm milk" },
      { id: 6, name: "Bacon", kind: "main", status: "in_fridge" },
    ];
    const r = FT.searchPacks(packs, " chick ");
    assert.deepEqual(r.map(x => [x.pack.id, x.place]), [[2, "Freezer"], [3, "Cupboard"], [1, "Fridge"], [5, "Fridge"]]);
    assert.deepEqual(FT.searchPacks(packs, ""), []);
    assert.deepEqual(FT.searchPacks(packs, "zzz"), []);
  });

  test(`${dir}: shopping list counts instead of repeating`, () => {
    const auto = FT.shopMerge({ name: "Chicken", auto: "used up", count: 1 }, "used up");
    assert.equal(auto.count, 2);
    assert.equal(FT.shopLabel(auto), "Chicken · 2 used");
    const typed = FT.shopMerge({ name: "Chicken", auto: "used up", count: 2 }, null);
    assert.equal(typed.auto, null, "typing it replaces the app's auto line");
    assert.equal(typed.count, 3);
    assert.equal(FT.shopLabel(typed), "Chicken · 3");
    assert.equal(FT.shopLabel({ name: "Bread" }), "Bread");
    assert.equal(FT.shopLabel({ name: "Milk", count: 2 }), "Milk · 2");
  });

  test(`${dir}: old repeated lines are folded into one`, () => {
    const shop = [
      { id: "a", name: "Chicken", auto: "used up" }, { id: "b", name: "chicken", auto: "used up" },
      { id: "c", name: "Milk" }, { id: "d", name: "Milk", got: true }, { id: "e", name: "Chicken", del: "2026-10-14" },
    ];
    const f = FT.foldShopRepeats(shop);
    assert.deepEqual(f.keep.map(i => [i.id, i.count]), [["a", 2]]);
    assert.deepEqual(f.remove, ["b"]);
  });

  test(`${dir}: page has the search bar, Install ✕ and Install in Settings`, () => {
    const html = read("index.html");
    assert.ok(html.indexOf('id="installBtn"') < html.indexOf('id="fridgeSearch"'));
    if (dir === "v2") {
      // Live v3.20 (Darren 2026-10-16): search sits on the title line, between the title and the count
      assert.ok(html.indexOf('id="pageTitle"') < html.indexOf('id="fridgeSearch"'));
      assert.ok(html.indexOf('id="fridgeSearch"') < html.indexOf('id="pageCount"'));
    } else {
      assert.ok(html.indexOf('id="fridgeSearch"') < html.indexOf('id="pageTitle"'));
    }
    for (const id of ["searchClear", "searchResults", "installHide", "settingsInstall"]) assert.match(html, new RegExp(`id="${id}"`), id);
    const app = read("js/app.js");
    assert.match(app, /FT\.searchPacks\(/);
    assert.match(app, /FT\.shopLabel\(/);
    assert.match(app, /FT\.shopMerge\(/);
    assert.match(app, /FT\.foldShopRepeats\(/);
    assert.match(read("js/pwa.js"), /installHidden/);
  });
}
