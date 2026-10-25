// Simple day card (Darren 2026-10-25): small Use soon card; DINNER / TEA lines under each day; open day = Dinner|Tea,
// tabs with Meals standing out and Takeaway at the end; no Top 3, no "Adding to", no Next buttons.
// Run with: node tests/v4-simple-day.check.js  (demo)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5241;
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
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); }
    }
  };
  const T = "2026-10-25";
  const card = day => page.locator(`#dayList .day[data-day="${day}"]`);
  const todayCard = () => card(T);
  const pick = name => page.locator("#pickList .item", { hasText: name }).first().click();

  await page.goto(url(T, 10));

  await step("fridge: 4 foods going off soon and one later", async () => {
    for (const [name, kind, days] of [["Chicken", "main", "1"], ["Sausages", "main", "1"], ["Mince", "main", "2"], ["Potatoes", "side", "3"], ["Bacon", "main", "12"]]) {
      await page.click('[data-tab="add"]');
      await page.click('[data-sub="fridge"]');
      await page.click(`[data-kind="${kind}"]`);
      await page.fill("#name", name);
      if (await page.locator("#days").isVisible()) await page.fill("#days", days);
      await page.click("#addBtn");
      await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
    }
    await page.click('[data-tab="meals"]');
  });

  await step("Use soon: one card, 3 lines then +1 more soon; no sideways scroll", async () => {
    const box = page.locator("#mealsSoon");
    await until(async () => assert.ok(await box.isVisible()));
    assert.equal(await box.locator(".msoon-line").count(), 3);
    assert.match(await page.locator("#mealsSoonMore").innerText(), /\+1 more soon/);
    assert.doesNotMatch(await box.innerText(), /Bacon/);
    const sw = await box.evaluate(el => el.scrollWidth - el.clientWidth);
    assert.ok(sw <= 1, "no sideways scroll");
    await page.click("#mealsSoonMore");
    await until(async () => assert.equal(await box.locator(".msoon-line").count(), 4));
    await page.click("#mealsSoonMore");
  });

  await step("open today: Dinner | Tea, tabs with Meals + Takeaway at the end; no Top 3, Adding to, Next buttons", async () => {
    if (!(await todayCard().locator(".meal-seg").isVisible())) await todayCard().locator(".dh").click();
    await until(async () => assert.ok(await todayCard().locator(".meal-seg").isVisible()));
    assert.match(await todayCard().locator(".meal-seg").innerText(), /Dinner[\s\S]*Tea/);
    assert.ok(await todayCard().locator("#mtabs").isVisible());
    assert.ok(await todayCard().locator("#mtabTake").isVisible());
    assert.ok(await todayCard().locator('#mtabs .mtab-meals[data-s="meal"]').count() === 1);
    const text = await todayCard().innerText();
    assert.doesNotMatch(text, /Top 3|Adding to|Next: |Next day/);
    assert.equal(await todayCard().locator("#pickList .item.ta").count(), 0, "no Takeaway row in the list");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, "page fits the phone");
  });

  await step("Tea: tap Chicken → a TEA line under the day; Use soon shows ✓ Sun for Chicken", async () => {
    await todayCard().locator('.meal-seg button[data-meal="tea"]').click();
    await page.locator('#mtabs [data-s="main"]').click();
    await pick("Chicken");
    await until(async () => assert.match(await todayCard().locator('.sit[data-meal="tea"]').innerText(), /TEA[\s\S]*Chicken/));
    await until(async () => assert.match(await page.locator("#mealsSoon").innerText(), /Chicken\s*✓ Sun/));
    assert.doesNotMatch(await todayCard().locator(".meal-seg").innerText(), /·/, "no counts on Dinner | Tea");
  });

  await step("Dinner: Takeaway in the tab row → a DINNER line saying Takeaway", async () => {
    await todayCard().locator('.meal-seg button[data-meal="dinner"]').click();
    await page.click("#mtabTake");
    await until(async () => assert.match(await todayCard().locator('.sit[data-meal="dinner"]').innerText(), /DINNER[\s\S]*Takeaway/));
  });

  await step("close the day: DINNER and TEA lines stay under Sun 25 Oct, Dinner first", async () => {
    await todayCard().locator(".dh").click();
    await until(async () => assert.equal(await todayCard().locator(".meal-seg").count(), 0));
    const lines = todayCard().locator(".sit");
    assert.equal(await lines.count(), 2);
    assert.match(await lines.nth(0).innerText(), /DINNER[\s\S]*Takeaway/);
    assert.match(await lines.nth(1).innerText(), /TEA[\s\S]*Chicken/);
    const head = await todayCard().locator(".dh").boundingBox();
    const first = await lines.nth(0).boundingBox();
    assert.ok(first.y >= head.y + head.height - 2, "lines sit under the day line");
  });

  await step("✕ on Chicken takes it off; the TEA line goes", async () => {
    await todayCard().locator('.sit[data-meal="tea"] .x, .sit[data-meal="tea"] .meal-x').first().click();
    await until(async () => assert.equal(await todayCard().locator('.sit[data-meal="tea"]').count(), 0));
  });

  await step("no page errors", async () => {
    assert.deepEqual(errors, []);
  });

  console.log("ALL SIMPLE DAY CHECKS PASSED");
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
