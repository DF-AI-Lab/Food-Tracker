// V3 photos (issue #89): v2-next/js/photos.js — phone photo -> Worker -> Quick fill list. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const P = require(path.join(__dirname, "..", "v2-next", "js", "photos.js"));
const FT = require(path.join(__dirname, "..", "v2-next", "js", "logic.js"));
const HTML = fs.readFileSync(path.join(__dirname, "..", "v2-next", "index.html"), "utf8");
const ACCOUNT = fs.readFileSync(path.join(__dirname, "..", "v2-next", "js", "account.js"), "utf8");

test("Worker address is the live one", () => {
  assert.equal(P.WORKER_URL, "https://food-tracker-photos.df-ai-lab-hq.workers.dev");
});

test("chunk: groups of 5 for the Worker", () => {
  assert.deepEqual(P.chunk([1, 2, 3, 4, 5, 6, 7], 5), [[1, 2, 3, 4, 5], [6, 7]]);
  assert.deepEqual(P.chunk([], 5), []);
});

test("fitSize: longest side 1000 px, never bigger", () => {
  assert.deepEqual(P.fitSize(4000, 3000, 1000), { w: 1000, h: 750 });
  assert.deepEqual(P.fitSize(3000, 4000, 1000), { w: 750, h: 1000 });
  assert.deepEqual(P.fitSize(800, 600, 1000), { w: 800, h: 600 });
});

test("gauge text: 7/26 and about Ns left", () => {
  assert.equal(P.gaugeText(7, 26), "7/26");
  assert.equal(P.gaugeLeft(7, 26, 2000), "about 38s left");   // 19 left x 2s
  assert.equal(P.gaugeLeft(26, 26, 2000), "opening the list…");
  assert.equal(P.gaugeLeft(0, 26, 0), "starting…");            // no timing yet
  assert.equal(P.gaugePct(7, 26), 26.9);
  assert.equal(P.gaugePct(0, 0), 0);
});

test("toQuickFill: Worker results become Quick fill rows, CHECK kept", () => {
  const rows = P.toQuickFill([
    { id: "a", name: "Chicken", sub: "Thighs", date: "2026-10-16", bb: false, price: 3.5, packs: 2, kind: "main", noDate: false, needsCheck: false },
    { id: "b", name: "Carrots", date: null, kind: "veg", noDate: true, needsCheck: false },
    { id: "c", name: "Ham", date: "2026-10-01", kind: "main", needsCheck: true },
    { id: "d", error: "Couldn't read reply", date: null, needsCheck: true },
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { name: "Chicken", sub: "Thighs", date: "2026-10-16", bb: false, price: 3.5, packs: 2, kind: "main", noDate: false, check: false });
  assert.equal(rows[1].noDate, true);
  assert.equal(rows[2].check, true);
  assert.equal(rows[3].name, "");       // unreadable photo: blank row the user fills in
  assert.equal(rows[3].check, true);
});

test("Quick fill shows CHECK for a row the photo scan was unsure of", () => {
  const sure = FT.quickFillRow({ name: "Ham", kind: "main", date: "2026-10-20" });
  assert.equal(sure.check, false);
  const unsure = FT.quickFillRow({ name: "Ham", kind: "main", date: "2026-10-01", check: true });
  assert.equal(unsure.check, true);
  assert.equal(unsure.ok, true, "a dated CHECK row can still be ticked");
});

test("errorText: plain words for each Worker answer", () => {
  assert.match(P.errorText(401), /sign in/i);
  assert.match(P.errorText(403), /household/i);
  assert.match(P.errorText(429, { week: { used: 100, cap: 100 } }), /100 photos/);
  assert.match(P.errorText(0), /internet|connect/i);
  assert.match(P.errorText(500), /try again/i);
});

// Fake fetch for scanAll
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(calls[calls.length - 1]);
  };
  f.calls = calls;
  return f;
}
const ok = (photos) => ({ ok: true, status: 200, json: async () => ({ results: photos.map(p => ({ id: p.id, name: "Milk", date: "2026-10-20", kind: "misc", needsCheck: false })), week: { used: 1, cap: 100 }, month: { month: "2026-10", cost: 0.001, calls: {} } }) });

