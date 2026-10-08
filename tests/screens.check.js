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

  await step("quick fill: paste JSON, check list, untick one, add", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="quick"]');
    await page.fill("#qfText", '```json\n[{"name":"Gammon","kind":"main","date":"2026-10-10","packs":2},' +
      '{"name":"Peas","kind":"veg","date":null},{"name":"Chicken","kind":"main","date":null},' +
      '{"name":"Milk","kind":"misc","date":"2026-10-09"}]\n```');
    await page.click("#qfCheck");
    assert.equal(await page.locator("#qfList .qf-row").count(), 4);
    assert.match(await text("#qfList"), /Gammon ×2/);
    // bad row (no date) is shown unticked with its problem
    const bad = page.locator('#qfList .qf-row:has-text("Chicken")');
    assert.equal(await bad.locator("input[type=checkbox]").isChecked(), false);
    assert.match(await bad.innerText(), /date/i);
    // untick Milk
    await page.locator('#qfList .qf-row:has-text("Milk") input[type=checkbox]').uncheck();
    await page.click("#qfAdd");
    await until(async () => assert.match(await text("#qfMsg"), /added 3/i));
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    assert.equal(await page.locator('#mains .card:has-text("Gammon") .pack').count(), 2);
    assert.match(await text("#veg"), /Peas/);
    assert.doesNotMatch(await text("#misc"), /Milk/);
  });

  await step("quick fill: undo removes the whole batch", async () => {
    await page.click("#undoBtn");
    await until(async () => assert.equal(await page.locator('#mains .card:has-text("Gammon")').count(), 0));
    assert.doesNotMatch(await text("#veg"), /Peas/);
  });

  await step("quick fill: bad JSON shows a message", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="quick"]');
    await page.fill("#qfText", "not json");
    await page.click("#qfCheck");
    assert.match(await text("#qfMsg"), /read/i);
  });

  await step("quick fill: Claude message is on the page", async () => {
    assert.match(await page.locator("#qfPrompt").textContent(), /"kind"/);
  });

  await step("normal add still reachable", async () => {
    await page.click('[data-sub="fridge"]');
    assert.ok(await page.locator("#addBtn").isVisible());
  });

  await step("meals tab says coming soon", async () => {
    await page.click('[data-tab="meals"]');
    assert.match(await page.locator("body").innerText(), /Coming soon/i);
  });

  await step("delete: red line + undo, not counted as used", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click('[data-kind="main"]');
    await page.fill("#name", "Haggis");
    await page.fill("#days", "3");
    await page.click("#addBtn");
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    await until(async () => assert.equal(await page.locator('#mains .card:has-text("Haggis")').count(), 1));
    await page.click('#mains .card:has-text("Haggis") .pack');
    await page.click("#actDelete");
    await until(async () => assert.equal(await page.locator('#mains .card:has-text("Haggis")').count(), 0));
    const row = page.locator('#deletedList .gone:has-text("Haggis")');
    assert.equal(await row.count(), 1);
    const deco = await row.locator(".name").evaluate(e => getComputedStyle(e).textDecorationLine);
    assert.match(deco, /line-through/);
    await page.click('[data-view="used"]');
    assert.doesNotMatch(await text("#usedList"), /Haggis/);
    await page.click('[data-view="fridge"]');
    await row.locator(".undo").click();
    await until(async () => assert.equal(await page.locator('#mains .card:has-text("Haggis")').count(), 1));
    assert.equal(await page.locator('#deletedList .gone').count(), 0);
  });

  await step("look: forest dark background", async () => {
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, "rgb(5, 31, 32)");
  });

  await step("look: floating tiles (shadow + rounded, no hard border)", async () => {
    const st = await page.locator("#mains .card").first().evaluate(e => {
      const c = getComputedStyle(e);
      return { shadow: c.boxShadow, radius: parseFloat(c.borderTopLeftRadius), border: c.borderTopWidth };
    });
    assert.notEqual(st.shadow, "none");
    assert.ok(st.radius >= 12, "radius " + st.radius);
    assert.equal(st.border, "0px");
  });

  await step("look: Mains | Sides are fixed boxes that scroll on their own", async () => {
    for (const sel of ["#mains", "#sides", "#misc", "#veg"]) {
      const oy = await page.locator(sel).evaluate(e => getComputedStyle(e).overflowY);
      assert.equal(oy, "auto", sel + " overflowY");
    }
    const cols = page.locator("#fridgeView .column");
    assert.equal(await cols.count(), 2);
    const boxes = await cols.evaluateAll(els => els.map(e => e.getBoundingClientRect()));
    assert.ok(Math.abs(boxes[0].top - boxes[1].top) < 2, "columns side by side");
    assert.ok(Math.abs(boxes[0].height - boxes[1].height) < 2, "columns same fixed height");
    assert.ok(boxes[0].height >= 300, "columns tall enough");
    // misc sits in the bottom part of the Mains box, veg in the bottom of Sides
    const mainsBox = await page.locator("#fridgeView .column").first().boundingBox();
    const miscBox = await page.locator("#misc").boundingBox();
    assert.ok(miscBox.y + miscBox.height <= mainsBox.y + mainsBox.height + 1, "misc inside mains box");
  });

  await step("look: Use by toggle sits on the date line", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    assert.ok(await page.locator('.date-line [data-dt="use_by"]').count() >= 1);
    await page.click('[data-tab="fridge"]');
  });

  await step("exact mock: fonts, labels and small details", async () => {
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    const font = await page.locator("#today").evaluate(e => getComputedStyle(e).fontFamily);
    assert.match(font, /Fredoka/);
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    assert.match(bodyFont, /Nunito Sans/);
    // packs show the countdown on the left and USE BY / BB tag on the right
    const tag = page.locator("#mains .pack .tag").first();
    assert.match(await tag.innerText(), /^(USE BY|BB|🍽️ \w+)$/i);
    // print button sits in the Mains header
    assert.equal(await page.locator(".column:first-child .pbtn").count(), 1);
    // moon + sun buttons
    assert.equal(await page.locator("#top button").count(), 2);
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    assert.match(await page.locator("body").innerText(), /USUAL · TAP ONE/i);
    assert.match(await page.locator("body").innerText(), /Packs/);
    await page.fill("#ddmm", "");
    await page.fill("#days", "");
    assert.match(await text("#datePreview"), /No date picked yet/);
    // the mic sits on the same line as the name box
    const nb = await page.locator("#name").boundingBox();
    const mic = await page.locator("#mic").boundingBox();
    assert.ok(Math.abs(nb.y - mic.y) < 6, "mic on the name line");
    await page.click('[data-tab="fridge"]');
  });

  await step("theme toggle", async () => {
    const before = await page.getAttribute("html", "data-theme");
    await page.click("#theme");
    assert.notEqual(await page.getAttribute("html", "data-theme"), before);
  });

  await step("look: light mode is mid sage, not pale", async () => {
    assert.equal(await page.getAttribute("html", "data-theme"), "light");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, "rgb(169, 201, 178)");
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  console.log("ALL SCREEN CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
