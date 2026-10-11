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

  await step("Plan: plans what's there, then offers the missing food, ticked", async () => {
    await recipe().locator(".recipe-plan").click();
    await until(async () => {
      const today = await text("#dayList .day.today");
      assert.match(today, /Chicken/);
      assert.match(today, /Bacon/);
    });
    assert.ok(await page.locator("#recipeShop").isVisible());
    const boxes = page.locator("#recipeShop input[type=checkbox]");
    assert.equal(await boxes.count(), 1);
    assert.equal(await boxes.first().isChecked(), true);
    assert.match(await text("#recipeShop"), /Pastry/);
  });

  await step("Add to shopping list puts Pastry on the list", async () => {
    await page.click("#recipeShopAdd");
    await until(async () => assert.equal(await page.locator("#recipeShop").isVisible(), false));
    await page.click('[data-tab="shop"]');
    await until(async () => assert.match(await text("#shopList"), /Pastry/));
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

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  console.log("v3 recipes check: all passed");
})().catch(e => { console.error(e); process.exit(1); });