test("scanAll: batches of 5, token + household sent, results in photo order, progress counted", async () => {
  const photos = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, jpeg: "x" }));
  const fetch = fakeFetch(c => ok(c.body.photos));
  const seen = [];
  const out = await P.scanAll(photos, {
    fetch, getToken: async () => "tok", household: "h1", names: ["Milk"], today: "2026-10-13",
    onProgress: (done, total) => seen.push(`${done}/${total}`),
  });
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[0].url, P.WORKER_URL + "/scan");
  assert.equal(fetch.calls[0].init.method, "POST");
  assert.equal(fetch.calls[0].init.headers.authorization, "Bearer tok");
  assert.equal(fetch.calls[0].body.household, "h1");
  assert.equal(fetch.calls[0].body.today, "2026-10-13");
  assert.deepEqual(fetch.calls[0].body.names, ["Milk"]);
  assert.equal(fetch.calls[0].body.photos.length, 5);
  assert.equal(fetch.calls[1].body.photos.length, 2);
  assert.deepEqual(out.results.map(r => r.id), ["p0", "p1", "p2", "p3", "p4", "p5", "p6"]);
  assert.equal(out.error, null);
  assert.deepEqual(seen.at(-1), "7/7");
  assert.deepEqual(out.month.month, "2026-10");
});

test("scanAll: stops on an error and keeps what was already read", async () => {
  const photos = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, jpeg: "x" }));
  let n = 0;
  const fetch = fakeFetch(c => (n++ === 0 ? ok(c.body.photos) : { ok: false, status: 429, json: async () => ({ error: "cap", week: { used: 100, cap: 100 } }) }));
  const out = await P.scanAll(photos, { fetch, getToken: async () => "tok", household: "h1", names: [], today: "2026-10-13" });
  assert.equal(out.results.length, 5);
  assert.match(out.error, /100 photos/);
});

test("scanAll: no internet is a plain error, not a crash", async () => {
  const fetch = async () => { throw new TypeError("Failed to fetch"); };
  const out = await P.scanAll([{ id: "a", jpeg: "x" }], { fetch, getToken: async () => "tok", household: "h1", names: [], today: "2026-10-13" });
  assert.equal(out.results.length, 0);
  assert.match(out.error, /internet|connect/i);
});

test("page has Take photo + Select images, a bar gauge, and loads photos.js", () => {
  assert.match(HTML, /id="qfTake"[^>]*/);
  assert.match(HTML, /<input[^>]*id="qfCamera"[^>]*capture="environment"/);
  assert.match(HTML, /<input[^>]*id="qfPick"[^>]*multiple/);
  assert.match(HTML, /id="qfGauge"/);
  assert.match(HTML, /id="qfGaugeFill"/);
  assert.match(HTML, /<script src="js\/photos\.js"><\/script>/);
  assert.ok(HTML.indexOf('js/photos.js') < HTML.indexOf('js/app.js'), "photos.js loads before app.js");
});

