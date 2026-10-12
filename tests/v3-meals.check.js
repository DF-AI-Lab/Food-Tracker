// V3 meals reset (issue #89, agreed with Darren 2026-10-12) on the demo (Chrome, phone size).
// Run with: node tests/v3-meals.check.js   (part of npm run check:v2next)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V2DIR || "v2-next";
const PORT = 5204;
const ROOT = path.join(__dirname, "..");
const PAGE_URL = `http://localhost:${PORT}/Food-Tracker/${APP_DIR}/?local=1&today=2026-10-07&hour=10`;
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
  const text = sel => page.locator(sel).innerText();
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); }
    }
  };
  const addPack = async (name, kind, days) => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click(`[data-kind="${kind}"]`);
    await page.fill("#name", name);
    if (days != null && await page.locator("#days").isVisible()) await page.fill("#days", String(days));
    await page.click("#addBtn");
    await until(async () => assert.match(await text("#addMsg"), /added/i));
  };
  const today = () => page.locator("#dayList .day.today");
  const chip = () => today().locator(".meal-chip");
  const mealRow = name => page.locator("#myMeals .meal-row", { hasText: name });
  const openPicker = async () => {
    if (!(await page.locator("#mtabs").isVisible())) await today().getByText(/Plan/).first().click();
    await until(async () => assert.ok(await page.locator("#mtabs").isVisible()));
  };
  const typeFresh = async (typed, pick) => {
    await page.fill("#freshIn", typed);
    const sug = page.locator("#freshSuggest .sug", { hasText: pick });
    await until(async () => assert.ok((await sug.count()) >= 1));
    await sug.first().click();
  };

  await page.goto(PAGE_URL);

  await step("fridge has chicken and bacon; Add food tidies the name", async () => {
    await addPack("Chicken", "main", 3);
    await addPack("  bacon ", "main", 5);
    assert.match(await text("#addMsg"), /Bacon/);
  });

  await step("Meals page: one 'My meals' list with New meal; old lists are gone", async () => {
    await page.click('[data-tab="meals"]');
    assert.match(await text("#myMeals"), /My meals/i);
    assert.ok(await page.locator("#newMeal").isVisible());
    assert.equal(await page.locator("#mealIdeas").count(), 0);
    assert.equal(await page.locator("#recipes").count(), 0);
  });

  await step("New meal: spelling-friendly chips, everyday foods, + Add new, 'some' toggle", async () => {
    await page.click("#newMeal");
    assert.ok(await page.locator("#mealForm").isVisible());
    await typeFresh("chik", "Chicken");
    await typeFresh("bacn", "Bacon");
    await typeFresh("pastr", "Pastry");          // never bought: from the everyday list
    await page.fill("#freshIn", "toad in the hole");
    const add = page.locator("#freshSuggest .sug.new");
    await until(async () => assert.match(await add.innerText(), /Add new: Toad in the hole/));
    await add.click();
    assert.equal(await page.locator("#mealForm .fresh-item").count(), 4);
    await page.locator("#mealForm .fresh-item", { hasText: "Toad in the hole" }).locator(".rm").click();
    assert.equal(await page.locator("#mealForm .fresh-item").count(), 3);
    const bacon = page.locator("#mealForm .fresh-item", { hasText: "Bacon" });
    await bacon.locator(".some").click();
    assert.equal(await bacon.locator(".some").getAttribute("aria-pressed"), "true");
  });

  await step("Other items with an amount; save tidies the name", async () => {
    await page.fill("#otherName", "white sauce packet");
    await page.fill("#otherQty", "x2");
    await page.click("#otherAdd");
    assert.match(await page.locator("#mealForm .other-item").innerText(), /White sauce packet x2/);
    await page.fill("#mealName", "chicken pie");
    await page.click("#mealSave");
    await until(async () => assert.equal(await page.locator("#mealForm").isVisible(), false));
    await until(async () => assert.equal(await mealRow("Chicken pie").count(), 1));
    assert.match(await mealRow("Chicken pie").locator(".meal-sub").innerText(), /Need Pastry/);
  });

  await step("Same name twice is refused with a message", async () => {
    await page.click("#newMeal");
    await page.fill("#mealName", "CHICKEN PIE");
    await typeFresh("chick", "Chicken");
    await page.click("#mealSave");
    await until(async () => assert.match(await text("#mealErr"), /You already have Chicken pie/));
    await page.click("#mealCancel");
    assert.equal(await page.locator("#myMeals .meal-row").count(), 1);
  });

  await step("+ Plan opens on the Meals tab; tapping a meal plans it as one chip", async () => {
    await openPicker();
    const tabs = page.locator("#mtabs .sb");
    assert.match(await tabs.first().innerText(), /Meals/);
    assert.match(await tabs.first().getAttribute("class"), /\bon\b/);
    const row = page.locator("#pickList .item", { hasText: "Chicken pie" });
    await until(async () => assert.equal(await row.count(), 1));
    assert.match(await row.innerText(), /Pastry/);
    await row.click();
    await until(async () => assert.equal(await chip().count(), 1));
    assert.match(await chip().innerText(), /Chicken pie/);
    assert.equal(await today().locator(".meal-ings").count(), 0); // closed until tapped
  });

  await step("shopping offer: missing food + other items, all ticked", async () => {
    const shop = page.locator("#mealShop");
    await until(async () => assert.ok(await shop.isVisible()));
    const boxes = shop.locator("input[type=checkbox]");
    assert.equal(await boxes.count(), 2);
    assert.equal(await boxes.nth(0).isChecked(), true);
    assert.equal(await boxes.nth(1).isChecked(), true);
    assert.match(await shop.innerText(), /Pastry/);
    assert.match(await shop.innerText(), /White sauce packet x2/);
    await page.click("#mealShopAdd");
    await until(async () => assert.equal(await shop.isVisible(), false));
    await page.click('[data-tab="shop"]');
    await until(async () => assert.match(await text("#shopList"), /Pastry/));
    assert.match(await text("#shopList"), /White sauce packet x2/);
  });

  await step("My meals says it's planned", async () => {
    await page.click('[data-tab="meals"]');
    await until(async () => assert.match(await mealRow("Chicken pie").locator(".meal-sub").innerText(), /Planned/));
  });

  await step("tap the chip: foods drop down, Pastry needed; skip Bacon just this time", async () => {
    await chip().locator(".meal-open").click();
    const ings = today().locator(".meal-ings");
    await until(async () => assert.ok(await ings.isVisible()));
    assert.match(await ings.innerText(), /Chicken/);
    assert.equal(await ings.locator(".ing.need", { hasText: "Pastry" }).count(), 1);
    await ings.locator(".ing", { hasText: "Bacon" }).locator(".skip").click();
    await until(async () => assert.equal(await ings.locator(".ing.skipped", { hasText: "Bacon" }).count(), 1));
  });

  await step("buy pastry: it joins the planned meal by itself", async () => {
    await addPack("Pastry", "side", 6);
    await page.click('[data-tab="meals"]');
    if (!(await today().locator(".meal-ings").isVisible())) await chip().locator(".meal-open").click();
    await until(async () => assert.equal(await today().locator(".meal-ings .ing.need").count(), 0));
  });

  await step("tap the meal in My meals: edit form, filled in; rename updates the chip", async () => {
    await mealRow("Chicken pie").click();
    assert.ok(await page.locator("#mealForm").isVisible());
    assert.equal(await page.inputValue("#mealName"), "Chicken pie");
    assert.equal(await page.locator("#mealForm .fresh-item").count(), 3);
    assert.equal(await page.locator("#mealForm .fresh-item", { hasText: "Bacon" }).locator(".some").getAttribute("aria-pressed"), "true");
    await page.fill("#mealName", "Chicken and bacon pie");
    await page.click("#mealSave");
    await until(async () => assert.match(await chip().innerText(), /Chicken and bacon pie/));
  });

  await step("✕ on the chip takes the whole meal off the day", async () => {
    await chip().locator(".meal-x").click();
    await until(async () => assert.equal(await chip().count(), 0));
    assert.doesNotMatch(await mealRow("Chicken and bacon pie").locator(".meal-sub").innerText(), /Planned/);
  });

  await step("Save as meal: a day's single foods start a new meal", async () => {
    await openPicker();
    await page.locator('#mtabs [data-s="main"]').click();
    await page.locator("#pickList .item", { hasText: "Chicken" }).first().click();
    const save = today().locator(".day-meal");
    await until(async () => assert.match(await save.innerText(), /Save as meal/));
    await save.click();
    assert.ok(await page.locator("#mealForm").isVisible());
    assert.equal(await page.inputValue("#mealName"), "");
    assert.match(await page.locator("#mealForm .fresh-item").first().innerText(), /Chicken/);
    await page.click("#mealCancel");
  });

  await step("Delete asks first, then the meal goes", async () => {
    await mealRow("Chicken and bacon pie").click();
    await page.click("#mealDelete");
    await until(async () => assert.ok(await page.locator("#mealDelYes").isVisible()));
    await page.click("#mealDelYes");
    await until(async () => assert.equal(await page.locator("#myMeals .meal-row").count(), 0));
  });

  await step("Misc tab in the picker still plans misc food", async () => {
    await addPack("Milk", "misc", 4);
    await page.click('[data-tab="meals"]');
    await openPicker();
    await page.locator('#mtabs [data-s="misc"]').click();
    const milk = page.locator("#pickList .item", { hasText: "Milk" });
    await until(async () => assert.equal(await milk.count(), 1));
    await milk.click();
    await until(async () => assert.match(await today().innerText(), /Milk/));
  });

  await step("shopping list tidies typed names", async () => {
    await page.click('[data-tab="shop"]');
    await page.fill("#shopIn", "  gravy   granules ");
    await page.press("#shopIn", "Enter");
    await until(async () => assert.match(await text("#shopList"), /Gravy granules/));
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  console.log("v3 meals check: all passed");
})().catch(e => { console.error(e); process.exit(1); });
