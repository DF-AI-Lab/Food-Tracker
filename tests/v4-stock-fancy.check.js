// Stock check, By date list, + takes the next photo, Meals I fancy (Darren 2026-10-21).
// Run with: node tests/v4-stock-fancy.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5215;
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
  const addFood = async (kind, name, days) => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click(`[data-kind="${kind}"]`);
    await page.fill("#name", name);
    await page.fill("#days", String(days));
    await page.click("#addBtn");
    await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
  };

  await page.goto(url("2026-10-21", 10));

  await step("fridge has Chicken (main, 4 days) and Yoghurt (other, 1 day)", async () => {
    await addFood("main", "Chicken", 4);
    await addFood("misc", "Yoghurt", 1);
  });

  await step("+ on Quick fill opens the camera for the next photo (every tap)", async () => {
    await page.click('[data-tab="add"]');
    await until(async () => assert.ok(await page.locator("#qfTake").isVisible()));
    for (let i = 0; i < 2; i++) {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('[data-tab="add"]')]);
      assert.ok(chooser);
    }
  });

  await step("+ from another page just opens Add (no camera)", async () => {
    await page.click('[data-tab="fridge"]');
    let opened = false;
    const on = () => { opened = true; };
    page.on("filechooser", on);
    await page.click('[data-tab="add"]');
    await page.waitForTimeout(400);
    page.off("filechooser", on);
    assert.equal(opened, false);
  });

  await step("Fridge: By date shows one list, soonest first: Food · Section · Date", async () => {
    await page.click('[data-tab="fridge"]');
    await page.click("#byDateBtn");
    const rows = page.locator("#byDateList .bd-row");
    await until(async () => assert.equal(await rows.count(), 2));
    assert.match(await rows.nth(0).innerText(), /Yoghurt[\s\S]*Other[\s\S]*22 Oct/);
    assert.match(await rows.nth(1).innerText(), /Chicken[\s\S]*Mains[\s\S]*25 Oct/);
    assert.equal(await page.locator("#fridgeView").isVisible(), false);
  });

  await step("tap By date again: back to the sections", async () => {
    await page.click("#byDateBtn");
    await until(async () => assert.equal(await page.locator("#fridgeView").isVisible(), true));
    assert.equal(await page.locator("#byDateList").isVisible(), false);
  });

  await step("Stock check: pick Mains, Chicken is there; mark it Gone and it leaves the fridge", async () => {
    await page.click("#stockBtn");
    await until(async () => assert.ok(await page.locator("#stockPanel").isVisible()));
    await page.click('#stockPanel [data-stock="main"]');
    const row = page.locator("#stockList .stock-row", { hasText: "Chicken" });
    await until(async () => assert.equal(await row.count(), 1));
    await row.locator(".stock-gone").click();
    await until(async () => assert.equal(await page.locator("#stockList .stock-row", { hasText: "Chicken" }).count(), 0));
  });

  await step("Stock check: Other, Yoghurt 'Still there' gets ticked and stays", async () => {
    await page.click('#stockPanel [data-stock="misc"]');
    const row = page.locator("#stockList .stock-row", { hasText: "Yoghurt" });
    await until(async () => assert.equal(await row.count(), 1));
    await row.locator(".stock-there").click();
    await until(async () => assert.ok(await row.evaluate(el => el.classList.contains("ok"))));
    await page.click("#stockDone");
    await until(async () => assert.equal(await page.locator("#stockPanel").isVisible(), false));
    assert.equal((await page.locator("#mainCount").innerText()).trim(), "0");
    assert.equal((await page.locator("#miscCount").innerText()).trim(), "1");
  });

  await step("Meals: new meal Tacos with Peppers (not in the fridge)", async () => {
    await page.click('[data-tab="meals"]');
    await page.click("#newMeal");
    await page.fill("#mealName", "Tacos");
    await page.fill("#freshIn", "Peppers");
    await page.locator("#freshSuggest .sug", { hasText: "Peppers" }).first().click();
    await page.click("#mealSave");
    await until(async () => assert.equal(await page.locator("#mealForm").isVisible(), false));
  });

  await step("star Tacos: it is on Meals I fancy and Peppers go on the shopping list", async () => {
    const row = page.locator("#myMeals .meal-line", { hasText: "Tacos" });
    await row.locator(".meal-fancy").click();
    await until(async () => assert.match(await page.locator("#fancyMeals").innerText(), /Tacos/));
    await page.click('[data-tab="shop"]');
    await until(async () => assert.match(await page.locator("#shopList").innerText(), /Peppers/));
  });

  await step("the star is kept after editing the meal", async () => {
    await page.click('[data-tab="meals"]');
    await page.locator("#myMeals .meal-row", { hasText: "Tacos" }).click();
    await page.fill("#mealName", "Beef tacos");
    await page.click("#mealSave");
    await until(async () => assert.match(await page.locator("#fancyMeals").innerText(), /Beef tacos/));
  });

  await step("unstar: off Meals I fancy (the shopping list keeps Peppers)", async () => {
    await page.locator("#myMeals .meal-line", { hasText: "Beef tacos" }).locator(".meal-fancy").click();
    await until(async () => assert.doesNotMatch(await page.locator("#fancyMeals").innerText(), /tacos/i));
    await page.click('[data-tab="shop"]');
    assert.match(await page.locator("#shopList").innerText(), /Peppers/);
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  console.log("ALL STOCK / FANCY CHECKS PASSED");
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
