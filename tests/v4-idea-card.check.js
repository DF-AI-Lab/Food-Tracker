// Idea card (Darren 2026-10-25): Make a meal + Not for me under the buttons, 🍽 Meal badge, Edit lists each combo,
// the card slides shut with Undo; an open day card stays open when another day is changed.
// Run with: node tests/v4-idea-card.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5243;
const ROOT = path.join(__dirname, "..");
const url = (today, hour) => `http://localhost:${PORT}/Food-Tracker/${APP_DIR}/?local=1&today=${today}&hour=${hour}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function startStatic() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!p.startsWith("/Food-Tracker/")) { res.writeHead(404); return res.end(); }
    p = p.slice("/Food-Tracker".length);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => srv.listen(PORT, () => r(srv)));
}

(async () => {
  const server = await startStatic();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); }
    }
  };
  const isOpen = sel => page.locator(sel).evaluate(el => el.open);

  await page.goto(url("2026-10-25", 10));
  const addFood = async (kind, name, days) => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click(`[data-kind="${kind}"]`);
    await page.fill("#name", name);
    await page.fill("#days", String(days));
    await page.click("#addBtn");
    await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
  };
  for (const [k, n, d] of [["main", "Bacon", 20], ["side", "Potatoes", 1], ["veg", "Mushrooms", 6]]) await addFood(k, n, d);
  await page.evaluate(k => localStorage.setItem(k, "sk-ant-test"), (APP_DIR === "live" ? "live." : "v4demo.") + "claudeKey");
  const pairs = [["Bacon", "Potatoes"], ["Bacon", "Mushrooms"]].map(([a, b]) => ({ a, b, note: "" }));
  await page.route("https://api.anthropic.com/v1/messages", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ pairs }) }] }) }));
  await page.click('[data-tab="meals"]');
  for (const f of ["#allCombosFold"]) {
    if (!(await page.locator(f).evaluate(el => el.open))) await page.locator(f + " > summary").click();
    await page.waitForFunction(s => document.querySelector(s).open && !document.querySelector(s).getAnimations({ subtree: true }).length, f);
  }
  await page.click("#aiAsk");
  await until(async () => assert.ok(await page.locator("#aiReview").isVisible()));
  await page.click("#aiAdd");
  await until(async () => assert.ok(await page.locator("#aiReview").isHidden()));

  const card = () => page.locator("#ideasWeek .idea-card", { has: page.locator(".idea-title", { hasText: /^Bacon/ }) });
  const undo = page.locator("#ideasWeek .idea-undo");

  await step("Card: Plan / Other day, then Make a meal and Not for me under them; Edit lists both combos", async () => {
    await until(async () => assert.equal(await card().count(), 1));
    assert.match(await card().locator(".idea-title").innerText(), /Potatoes/);
    assert.match(await card().locator(".idea-title").innerText(), /Mushrooms/);
    const minor = card().locator(".idea-minor");
    assert.equal(await minor.locator(".idea-meal").count(), 1);
    assert.equal(await minor.locator(".idea-nfm").count(), 1);
    const order = await card().evaluate(el => [".idea-plan-day", ".idea-minor"].map(s => el.querySelector(s).getBoundingClientRect().top));
    assert.ok(order[0] < order[1], "the links sit under the buttons");
    await card().locator(".idea-edit").click();
    const box = card().locator(".idea-editbox");
    await until(async () => assert.ok(await box.isVisible()));
    assert.equal(await box.locator(".idea-meal, .idea-nfm").count(), 0, "not in Edit any more");
    assert.equal(await box.locator(".idea-notday").count(), 1);
    assert.deepEqual((await box.locator(".idea-nolike").allInnerTexts()).map(t => t.trim()).sort(),
      ["Mushrooms with Bacon", "Potatoes with Bacon"]);
  });

  await step("Don't like Potatoes: card slides shut, Undo bar; Undo brings it back", async () => {
    await card().locator(".idea-nolike", { hasText: "Potatoes" }).click();
    await until(async () => assert.ok(await undo.isVisible()));
    assert.match(await undo.innerText(), /Potatoes with Bacon/);
    await until(async () => assert.doesNotMatch(await page.locator("#ideasWeek").innerText(), /Bacon \+ Potatoes/));
    await undo.locator("button").click();
    await until(async () => assert.match(await card().locator(".idea-title").innerText(), /Potatoes/));
    assert.equal(await undo.count(), 0);
  });

  await step("Not for me: hidden with Undo; Undo brings it back", async () => {
    await card().locator(".idea-nfm").click();
    await until(async () => assert.ok(await undo.isVisible()));
    await until(async () => assert.equal(await card().count(), 0));
    await undo.locator("button").click();
    await until(async () => assert.equal(await card().count(), 1));
  });

  await step("Not <day>: moved off with Undo; Undo puts it back on the same day", async () => {
    const before = (await card().locator(".idea-plan-day").innerText()).trim();
    await card().locator(".idea-edit").click();
    await card().locator(".idea-notday").click();
    await until(async () => assert.ok(await undo.isVisible()));
    assert.match(await undo.innerText(), /Moved off/);
    await undo.locator("button").click();
    await until(async () => assert.equal((await card().locator(".idea-plan-day").innerText()).trim(), before));
  });

  await step("Make a meal: 🍽 Meal badge, the link goes, saved in My meals once", async () => {
    await card().locator(".idea-meal").click();
    await until(async () => assert.equal(await card().locator(".idea-mealtag").count(), 1));
    assert.match(await card().locator(".idea-mealtag").innerText(), /Meal/);
    assert.equal(await card().locator(".idea-meal").count(), 0);
    const names = await page.locator("#myMeals .ml").innerText();
    assert.equal(names.split("Bacon").length - 1, 1, "one meal");
  });

  const day = i => page.locator("#dayList .day").nth(i);
  await step("An open day card stays open when another day is changed", async () => {
    await card().locator(".idea-plan-day").click();
    const planned = async () => { for (let i = 0; i < 7; i++) if (/Bacon/.test(await day(i).innerText())) return i; return -1; };
    let from; await until(async () => assert.ok((from = await planned()) >= 0));
    const open = from === 3 ? 4 : 3;
    if (await page.locator("#dayList .day.open").count()) await page.locator("#dayList .day.open .dh").click();
    await day(open).locator(".dh").click();
    await until(async () => assert.match(await day(open).getAttribute("class"), /\bopen\b/));
    await day(from).locator(".sit-change").first().click();
    assert.match(await day(open).getAttribute("class"), /\bopen\b/, "still open after Change");
    await day(from).locator(".chg-move").click();
    const to = from === 6 ? 5 : 6;
    const toName = (await day(to).locator(".dh").innerText()).trim().slice(0, 3);
    await day(from).locator(".chg-to", { hasText: toName }).click();
    await until(async () => assert.match(await day(to).innerText(), /Bacon/));
    assert.match(await day(open).getAttribute("class"), /\bopen\b/, "still open after the move");
  });

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("all ok");
})().catch(e => { console.error(e); process.exit(1); });
