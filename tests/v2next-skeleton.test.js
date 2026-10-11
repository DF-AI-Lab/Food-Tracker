// V2.5 The Look (issue #76): the demo copy in v2-next/ — run with: npm test
// It must live beside the live app (v2/) without touching it, and wear the new look.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "v2-next");
const read = f => fs.readFileSync(path.join(DIR, f), "utf8");
const EMOJI = /\p{Extended_Pictographic}/u;

test("v2-next has every app file, loaded by relative path", () => {
  const html = read("index.html");
  for (const src of ["js/version.js", "js/pwa.js", "js/logic.js", "js/look.js", "js/omr.js", "js/db.js", "js/app.js", "js/account.js"]) {
    assert.ok(fs.existsSync(path.join(DIR, src)), `${src} exists`);
    assert.ok(html.includes(`src="${src}"`), `loads ${src}`);
  }
  assert.doesNotMatch(html, /(src|href)="\/(?!\/)/, "no root-absolute paths");
});

// ---------- kept apart from the live app (same web address, so same storage) ----------

test("own Firebase app name, so sign-in and the offline cache are separate", () => {
  assert.match(read("js/account.js"), /initializeApp\([\s\S]*?,\s*"v2-next"\s*\)/);
});

test("own browser storage keys", () => {
  const app = read("js/app.js");
  const keys = [...app.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\('([^']+)'/g)].map(m => m[1]);
  assert.ok(keys.length >= 3);
  for (const k of keys) assert.match(k, /^next\./, `${k} is prefixed`);
});

test("own service-worker caches the live app never deletes (it deletes ft-v*)", () => {
  const sw = read("sw.js");
  const cache = /const CACHE = "([^"]+)"/.exec(sw)[1];
  const runtime = /const RUNTIME = "([^"]+)"/.exec(sw)[1];
  assert.ok(cache.startsWith("ftnext-v") && !cache.startsWith("ft-v"));
  assert.equal(runtime, "ftnext-runtime");
  assert.match(sw, /key\.startsWith\("ftnext-v"\)/, "only clears its own old caches");
  assert.ok(sw.includes('"js/look.js"'), "look.js works offline");
});

test("installs as its own app", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.match(m.name, /demo/i);
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.equal(m.id, "./?app=v2-next");
});

test("version.js and sw.js agree", () => {
  const n = Number(/n:\s*(\d+)/.exec(read("js/version.js"))[1]);
  assert.equal(Number(/const VERSION = (\d+)/.exec(read("sw.js"))[1]), n);
});

// ---------- the new look ----------

test("no emoji in the screens (SVG icons instead)", () => {
  const html = read("index.html").replace(/<div id="printSheet">[\s\S]*?<\/div>/, "");
  const hit = html.split("\n").find(l => EMOJI.test(l));
  assert.equal(hit, undefined, "emoji in index.html: " + hit);
});

test("no emoji in text app.js and account.js put on screen (the printed sheet keeps its own)", () => {
  const app = read("js/app.js").replace(/function buildPrintSheet[\s\S]*?\n  }\n/, "");
  for (const [name, src] of [["app.js", app], ["account.js", read("js/account.js")]]) {
    const lines = src.split("\n").filter(l => EMOJI.test(l) && !/^\s*\/\//.test(l));
    assert.deepEqual(lines, [], `emoji in ${name}`);
  }
});

test("Geist + Geist Mono fonts", () => {
  assert.match(read("index.html"), /family=Geist:wght@400;500;600;700&(amp;)?family=Geist\+Mono/);
  assert.match(read("css/style.css"), /'Geist'/);
});

test("dark palette from the handover and Darren's locked light palette", () => {
  const css = read("css/style.css").toLowerCase();
  for (const hex of ["#0a1210", "#111c18", "#8fd4b0", "#f2b35b", "#f08a7e"]) assert.ok(css.includes(hex), "dark " + hex);
  for (const hex of ["#94ab9c", "#aec1b5", "#145f40", "#703f02", "#c47a10"]) assert.ok(css.includes(hex), "light " + hex);
  assert.match(css, /html\[data-theme="light"\]/);
});

