// V2.5 The Look (issue #76) swapped into the live app (v2/) — run with: npm test
// Live gets the demo's look, but keeps its own Firebase app, storage keys and caches,
// so phones carry on with the same sign-in, saved settings and offline data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LIVE = path.join(__dirname, "..", "v2");
const read = f => fs.readFileSync(path.join(LIVE, f), "utf8");
const EMOJI = /\p{Extended_Pictographic}/u;

test("live has the V2.5 look: bottom bar, look + icons scripts, Geist", () => {
  const html = read("index.html");
  assert.ok(html.includes('<nav id="bottomNav"'));
  for (const src of ["js/look.js", "js/icons.js"]) assert.ok(html.includes(`src="${src}"`), src);
  assert.match(html, /family=Geist:wght/);
  assert.ok(fs.existsSync(path.join(LIVE, "icons", "bell.svg")));
});

test("live screens have no emoji", () => {
  const hit = read("index.html").split("\n").find(l => EMOJI.test(l));
  assert.equal(hit, undefined, hit);
});

test("live keeps the default Firebase app (same sign-in and offline cache as before)", () => {
  const acc = read("js/account.js");
  assert.doesNotMatch(acc, /"v2-next"/);
  assert.match(acc, /:\s*firebaseConfig\);/);
});

test("live keeps its storage keys (theme, bell, backup reminder carry over)", () => {
  const keys = [...read("js/app.js").matchAll(/localStorage\.(?:getItem|setItem|removeItem)\('([^']+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), ["backupSnooze", "bellSeen", "theme"]);
});

test("live keeps its cache names and only clears its own old caches", () => {
  const sw = read("sw.js");
  assert.match(sw, /const CACHE = "ft-v" \+ VERSION;/);
  assert.match(sw, /const RUNTIME = "ft-runtime";/);
  assert.match(sw, /key\.startsWith\("ft-v"\)/);
  assert.ok(sw.includes('"js/look.js"') && sw.includes('"js/icons.js"'), "new files work offline");
});

test("live installs as the same app as before", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.name, "Food Tracker");
  assert.equal(m.short_name, "Food");
  assert.equal(m.id, undefined, "no id: same app identity as before");
});

test("live version bumped to 20, sw.js agrees", () => {
  const n = Number(/n:\s*(\d+)/.exec(read("js/version.js"))[1]);
  assert.equal(n, 20);
  assert.equal(Number(/const VERSION = (\d+)/.exec(read("sw.js"))[1]), n);
});