test("account.js gives the app a way to get the sign-in token", () => {
  assert.match(ACCOUNT, /window\.FT_TOKEN\s*=/);
  assert.match(ACCOUNT, /getIdToken\(/);
});

// ---- Quick fill layout (mock: docs/mockups/quickfill-photos-mock.html) ----

test("trayText / readLabel: plain words for the photo pile", () => {
  assert.equal(P.trayText(1), "1 photo ready");
  assert.equal(P.trayText(3), "3 photos ready");
  assert.equal(P.readLabel(1), "Read 1 photo");
  assert.equal(P.readLabel(3), "Read 3 photos");
});

test("Quick fill is 3 steps: photo -> Claude reads -> check and add", () => {
  const pane = HTML.slice(HTML.indexOf('data-sub-pane="quick"'), HTML.indexOf('data-sub-pane="quick"') + 6000);
  const at = id => pane.indexOf(`id="${id}"`);
  for (const id of ["qfStep1", "qfStep2", "qfStep3", "qfTake", "qfSelect", "qfTray", "qfTrayN", "qfRead", "qfGauge", "qfList", "qfAdd"]) {
    assert.ok(at(id) > 0, `${id} in the Quick fill pane`);
  }
  assert.ok(at("qfTake") < at("qfStep2") && at("qfStep2") < at("qfGauge") && at("qfGauge") < at("qfStep3") && at("qfStep3") < at("qfList"), "order: photo, gauge, list");
  assert.match(pane, /<div[^>]*id="qfTray"[^>]*hidden/);
});

test("old paste way hides behind a 'Paste a Claude reply instead' link", () => {
  const m = HTML.match(/<details[^>]*id="qfPasteWrap"[^>]*>([\s\S]*?)<\/details>/);
  assert.ok(m, "paste section is a closed <details>");
  assert.doesNotMatch(m[0], /<details[^>]*\bopen\b/);
  assert.match(m[1], /<summary>Paste a Claude reply instead<\/summary>/);
  for (const id of ["qfCopy", "qfText", "qfCheck"]) assert.match(m[1], new RegExp(`id="${id}"`));
});

test("app.js: camera adds to the pile, Read button starts the scan", () => {
  const APP = fs.readFileSync(path.join(__dirname, "..", "v2-next", "js", "app.js"), "utf8");
  assert.match(APP, /getElementById\('qfRead'\)/);
  assert.match(APP, /FT_PHOTOS\.trayText\(/);
  assert.match(APP, /FT_PHOTOS\.readLabel\(/);
});

// ---- Fixing dates on the list (Darren, 2026-10-13) ----

test("a row with no date can be added as 'no date' (dateMissing), and makes packs that say so", () => {
  const stuck = FT.quickFillRow({ name: "Brie", kind: "misc" });
  assert.equal(stuck.ok, false);
  assert.equal(stuck.problem, "Needs a date");
  const chosen = FT.quickFillRow({ name: "Brie", kind: "misc", dateMissing: true });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.noDate, true);
  assert.equal(chosen.dateMissing, true);
  const packs = FT.makePacks({ name: "Brie", kind: "misc", noDate: true, dateMissing: true, count: 1 }, "2026-10-13");
  assert.equal(packs[0].dateMissing, true);
  const normal = FT.makePacks({ name: "Milk", kind: "misc", date: "2026-10-20", count: 1 }, "2026-10-13");
  assert.equal(normal[0].dateMissing, undefined, "only set when chosen");
});

test("a date typed in makes the row OK", () => {
  const r = FT.quickFillRow({ name: "Brie", kind: "misc", date: "2026-10-25" });
  assert.equal(r.ok, true);
  assert.equal(r.date, "2026-10-25");
});

test("toQuickFill keeps the Worker's failKey so a fix can be saved as a test case", () => {
  const [row] = P.toQuickFill([{ id: "a", name: "Brie", kind: "misc", date: null, needsCheck: true, failKey: "fail:h1:1-a" }]);
  assert.equal(row.failKey, "fail:h1:1-a");
  const [plain] = P.toQuickFill([{ id: "b", name: "Milk", date: "2026-10-20", needsCheck: false }]);
  assert.equal(plain.failKey, undefined);
});

test("fixFor: only kept photos send a fix; 'no date' is sent as none", () => {
  assert.deepEqual(P.fixFor({ failKey: "fail:h1:1-a" }, "2026-10-25"), { key: "fail:h1:1-a", date: "2026-10-25" });
  assert.deepEqual(P.fixFor({ failKey: "fail:h1:1-a" }, null), { key: "fail:h1:1-a", date: "none" });
  assert.equal(P.fixFor({}, "2026-10-25"), null);
  assert.equal(P.fixFor(null, "2026-10-25"), null);
});

test("sendFix posts to /fail-date with the sign-in token, and never throws", async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
  const ok = await P.sendFix({ key: "fail:h1:1-a", date: "2026-10-25" }, { fetch, getToken: async () => "tok", household: "h1" });
  assert.equal(ok, true);
  assert.equal(calls[0].url, P.WORKER_URL + "/fail-date");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer tok");
  assert.deepEqual(calls[0].body, { household: "h1", key: "fail:h1:1-a", date: "2026-10-25" });
  const bad = await P.sendFix({ key: "k", date: "2026-10-25" }, { fetch: async () => { throw new Error("offline"); }, getToken: async () => "tok", household: "h1" });
  assert.equal(bad, false);
});

test("page: rows get a date picker + No date button; fridge marks chosen 'no date' red", () => {
  const APP = fs.readFileSync(path.join(__dirname, "..", "v2-next", "js", "app.js"), "utf8");
  const CSS = fs.readFileSync(path.join(__dirname, "..", "v2-next", "css", "style.css"), "utf8");
  assert.match(APP, /qf-date/, "date picker on each row");
  assert.match(APP, /'No date'/, "No date button");
  assert.match(APP, /FT_PHOTOS\.sendFix\(/);
  assert.match(APP, /dateMissing/);
  assert.match(CSS, /\.nd-tag/, "amber NO DATE tag");
  assert.match(APP, /NO DATE/);
});

test("Meals: + Add is offered on every asking day, not only tonight (Darren, 2026-10-13)", () => {
  const APP = fs.readFileSync(path.join(__dirname, "..", "v2-next", "js", "app.js"), "utf8");
  const past = APP.slice(APP.indexOf("function pastCard("), APP.indexOf("} else if (state === 'use')"));
  assert.match(past, /ask-tag/, "closed card shows a quiet tag");
  assert.match(past, /had-add/);
  assert.doesNotMatch(past, /if \(day === today\) \{\s*const add/, "+ Add no longer only for today");
});

test("Meals: Save as meal shows on every opened asking card; an already-saved meal says 'Saved ✓'", () => {
  const APP = fs.readFileSync(path.join(__dirname, "..", "v2-next", "js", "app.js"), "utf8");
  const past = APP.slice(APP.indexOf("function pastCard("), APP.indexOf("} else if (state === 'use')"));
  assert.match(past, /day-meal/);
  assert.match(past, /Saved ✓/);
});
