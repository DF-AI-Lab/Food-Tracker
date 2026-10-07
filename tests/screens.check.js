// Click-through check of the real page in Chrome (phone size).
// Run with: npm run check:screens   (needs Playwright installed)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

const URL = "file://" + path.join(__dirname, "..", "index.html") + "?today=2026-10-07";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const text = sel => page.locator(sel).innerText();
  // Saving is async: retry an assertion for up to 3s before failing.
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); }
    }
  };

  await page.goto(URL);

  await step("top line shows today", async () => {
    assert.match(await text("#today"), /Wed 7 Oct/);
  });

  await step("fridge starts empty", async () => {
    assert.equal(await page.locator("#mains .pack").count(), 0);
  });

  await step("usual buttons show starters", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-kind="main"]');
    const names = await page.locator("#usuals .usual").allInnerTexts();
    assert.deepEqual(names.slice(0, 4), ["Chicken", "Mince", "Sausages", "Gammon"]);
  });

  await step("add 2 packs of sausages by DDMM", async () => {
    await page.click('#usuals .usual:has-text("Sausages")');
    assert.equal(await page.inputValue("#name"), "Sausages");
    await page.fill("#ddmm", "0910");
    assert.match(await text("#datePreview"), /Fri 9 Oct/);
    await page.click("#plus");
    assert.equal(await text("#count"), "2");
    await page.click("#addBtn");
    await until(async () => assert.match(await text("#addMsg"), /added/i));
  });

  await step("add chicken by days box", async () => {
    await page.click('[data-kind="main"]');
    await page.fill("#name", "chicken");
    await page.fill("#days", "1");
    assert.match(await text("#datePreview"), /Thu 8 Oct/);
    await page.click("#addBtn");
  });

  await step("past date warns", async () => {
    await page.fill("#name", "Gammon");
    await page.fill("#ddmm", "0110");
    assert.match(await text("#datePreview"), /out of date, check\?/i);
    await page.fill("#ddmm", "");
    await page.fill("#name", "");
  });

  await step("add veg with no date", async () => {
    await page.click('[data-kind="side"]');
    await page.fill("#name", "Carrots");
    await page.check("#noDate");
    await page.click("#addBtn");
  });

  await step("main needs a date", async () => {
    await page.click('[data-kind="main"]');
    await page.fill("#name", "Mince");
    await page.click("#addBtn");
    assert.match(await text("#addMsg"), /date/i);
    await page.fill("#name", "");
  });

  await step("fridge shows cards, countdowns, veg", async () => {
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    const cards = await page.locator("#mains .card .name").allInnerTexts();
    assert.deepEqual(cards, ["Chicken", "Sausages"]);
    assert.equal(await page.locator('#mains .card:has-text("Sausages") .pack').count(), 2);
    assert.match(await text("#mains"), /1 day left/);
    assert.match(await text("#mains"), /2 days left/);
    assert.match(await text("#veg"), /Carrots/);
    assert.equal(await text("#mainCount"), "3");
  });

  await step("tap pack -> Used, then Undo", async () => {
    await page.locator('#mains .card:has-text("Chicken") .pack').first().click();
    await page.click("#actUsed");
    await until(async () => assert.equal(await page.locator('#mains .card:has-text("Chicken")').count(), 0));
    await page.click("#undoBtn");
    await until(async () => assert.equal(await page.locator('#mains .card:has-text("Chicken")').count(), 1));
  });

  await step("thrown away shows in Used list", async () => {
    await page.locator('#mains .card:has-text("Chicken") .pack').first().click();
    await page.click("#actThrown");
    await page.click('[data-view="used"]');
    await until(async () => assert.equal(await text("#wastedCount"), "1"));
    assert.match(await text("#usedList"), /Chicken/);
  });

  await step("freeze then defrost", async () => {
    await page.click('[data-view="fridge"]');
    await page.locator('#mains .card:has-text("Sausages") .pack').first().click();
    await page.click("#actFreeze");
    await page.click('[data-view="freezer"]');
    await until(async () => assert.match(await text("#freezerList"), /Sausages/));
    await page.click("#freezerList .defrost");
    await until(async () => assert.equal(await page.locator("#freezerList .frz").count(), 0));
  });

  await step("saved after reload", async () => {
    await page.reload();
    await page.click('[data-view="fridge"]');
    assert.equal(await page.locator('#mains .card:has-text("Sausages") .pack').count(), 2);
    assert.match(await text("#veg"), /Carrots/);
  });

  await step("usual buttons re-order by most added", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-kind="main"]');
    assert.equal(await page.locator("#usuals .usual").first().innerText(), "Sausages");
  });

  await step("meals tab says coming soon", async () => {
    await page.click('[data-tab="meals"]');
    assert.match(await page.locator("body").innerText(), /Coming soon/i);
  });

  await step("theme toggle", async () => {
    const before = await page.getAttribute("html", "data-theme");
    await page.click("#theme");
    assert.notEqual(await page.getAttribute("html", "data-theme"), before);
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  console.log("ALL SCREEN CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
