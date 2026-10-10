// V2 step 6: installable app (manifest, icons, service worker) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const V2 = path.join(__dirname, "..", "v2");
const read = f => fs.readFileSync(path.join(V2, f), "utf8");
const exists = f => fs.existsSync(path.join(V2, f));

// Every app file the phone needs to start offline
function appFiles(dir = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(V2, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...appFiles(rel));
    else out.push(rel);
  }
  return out;
}

// Load sw.js with a fake service worker global, to read its VERSION and PRECACHE list
function loadSW() {
  const self = { addEventListener() {} };
  vm.runInNewContext(read("sw.js"), { self, caches: {}, fetch() {}, URL, Request: function () {}, console });
  return self.FT_SW;
}

test("manifest makes the app installable", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.name, "Food Tracker");
  assert.ok(m.short_name && m.short_name.length <= 12);
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.equal(m.display, "standalone");
  assert.match(m.theme_color, /^#[0-9a-fA-F]{6}$/);
  assert.match(m.background_color, /^#[0-9a-fA-F]{6}$/);
  const sizes = m.icons.map(i => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(m.icons.some(i => String(i.purpose).includes("maskable")));
  for (const i of m.icons) assert.ok(exists(i.src), `${i.src} exists`);
});

test("index.html links the manifest, phone icon and theme colour", () => {
  const html = read("index.html");
  assert.ok(html.includes('rel="manifest" href="manifest.webmanifest"'));
  assert.ok(html.includes('rel="apple-touch-icon" href="icons/apple-touch-icon.png"'));
  assert.match(html, /<meta name="theme-color" content="#[0-9a-fA-F]{6}">/);
  assert.ok(html.includes('src="js/pwa.js"'));
  assert.ok(html.includes('id="installBtn"') && html.includes('id="newVersion"'));
});

test("service worker version matches the app version (a new version = a new worker)", () => {
  const sw = loadSW();
  const window = {};
  vm.runInNewContext(read("js/version.js"), { window });
  assert.equal(sw.VERSION, window.FT_VERSION.n);
});

test("service worker saves every app file, so it opens offline", () => {
  const { PRECACHE } = loadSW();
  for (const f of PRECACHE) {
    if (f === "./") continue;
    assert.ok(exists(f), `precached ${f} exists`);
  }
  const needed = appFiles().filter(f => f !== "sw.js" && !f.endsWith(".svg"));
  for (const f of needed) assert.ok(PRECACHE.includes(f), `${f} is precached`);
  assert.ok(PRECACHE.includes("./"));
});
