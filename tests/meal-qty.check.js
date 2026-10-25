// Meal fresh foods can be ×2 / ×3 (Darren 2026-10-17, mock docs/mockups/meal-qty-mock.html).
// Run with: V4DIR=live node tests/meal-qty.check.js  (and V4DIR=demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "live";
const PORT = 5214;
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
  const chip = name => page.locator("#mealForm .fresh-item", { hasText: name });

  await page.goto(url("2026-10-17", 10));

  await step("fridge has 1 whole chicken", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click('[data-kind="main"]');
    await page.fill("#name", "Whole Chicken");
    await page.fill("#days", "4");
    await page.click("#addBtn");
    await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
  });

  await step("new meal: a fresh food starts at ×1; tap it -> ×2 -> ×3 -> ×1 -> ×2", async () => {
    await page.click('[data-tab="meals"]');
    // New meal sits in My meals → Edit meals, both folded at first (d.v4.45)
    for (const f of ["#myMealsFold", "#editMealsFold"]) {
      if (!(await page.locator(f).evaluate(el => el.open))) await page.locator(f + " > summary").click();
      await page.waitForFunction(s => document.querySelector(s).open && !document.querySelector(s).getAnimations({ subtree: true }).length, f);
    }
    await page.click("#newMeal");
    await page.fill("#mealName", "Fajitas");
    await page.fill("#freshIn", "Whole");
    const sug = page.locator("#freshSuggest .sug", { hasText: "Whole Chicken" });
    await until(async () => assert.ok((await sug.count()) >= 1));
    await sug.first().click();
    const q = chip("Whole Chicken").locator(".qty");
    await until(async () => assert.equal((await q.innerText()).trim(), "×1"));
    for (const want of ["×2", "×3", "×1", "×2"]) {
      await q.click();
      await until(async () => assert.equal((await q.innerText()).trim(), want));
    }
    await page.click("#mealSave");
    await until(async () => assert.equal(await page.locator("#mealForm").isVisible(), false));
  });

  await step("the ×2 is kept when the meal is opened again", async () => {
    await page.locator("#myMeals .meal-row", { hasText: "Fajitas" }).click();
    await until(async () => assert.equal((await chip("Whole Chicken").locator(".qty").innerText()).trim(), "×2"));
    await page.click("#mealCancel");
  });

  await step("planned with only 1 chicken: 'need 1 more'", async () => {
    const today = page.locator("#dayList .day.today");
    if (!(await page.locator("#mtabs").isVisible())) await today.locator(".dh").click();
    await page.locator('#mtabs [data-s="meal"]').click();
    await page.locator("#pickList .item", { hasText: "Fajitas" }).first().click();
    const add = page.locator("#mealShopSkip");
    if (await add.isVisible()) await add.click();
    await until(async () => assert.ok(await today.locator(".meal-chip").isVisible()));
    await today.locator(".meal-open").click();
    await until(async () => assert.match(await today.locator(".meal-ings").innerText(), /Whole Chicken[\s\S]*×2[\s\S]*need 1 more/));
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  console.log("ALL MEAL QTY CHECKS PASSED");
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
