// Passport ID in the demo app (Darren 2026-11-08): one login for all DF apps.
// Passport screen first; its Google sign-in also signs into Firebase. Data stays in Firebase.
// Master copy of passport/: https://github.com/DF-AI-Lab/Passport-ID (never edit it inside the app).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP = path.join(__dirname, "..", "demo");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");
const exists = f => fs.existsSync(path.join(APP, f));

const PASSPORT_FILES = ["passport/config.js", "passport/google.js", "passport/passport.js", "passport/ui.js", "passport/passport.css", "passport/theme.json"];
const CLIENT_ID = "1018863337394-dhhfi006uhdf715dovuqetkl22tj5gdo.apps.googleusercontent.com";

// passport-gate.js is a classic script: run it with a fake window and read window.FT_PASSPORT
function loadGate(extra = {}) {
  const store = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
  const window = { addEventListener() {}, localStorage: store(), sessionStorage: store(), ...extra };
  window.window = window;
  const document = { documentElement: { classList: { add() {}, remove() {} } }, addEventListener() {}, getElementById: () => null };
  vm.runInNewContext(read("js/passport-gate.js"), { window, document, localStorage: window.localStorage, sessionStorage: window.sessionStorage, setInterval() {}, console, fetch() {} });
  return window.FT_PASSPORT;
}

test("passport files are copied in, with the one Google client ID", () => {
  for (const f of PASSPORT_FILES) assert.ok(exists(f), `${f} exists`);
  assert.ok(read("passport/config.js").includes(CLIENT_ID));
  assert.ok(read("passport/PASSPORT.md").includes("This app has Passport v0.3.3. Update from DF-AI-Lab/Passport-ID."));
});

test("theme.json is Food Tracker's look (black + mint, Drive folder FT)", () => {
  const t = JSON.parse(read("passport/theme.json"));
  assert.equal(t.name, "Food Tracker");
  assert.equal(t.drive, "FT");
  assert.equal(t.button, "Open my fridge");
  assert.ok(t.colors && t.colors.bg && t.colors.accent);
});

test("index.html loads Passport before the sign-in code, and has the Passport screen", () => {
  const html = read("index.html");
  const at = s => { const i = html.indexOf(s); assert.ok(i > -1, `${s} in index.html`); return i; };
  at('href="passport/passport.css"');
  const order = ['src="passport/config.js"', 'src="passport/google.js"', 'src="passport/passport.js"', 'src="passport/ui.js"', 'src="js/passport-gate.js"', 'src="js/account.js"'].map(at);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], "scripts load in order");
  assert.ok(html.includes('id="passport"'), "Passport screen mount");
  assert.ok(html.includes('id="passportId"'), "Settings shows the passport ID");
  assert.ok(html.includes('id="passportBtn"'), "Settings opens Passport settings");
});

test("service worker saves the Passport files (opens offline) and versions match", () => {
  const self = { addEventListener() {} };
  vm.runInNewContext(read("sw.js"), { self, caches: {}, fetch() {}, URL, Request: function () {}, console });
  const { VERSION, PRECACHE } = self.FT_SW;
  for (const f of [...PASSPORT_FILES, "js/passport-gate.js"]) assert.ok(PRECACHE.includes(f), `${f} is precached`);
  for (const f of PRECACHE) if (f !== "./") assert.ok(exists(f), `precached ${f} exists`);
  const window = {};
  vm.runInNewContext(read("js/version.js"), { window });
  assert.equal(VERSION, window.FT_VERSION.n);
});

test("demo uses its own Passport app name, so it never mixes with live", () => {
  const g = loadGate();
  assert.equal(g.APP, "ft-demo");
});

test("needsFirebaseSignIn: only when Firebase has nobody, or a different Google account", () => {
  const g = loadGate();
  assert.equal(g.needsFirebaseSignIn(null, "a@x.com"), true);
  assert.equal(g.needsFirebaseSignIn("", "a@x.com"), true);
  assert.equal(g.needsFirebaseSignIn("a@x.com", "a@x.com"), false);
  assert.equal(g.needsFirebaseSignIn("A@X.com", "a@x.com"), false, "case doesn't matter");
  assert.equal(g.needsFirebaseSignIn("b@x.com", "a@x.com"), true);
  assert.equal(g.needsFirebaseSignIn("a@x.com", ""), false, "no passport email: keep the Firebase user");
});

test("credential: uses Passport's Google token for Firebase, or null when there is none", () => {
  const AU = { GoogleAuthProvider: { credential: (id, access) => ({ id, access }) } };
  const withToken = loadGate({ PassportCloud: { token: () => "tok123" } });
  assert.deepEqual(withToken.credential(AU), { id: null, access: "tok123" });
  const noToken = loadGate({ PassportCloud: { token: () => "" } });
  assert.equal(noToken.credential(AU), null);
});

test("account.js waits for Passport, then signs into Firebase with its token (old Google button stays as a fallback)", () => {
  const js = read("js/account.js");
  assert.ok(js.includes("FT_PASSPORT"), "uses the Passport gate");
  assert.ok(js.includes("needsFirebaseSignIn"));
  assert.ok(js.includes("signInWithCredential"));
  assert.ok(js.includes("signInWithPopup"), "Continue with Google still works if Passport can't sign Firebase in");
});

test("live is not changed yet (demo first)", () => {
  const live = fs.readFileSync(path.join(__dirname, "..", "live", "index.html"), "utf8");
  assert.ok(!live.includes("passport/ui.js"));
});
