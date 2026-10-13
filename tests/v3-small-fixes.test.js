// Small fixes, live v25 (Darren, 2026-10-13) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (dir, f) => fs.readFileSync(path.join(__dirname, "..", dir, f), "utf8");

for (const dir of ["v2", "v2-next"]) {
  test(`${dir}: Add opens on Quick fill, which sits left of One item`, () => {
    const html = read(dir, "index.html");
    const tabs = html.slice(html.indexOf('id="subTabs"'), html.indexOf('id="subTabs"') + 400);
    assert.ok(tabs.indexOf('data-sub="quick"') < tabs.indexOf('data-sub="fridge"'), "Quick fill first");
    assert.match(tabs, /data-sub="quick" class="sb on"/);
    assert.doesNotMatch(tabs, /data-sub="fridge" class="sb on"/);
    const app = read(dir, "js/app.js");
    const sw = app.slice(app.indexOf("function switchTab("), app.indexOf("function switchTab(") + 900);
    assert.match(sw, /tab === 'add'\) \{[\s\S]*?switchSub\('quick'\)/);
  });

  test(`${dir}: after a backup the reminder goes (this phone's own backup time counts)`, () => {
    const db = read(dir, "js/db-firestore.js");
    const fn = db.slice(db.indexOf("lastBackup() {"), db.indexOf("setLastBackup("));
    assert.match(fn, /Math\.max\(/, "newest of the shared entries and this phone's backup");
  });
}

// Home button with the app icon (mock B: docs/mockups/home-icon-mock.html) — demo first
test("v2-next: top bar = app icon + 'Food Tracker' + date line; tapping it goes home", () => {
  const html = read("v2-next", "index.html");
  const top = html.slice(html.indexOf('class="topbar"'), html.indexOf('class="pal"'));
  assert.match(top, /<button[^>]*id="homeBtn"/);
  assert.match(top, /<img[^>]*src="icons\/app-icon\.png"/);
  assert.match(top, /Food Tracker/);
  assert.match(top, /id="today"/);
  assert.match(top, /id="sync"/);
  const app = read("v2-next", "js/app.js");
  assert.match(app, /getElementById\('homeBtn'\)\.addEventListener\('click'/);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "v2-next", "icons", "app-icon.png")));
  assert.match(read("v2-next", "sw.js"), /"icons\/app-icon\.png"/, "works offline");
});

test("v2-next: the bell always shows, even alone in a household (Darren 2026-10-13)", () => {
  const app = read("v2-next", "js/app.js");
  assert.doesNotMatch(app, /getElementById\('bellBtn'\)\.hidden = alone/);
});
