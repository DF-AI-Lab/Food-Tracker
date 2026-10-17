// The new live app at /Food-Tracker/live/ (Darren 2026-10-17): V4 code, the family's REAL household,
// its own sign-in, storage and caches so it never clashes with v2/, v2-next/ or demo/. — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "live");
const read = f => fs.readFileSync(path.join(DIR, f), "utf8");

test("live/ has every app file, loaded by relative path", () => {
  const html = read("index.html");
  for (const src of ["js/version.js", "js/pwa.js", "js/logic.js", "js/look.js", "js/omr.js", "js/db.js", "js/app.js", "js/account.js"]) {
    assert.ok(fs.existsSync(path.join(DIR, src)), `${src} exists`);
    assert.ok(html.includes(`src="${src}"`), `loads ${src}`);
  }
  assert.doesNotMatch(html, /(src|href)="\/(?!\/)/, "no root-absolute paths");
});

test("shows v4.xx (not a demo version)", () => {
  const v = read("js/version.js");
  assert.match(v, /label:\s*"4\.\d\d"/);
  assert.doesNotMatch(v, /prefix:\s*"d\.v"/);
});

test("has the V4 features (dinner + tea, add steps)", () => {
  assert.match(read("js/logic.js"), /function mealsToAsk/);
  assert.match(read("index.html"), /id="addSteps"/);
});

test("uses the family's real household (users/{uid}.householdId), not a demo one", () => {
  const h = read("js/household.js");
  assert.match(h, /householdId/);
  assert.doesNotMatch(h, /demoHouseholdId|v4DemoHouseholdId/);
});

test("own Firebase app name, storage keys, install key, caches and install id", () => {
  assert.match(read("js/account.js"), /initializeApp\([\s\S]*?,\s*"live"\s*\)/);
  const keys = [];
  for (const f of fs.readdirSync(path.join(DIR, "js")).filter(f => f.endsWith(".js"))) {
    for (const m of read(`js/${f}`).matchAll(/(?:local|session)Storage\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)) keys.push(m[1]);
  }
  assert.ok(keys.length >= 3);
  for (const k of keys) assert.match(k, /^live\./, k);
  assert.match(read("js/pwa.js"), /"live\.installHidden"/);
  const sw = read("sw.js");
  assert.match(sw, /const CACHE = "ftlive-v" \+ VERSION/);
  assert.match(sw, /const RUNTIME = "ftlive-runtime"/);
  assert.match(sw, /key\.startsWith\("ftlive-v"\)/);
  const n = Number(/n:\s*(\d+)/.exec(read("js/version.js"))[1]);
  assert.equal(Number(/const VERSION = (\d+)/.exec(sw)[1]), n);
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.name, "Food Tracker");
  assert.equal(m.id, "./?app=live");
  assert.doesNotMatch(read("index.html"), /<title>[^<]*Demo/i);
});

test("no leftover demo names in the code", () => {
  for (const f of ["js/account.js", "js/pwa.js", "js/app.js", "js/household.js", "sw.js", "manifest.webmanifest"]) {
    assert.doesNotMatch(read(f), /v4-demo|v4demo|ftv4demo|v2-next/, f);
  }
});
