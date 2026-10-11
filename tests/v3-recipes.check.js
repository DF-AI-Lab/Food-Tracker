// V3 meals as recipes (issue #89) on the demo (Chrome, phone size).
// Run with: node tests/v3-recipes.check.js   (part of npm run check:v2next)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V2DIR || "v2-next";
const PORT = 5203;
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
  page.on("dialog", d => d.accept());
  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const text = sel => page.locator(sel).innerText();
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); }
    }
  };
  const addPack = async (name, days) => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click('[data-kind="main"]');
    await page.fill("#name", name);
    await page.fill("#days", String(days));
    await page.click("#addBtn");
    await until(async () => assert.match(await text("#addMsg"), /added/i));
  };
  const recipe = () => page.locator("#recipes .recipe").first();

  await page.goto(PAGE_URL);

  await step("fridge has chicken and bacon", async () => {
    await addPack("Chicken", 3);
    await addPack("Bacon", 5);
  });

  await step("Meals shows a Recipes section with a New recipe button", async () => {
    await page.click('[data-tab="meals"]');
    assert.ok(await page.locator("#recipes").isVisible());
    assert.match(await text("#recipes"), /Recipes/i);
    assert.ok(await page.locator("#newRecipe").isVisible());
  });

  await step("New recipe: name, fresh foods, other things with an amount", async () => {
    await page.click("#newRecipe");
    assert.ok(await page.locator("#recipeForm").isVisible());
    await page.fill("#recipeName", "Chicken pie");
    for (const f of ["Chicken", "Bacon", "Pastry"]) {
      await page.fill("#freshIn", f);
      await page.click("#freshAdd");
    }
    assert.equal(await page.locator("#recipeForm .fresh-item").count(), 3);
    await page.fill("#otherName", "White sauce packet");
    await page.fill("#otherQty", "x2");
    await page.click("#otherAdd");
    assert.equal(await page.locator("#recipeForm .other-item").count(), 1);
    await page.click("#recipeSave");
    await until(async () => assert.equal(await page.locator("#recipeForm").isVisible(), false));
  });

  await step("the recipe row says what's missing", async () => {
    await until(async () => assert.equal(await page.locator("#recipes .recipe").count(), 1));
    assert.match(await recipe().locator(".recipe-name").innerText(), /Chicken pie/);
    assert.match(await recipe().locator(".recipe-sub").innerText(), /Pastry/);
  });

  await step("tap it: ingredients drop down (fresh ticked/missing, other with amount)", async () => {
    await recipe().locator(".recipe-name").click();
    const body = recipe().locator(".recipe-body");
    assert.ok(await body.isVisible());
    assert.equal(await body.locator(".ing.have").count(), 2);
    assert.equal(await body.locator(".ing.missing").count(), 1);
    assert.match(await body.locator(".ing.missing").innerText(), /Pastry/);
    assert.match(await body.locator(".ing.other").innerText(), /White sauce packet/);
    assert.match(await body.locator(".ing.other").innerText(), /x2/);
  });

  await step("Plan: the day shows one meal chip, then offers missing food + cupboard things, ticked", async () => {
    await recipe().locator(".recipe-plan").click();
    const chip = page.locator("#dayList .day.today .meal-chip");
    await until(async () => assert.equal(await chip.count(), 1));
    assert.match(await chip.innerText(), /Chicken pie/);
    // the foods hide under the chip until it's tapped
    assert.equal(await page.locator("#dayList .day.today .meal-ings").isVisible(), false);
    assert.ok(await page.locator("#recipeShop").isVisible());
    const boxes = page.locator("#recipeShop input[type=checkbox]");
    assert.equal(await boxes.count(), 2);
    assert.equal(await boxes.nth(0).isChecked(), true);
    assert.equal(await boxes.nth(1).isChecked(), true);
    assert.match(await text("#recipeShop"), /Pastry/);
    assert.match(await text("#recipeShop"), /White sauce packet x2/);
  });

  await step("tap the meal chip: its foods drop down", async () => {
    await page.locator("#dayList .day.today .meal-chip").click();
    const ings = page.locator("#dayList .day.today .meal-ings");
    await until(async () => assert.ok(await ings.isVisible()));
    assert.match(await ings.innerText(), /Chicken/);
    assert.match(await ings.innerText(), /Bacon/);
  });

  await step("the recipe row says it's planned, not that its foods are missing", async () => {
    await until(async () => assert.match(await recipe().locator(".recipe-sub").innerText(), /Planned/));
    assert.doesNotMatch(await recipe().locator(".recipe-sub").innerText(), /Chicken|Bacon/);
  });

  await step("Add to shopping list puts Pastry and the sauce packets on the list", async () => {
    await page.click("#recipeShopAdd");
    await until(async () => assert.equal(await page.locator("#recipeShop").isVisible(), false));
    await page.click('[data-tab="shop"]');
    await until(async () => assert.match(await text("#shopList"), /Pastry/));
    assert.match(await text("#shopList"), /White sauce packet x2/);
  });

  await step("✕ on the meal chip takes the whole meal off the day", async () => {
    await page.click('[data-tab="meals"]');
    await page.locator("#dayList .day.today .meal-chip .meal-x").click();
    await until(async () => assert.equal(await page.locator("#dayList .day.today .meal-chip").count(), 0));
    assert.doesNotMatch(await text("#dayList .day.today"), /Chicken|Bacon/);
  });

  await step("picker has a Meals tab first: tap a recipe and it's planned as one chip", async () => {
    if (!(await page.locator("#mtabs").isVisible())) {
      await page.locator("#dayList .day.today").getByText(/Plan/).first().click();
    }
    const tabs = await page.locator("#mtabs .sb").allInnerTexts();
    assert.match(tabs[0], /Meals/);
    await page.locator('#mtabs [data-s="meal"]').click();
    const row = page.locator("#pickList .item", { hasText: "Chicken pie" });
    await until(async () => assert.equal(await row.count(), 1));
    assert.match(await row.innerText(), /Pastry/); // says what's missing
    await row.click();
    await until(async () => assert.equal(await page.locator("#dayList .day.today .meal-chip").count(), 1));
    assert.ok(await page.locator("#recipeShop").isVisible());
    await page.click("#recipeShopSkip");
    await page.locator("#dayList .day.today .meal-chip .meal-x").click();
    await until(async () => assert.equal(await page.locator("#dayList .day.today .meal-chip").count(), 0));
  });

  await step("Edit opens the form filled in; saving a new name updates the row", async () => {
    await page.click('[data-tab="meals"]');
    await recipe().locator(".recipe-name").click();
    await recipe().locator(".recipe-edit").click();
    assert.equal(await page.inputValue("#recipeName"), "Chicken pie");
    assert.equal(await page.locator("#recipeForm .fresh-item").count(), 3);
    await page.fill("#recipeName", "Chicken & bacon pie");
    await page.click("#recipeSave");
    await until(async () => assert.match(await recipe().locator(".recipe-name").innerText(), /Chicken & bacon pie/));
    assert.equal(await page.locator("#recipes .recipe").count(), 1);
  });

  await step("Delete removes it", async () => {
    await recipe().locator(".recipe-name").click();
    await recipe().locator(".recipe-del").click();
    await until(async () => assert.equal(await page.locator("#recipes .recipe").count(), 0));
  });

  await step("a planned day has a 'Meal?' button: opens the recipe form with that day's foods", async () => {
    const meal = page.locator("#dayList .day.today .day-meal");
    assert.match(await meal.innerText(), /Meal\?/);
    await meal.click();
    assert.ok(await page.locator("#recipeForm").isVisible());
    assert.equal(await page.inputValue("#recipeName"), "");
    const fresh = await page.locator("#recipeForm .fresh-item").allInnerTexts();
    assert.equal(fresh.length, 2);
    assert.match(fresh.join(" "), /Chicken/);
    assert.match(fresh.join(" "), /Bacon/);
  });

  await step("typing a fresh food shows tap chips, even with a spelling slip", async () => {
    await page.fill("#freshIn", "musrooms");
    const chip = page.locator("#freshSuggest .sug", { hasText: "Mushrooms" });
    await until(async () => assert.equal(await chip.count(), 1));
    await chip.click();
    assert.equal(await page.locator("#recipeForm .fresh-item").count(), 3);
    assert.equal(await page.inputValue("#freshIn"), "");
    // foods already in the recipe aren't offered again
    await page.fill("#freshIn", "chic");
    await page.waitForTimeout(150);
    assert.equal(await page.locator("#freshSuggest .sug", { hasText: /^\W*Chicken\W*$/ }).count(), 0);
  });

  await step("name it and save: it's in the Recipes list", async () => {
    await page.fill("#freshIn", "");
    await page.fill("#recipeName", "Chicken bake");
    await page.click("#recipeSave");
    await until(async () => assert.equal(await page.locator("#recipes .recipe").count(), 1));
    assert.match(await recipe().locator(".recipe-name").innerText(), /Chicken bake/);
  });

  await step("meal picker has a Misc tab: misc food can be planned", async () => {
    await page.goto(PAGE_URL); // fresh memory: today's card opens with the picker
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click('[data-kind="misc"]');
    await page.fill("#name", "Milk");
    if (await page.locator("#days").isVisible()) await page.fill("#days", "4");
    await page.click("#addBtn");
    await until(async () => assert.match(await text("#addMsg"), /added/i));
    await page.click('[data-tab="meals"]');
    const tab = page.locator('#mtabs [data-s="misc"]');
    assert.match(await tab.innerText(), /Misc/);
    await tab.click();
    const milk = page.locator("#pickList .item", { hasText: "Milk" });
    await until(async () => assert.equal(await milk.count(), 1));
    await milk.click();
    await until(async () => assert.match(await text("#dayList .day.today"), /Milk/));
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  console.log("v3 recipes check: all passed");
})().catch(e => { console.error(e); process.exit(1); });