test("bottom bar: Fridge, Meals, +, Shop, Used", () => {
  const html = read("index.html");
  const nav = /<nav id="bottomNav"[\s\S]*?<\/nav>/.exec(html)[0];
  const order = [...nav.matchAll(/data-nav="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ["fridge", "meals", "add", "shop", "used"]);
  assert.match(nav, /data-tab="add"[^>]*aria-label="Add food"|aria-label="Add food"[^>]*data-tab="add"/);
});

test("top tabs: Fridge | Freezer | Misc (Used lives in the bottom bar only)", () => {
  const html = read("index.html");
  const tabs = /<div id="fridgeTabs"[\s\S]*?<\/div>/.exec(html)[0];
  assert.deepEqual([...tabs.matchAll(/data-view="(\w+)"/g)].map(m => m[1]), ["fridge", "freezer", "misc"]);
  assert.ok(html.includes('data-view-pane="misc"'));
});

test("top right: bell, camera, print, settings in one box", () => {
  const html = read("index.html");
  const box = /<span class="pal"[\s\S]*?<\/span>\s*<\/div>/.exec(html)[0];
  assert.deepEqual([...box.matchAll(/<button id="(\w+)"/g)].map(m => m[1]), ["bellBtn", "scanBtn", "printF", "settingsBtn"]);
});

test("Add page saves from the Add bar, no big Add button", () => {
  const html = read("index.html");
  const bar = /<div id="addBar"[\s\S]*?<\/div>\s*<\/div>/.exec(html)[0];
  assert.ok(bar.includes('id="addBtn"'), "Add lives in the bar");
  assert.ok(bar.includes('id="barFreezer"'), "snowflake switch in the bar");
  assert.doesNotMatch(html, /class="act big" id="addBtn"/);
});

test("every icon from the handover is in v2-next/icons", () => {
  for (const n of ["bell", "fridge", "freezer", "misc", "used", "meals", "shop", "add", "minus", "close", "camera", "print", "settings", "search", "chevron-down", "check", "trash", "mic", "copy", "idea", "takeaway", "undo"]) {
    assert.ok(fs.existsSync(path.join(DIR, "icons", n + ".svg")), n + ".svg");
  }
});

test("buttons and links are at least 44px tall", () => {
  const css = read("css/style.css");
  assert.match(css, /--tap:\s*44px/);
});



test("shopping action bar is symmetrical: Got all · ideas · Clear ticked (Darren 2026-10-11)", () => {
  const bar = /<div class="btns sbot">[\s\S]*?<\/div>/.exec(read("index.html"))[0];
  assert.deepEqual([...bar.matchAll(/id="(\w+)"/g)].map(m => m[1]), ["gotAll", "ideaBtn", "clearGot"]);
});

test("shopping: 'Clear list' says what it clears, and both big actions ask first (Darren 2026-10-11)", () => {
  const html = read("index.html");
  assert.match(html, /id="clearAll"[^>]*>[\s\S]*?Clear list<\/button>/);
  assert.match(html, /id="clrAsk"[^>]*>[\s\S]*?Clear the whole list\?[\s\S]*?id="clrYes"[\s\S]*?id="clrNo"/);
  assert.match(html, /id="gotAsk"[^>]*>[\s\S]*?Mark everything as got\?[\s\S]*?id="gotYes"[\s\S]*?id="gotNo"/);
  const app = read("js/app.js");
  assert.match(app, /getElementById\('gotAll'\)\.addEventListener\('click', \(\) => setGotAsk\(true\)\)/, "Got all only asks");
  assert.match(app, /getElementById\('gotYes'\)\.addEventListener\('click', gotAllShop\)/, "Yes does it");
});
