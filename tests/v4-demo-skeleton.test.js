// V4 demo (#139/#140): its own copy of the app in demo/ — run with: npm test
// Same web address as v2/ and v2-next/, so it must keep its storage, caches,
// sign-in and household apart from both.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "demo");
const read = f => fs.readFileSync(path.join(DIR, f), "utf8");

test("demo/ has every app file, loaded by relative path", () => {
  const html = read("index.html");
  for (const src of ["js/version.js", "js/pwa.js", "js/logic.js", "js/look.js", "js/omr.js", "js/db.js", "js/app.js", "js/account.js"]) {
    assert.ok(fs.existsSync(path.join(DIR, src)), `${src} exists`);
    assert.ok(html.includes(`src="${src}"`), `loads ${src}`);
  }
  assert.doesNotMatch(html, /(src|href)="\/(?!\/)/, "no root-absolute paths");
});

test("shows d.v4.x", () => {
  const v = read("js/version.js");
  assert.match(v, /label:\s*"4\.\d+"/);
  assert.match(v, /prefix:\s*"d\.v"/);
});

test("own Firebase app name", () => {
  assert.match(read("js/account.js"), /initializeApp\([\s\S]*?,\s*"v4-demo"\s*\)/);
});

test("own browser storage keys", () => {
  const keys = [];
  for (const f of fs.readdirSync(path.join(DIR, "js")).filter(f => f.endsWith(".js"))) {
    for (const m of read(`js/${f}`).matchAll(/(?:local|session)Storage\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)) keys.push(m[1]);
  }
  assert.ok(keys.length >= 3);
  for (const k of keys) assert.match(k, /^v4demo\./, `${k} is prefixed`);
});

test("own install-hidden key", () => {
  const pwa = read("js/pwa.js");
  assert.doesNotMatch(pwa, /"next\.installHidden"/);
  assert.match(pwa, /v4demo\.installHidden/);
});

test("own service-worker caches that v2/ and v2-next/ never delete, and it never deletes theirs", () => {
  const sw = read("sw.js");
  const cache = /const CACHE = "([^"]+)"/.exec(sw)[1];
  const runtime = /const RUNTIME = "([^"]+)"/.exec(sw)[1];
  assert.ok(cache.startsWith("ftv4demo-v"));
  assert.equal(runtime, "ftv4demo-runtime");
  assert.match(sw, /key\.startsWith\("ftv4demo-v"\)/);
  assert.doesNotMatch(sw, /startsWith\("ft(next)?-v"\)/);
});

test("installs as its own app", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.match(m.name, /V4/);
  assert.match(m.name, /demo/i);
  assert.equal(m.id, "./?app=v4-demo");
});

test("version.js and sw.js agree", () => {
  const n = Number(/n:\s*(\d+)/.exec(read("js/version.js"))[1]);
  assert.equal(Number(/const VERSION = (\d+)/.exec(read("sw.js"))[1]), n);
});

test("own household pointer, never falls back to the live or V3 demo household", () => {
  const h = read("js/household.js");
  assert.match(h, /const KEY = "v4DemoHouseholdId"/);
  assert.doesNotMatch(h, /userSnap\.data\(\)\.householdId/, "no fallback to the live household");
  assert.doesNotMatch(h, /demoHouseholdId"/, "no fallback to the V3 demo household");
});

test("no leftover v2-next names in the code", () => {
  for (const f of ["js/account.js", "js/pwa.js", "js/app.js", "manifest.webmanifest"]) {
    assert.doesNotMatch(read(f), /v2-next/, f);
  }
});

test("v2/ and v2-next/ untouched: still their own keys", () => {
  const root = path.join(__dirname, "..");
  assert.match(fs.readFileSync(path.join(root, "v2-next/js/household.js"), "utf8"), /const KEY = "demoHouseholdId"/);
  assert.match(fs.readFileSync(path.join(root, "v2-next/sw.js"), "utf8"), /"ftnext-v"/);
});
