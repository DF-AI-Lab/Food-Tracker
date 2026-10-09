// Click-through check of the real page in Chrome (phone size).
// Run with: npm run check:screens   (needs Playwright installed)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

// The app now saves through the local SQLite server, so start one on a
// throwaway data folder (never the real one).
const PORT = 5199;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ft-screens-"));
const URL = `http://localhost:${PORT}/index.html?today=2026-10-07`;

async function startServer() {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: { ...process.env, FT_PORT: String(PORT), FT_DATA_DIR: DATA_DIR },
    stdio: "inherit",
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/api/packs`)).ok) return srv; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  srv.kill();
  throw new Error("server did not start");
}
let server;
process.on("exit", () => server && server.kill());

(async () => {
  server = await startServer();
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

  await step("kind buttons: Main / Side / Veg / Misc", async () => {
    const kinds = await page.locator(".mtabs [data-kind]").evaluateAll(els => els.map(e => e.dataset.kind));
    assert.deepEqual(kinds, ["main", "side", "veg", "misc"]);
    assert.match(await page.locator('[data-kind="veg"]').innerText(), /Veg/);
  });

  await step("add veg: no date ticked for you", async () => {
    await page.click('[data-kind="veg"]');
    assert.equal(await page.isChecked("#noDate"), true);
    assert.ok((await page.locator("#usuals .usual").allInnerTexts()).includes("Carrots"));
    await page.fill("#name", "Carrots");
    await page.click("#addBtn");
    await until(async () => assert.match(await text("#addMsg"), /added/i));
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

  await step("meals: plan a day main -> side -> veg, summary", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="quick"]');
    await page.fill("#qfText", JSON.stringify([
      { name: "Pork", kind: "main", date: "2026-10-20" }, { name: "Salmon", kind: "main", date: "2026-10-06" },
      { name: "Coleslaw", kind: "side", date: "2026-10-12" }, { name: "Peas", kind: "veg", date: null }]));
    await page.click("#qfCheck");
    await page.click("#qfAdd");
    await until(async () => assert.match(await text("#qfMsg"), /added 4/i));
    await page.click('[data-tab="meals"]');
    // one column: no right-hand picker, no summary card, no tip line
    assert.equal(await page.locator(".mgrid").count(), 0);
    assert.equal(await page.locator("#weekSum").count(), 0);
    assert.equal(await page.locator("#printWeek").count(), 0);
    assert.equal(await page.locator("#dayList .day").count(), 7);
    // today (Wed 7) is first, white-bordered, labelled and open; then the next 6 days
    const first = page.locator("#dayList .day").first();
    assert.match(await first.getAttribute("class"), /\btoday\b/);
    assert.match(await first.locator(".dh").innerText(), /Wed[\s\S]*TODAY/i);
    assert.equal(await page.locator("#dayList .day.open").count(), 1);
    assert.match(await page.locator("#dayList .day.open .dh").innerText(), /Wed/);
    assert.match(await page.locator("#dayList .day").last().locator(".dh").innerText(), /Tue/);
    assert.equal(await page.locator("#dayList .day.today").count(), 1);
    const dh = d => page.locator(`#dayList .dh:has-text("${d}")`);
    await dh("Thu").click();
    assert.equal(await page.locator("#dayList .day.open").count(), 1);
    assert.equal(await page.locator('#dayList .day.open #pickList').count(), 1);
    assert.match(await page.locator("#dayList .day.open .dh").innerText(), /Thu/);
    assert.match(await text("#pickFor"), /Thu/);
    // days are full width
    const list = await page.locator("#dayList").boundingBox();
    const day = await page.locator("#dayList .day.open").boundingBox();
    assert.ok(day.width >= list.width - 2, "day full width");
    await page.click('#pickList .item:has-text("Pork")');
    await until(async () => assert.match(await dh("Thu").innerText(), /Pork/));
    // stays on Mains so more can be picked; "Sides ▸" moves on
    assert.match(await page.locator("#mtabs .on").innerText(), /Mains/);
    assert.match(await text("#nextSlot"), /Sides ▸/);
    await page.click("#nextSlot");
    assert.match(await page.locator("#mtabs .on").innerText(), /Sides/);
    await page.click('#pickList .item:has-text("Coleslaw")');
    await until(async () => assert.match(await dh("Thu").innerText(), /Coleslaw/));
    assert.match(await page.locator("#mtabs .on").innerText(), /Sides/);
    assert.match(await text("#nextSlot"), /Veg ▸/);
    await page.click("#nextSlot");
    assert.match(await page.locator("#mtabs .on").innerText(), /Veg/);
    assert.equal(await page.locator("#nextSlot").isVisible(), false);
    await page.click('#pickList .item:has-text("Peas")');
    await until(async () => assert.match(await dh("Thu").innerText(), /Pork[\s\S]*Coleslaw[\s\S]*Peas/));
    // tapping the open day's header closes it
    await dh("Thu").click();
    assert.equal(await page.locator("#dayList .day.open").count(), 0);
    await dh("Thu").click();
  });

  await step("meals: out-of-date warning, add anyway, then remove", async () => {
    const dh = d => page.locator(`#dayList .dh:has-text("${d}")`);
    await page.click("#nextDay");
    assert.match(await page.locator("#dayList .day.open .dh").innerText(), /Fri/);
    assert.match(await text("#pickFor"), /Fri/);
    assert.match(await page.locator("#mtabs .on").innerText(), /Mains/);
    await page.click('#pickList .item:has-text("Salmon")');
    await until(async () => assert.match(await text("#warnBar"), /Salmon will be 3 days out by Fri/));
    await page.click("#wYes");
    const fri = dh("Fri");
    await until(async () => assert.equal(await fri.locator(".chip2.warn:has-text('Salmon')").count(), 1));
    await fri.locator(".chip2:has-text('Salmon') .x").click();
    await until(async () => assert.doesNotMatch(await fri.innerText(), /Salmon/));
  });

  await step("meals: takeaway fills the day and moves on", async () => {
    const dh = d => page.locator(`#dayList .dh:has-text("${d}")`);
    await dh("Sat").click();
    await page.click("#pickList .item.ta");
    await until(async () => assert.match(await dh("Sat").innerText(), /Takeaway/));
    assert.match(await text("#pickFor"), /Sun/);
    assert.match(await page.locator("#dayList .day.open .dh").innerText(), /Sun/);
  });

  await step("meals: planned pack shows white outline + day on the fridge", async () => {
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    const pack = page.locator('#mains .card:has-text("Pork") .pack').first();
    assert.match(await pack.getAttribute("class"), /\bplan\b/);
    assert.match(await pack.locator(".tag").innerText(), /Thu/i);
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

  await step("look: 4 full-width boxes stacked, fold on tap, no Select", async () => {
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    assert.equal(await page.locator("#selectBtn").count(), 0);
    assert.equal(await page.locator("#freezeSel").count(), 0);
    const boxes = page.locator("#fridgeView details.fbox");
    assert.equal(await boxes.count(), 4);
    const heads = await page.locator("#fridgeView details.fbox > summary").allInnerTexts();
    ["Mains", "Sides", "Veg", "Misc"].forEach((n, i) => assert.match(heads[i], new RegExp(n)));
    const r = await boxes.evaluateAll(els => els.map(e => e.getBoundingClientRect()));
    for (let i = 1; i < 4; i++) {
      assert.ok(r[i].top >= r[i - 1].bottom - 1, "box " + i + " below the one before");
      assert.ok(Math.abs(r[i].width - r[0].width) < 2, "same width");
    }
    const view = await page.locator("#fridgeView").boundingBox();
    assert.ok(r[0].width >= view.width - 2, "full width");
    // tapping the header folds and unfolds the box
    const mains = boxes.first();
    const wasOpen = await mains.evaluate(e => e.open);
    await mains.locator("summary").click();
    assert.equal(await mains.evaluate(e => e.open), !wasOpen);
    await mains.locator("summary").click();
    assert.equal(await mains.evaluate(e => e.open), wasOpen);
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
    // print button sits in the top bar, between the date and the light/dark buttons
    assert.equal(await page.locator("#top #printF").count(), 1);
    assert.equal(await page.locator("#fridgeView .pbtn").count(), 0);
    const d = await page.locator("#today").boundingBox();
    const pr = await page.locator("#printF").boundingBox();
    const moon = await page.locator("#theme").boundingBox();
    assert.ok(pr.x >= d.x + d.width && pr.x + pr.width <= moon.x, "print between date and theme");
    // one theme button: shows the other mode's icon
    assert.equal(await page.locator("#top button").count(), 4); // refresh + scan + print + theme
    assert.equal(await page.locator("#themeDark").count(), 0);
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

  const openShop = async () => { await page.click('[data-tab="add"]'); await page.click('[data-sub="shop"]'); };
  const shopRow = name => page.locator(`#shopList .srow:has-text("${name}")`);

  await step("shopping: type, tick + undo, delete with red line + undo", async () => {
    await openShop();
    await page.fill("#shopIn", "Bread");
    await page.press("#shopIn", "Enter");
    await until(async () => assert.equal(await shopRow("Bread").count(), 1));
    await shopRow("Bread").locator("input[type=checkbox]").check();
    await until(async () => assert.match(await shopRow("Bread").getAttribute("class"), /\bgot\b/));
    assert.match(await shopRow("Bread").locator("label").evaluate(e => getComputedStyle(e).textDecorationLine), /line-through/);
    await shopRow("Bread").locator(".undo").click();
    await until(async () => assert.doesNotMatch(await shopRow("Bread").getAttribute("class"), /\bgot\b/));
    await shopRow("Bread").locator(".del").click();
    await until(async () => assert.match(await shopRow("Bread").getAttribute("class"), /\bgone\b/));
    assert.match(await shopRow("Bread").innerText(), /gone tomorrow/i);
    await shopRow("Bread").locator(".undo").click();
    await until(async () => assert.doesNotMatch(await shopRow("Bread").getAttribute("class"), /\bgone\b/));
  });

  await step("shopping: bought-before chips, got all, clear crossed out", async () => {
    await page.click('#qtabs [data-q="main"]');
    await page.click('#qchips .qc:has-text("Sausages")');
    await until(async () => assert.equal(await shopRow("Sausages").count(), 1));
    await page.click("#gotAll");
    await until(async () => assert.equal(await page.locator("#shopList .srow:not(.got):not(.gone)").count(), 0));
    await page.click("#clearGot");
    await until(async () => assert.equal(await page.locator("#shopList .srow.got").count(), 0));
  });

  await step("shopping: clear all asks Sure? first", async () => {
    await page.fill("#shopIn", "Jam");
    await page.press("#shopIn", "Enter");
    await until(async () => assert.equal(await shopRow("Jam").count(), 1));
    await page.click("#clearAll");
    assert.ok(await page.locator("#clrAsk").isVisible());
    await page.click("#clrNo");
    assert.equal(await shopRow("Jam").count(), 1);
    await page.click("#clearAll");
    await page.click("#clrYes");
    await until(async () => assert.equal(await page.locator("#shopList .srow").count(), 0));
  });

  await step("shopping: ideas with star ratings, low ones sink", async () => {
    await page.click('#qtabs [data-q="main"]');
    await page.click("#ideaBtn");
    await until(async () => assert.ok(await page.locator("#ideaBox .irow").count() >= 2));
    await page.locator('#ideaBox .irow:has-text("Sausages") .stars button').first().click();
    await until(async () => {
      const last = page.locator("#ideaBox .irow").last();
      assert.match(await last.innerText(), /Sausages/);
      assert.match(await last.getAttribute("class"), /\blow\b/);
    });
  });

  await step("shopping: misc used -> auto-added with a reason", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click('[data-kind="misc"]');
    await page.fill("#name", "Ketchup");
    await page.fill("#days", "5");
    await page.click("#addBtn");
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    await until(async () => assert.match(await text("#misc"), /Ketchup/));
    await page.locator("#misc").getByText("Ketchup").click();
    await page.click("#actUsed");
    await openShop();
    await until(async () => assert.match(await shopRow("Ketchup").innerText(), /auto · used up/i));
  });

  await step("shopping: fridge Shop button opens the list, and it is saved", async () => {
    await page.reload();
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="shop"]');
    await until(async () => assert.equal(await shopRow("Ketchup").count(), 1));
    assert.ok(await page.locator("#shopList").isVisible());
  });

  await step("theme toggle", async () => {
    const before = await page.getAttribute("html", "data-theme");
    assert.equal(await text("#theme"), before === "light" ? "🌙" : "☀️");
    await page.click("#theme");
    const after = await page.getAttribute("html", "data-theme");
    assert.notEqual(after, before);
    assert.equal(await text("#theme"), after === "light" ? "🌙" : "☀️");
  });

  await step("look: light mode is mid sage, not pale", async () => {
    assert.equal(await page.getAttribute("html", "data-theme"), "light");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, "rgb(169, 201, 178)");
  });

  await step("no date: works for misc and is remembered per food", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click('[data-kind="misc"]');
    assert.ok(await page.locator("#noDate").isVisible(), "no date shown for misc");
    await page.fill("#name", "Margarine");
    await page.check("#noDate");
    await page.click("#addBtn");
    await until(async () => assert.match(await text("#addMsg"), /added/i));
    // next time: typing margarine ticks No date by itself
    await page.click('[data-kind="misc"]');
    assert.equal(await page.isChecked("#noDate"), false);
    await page.fill("#name", "margarine");
    await until(async () => assert.equal(await page.isChecked("#noDate"), true));
    // eggs still need a date
    await page.fill("#name", "Eggs");
    await until(async () => assert.equal(await page.isChecked("#noDate"), false));
    await page.click("#addBtn");
    assert.match(await text("#addMsg"), /date/i);
    await page.fill("#name", "");
  });

  await step("quick fill: drop a .json file onto the app", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="quick"]');
    const json = '[{"name":"Leeks","kind":"veg","date":null},{"name":"Margarine","kind":"misc","date":null}]';
    const dt = await page.evaluateHandle(j => {
      const d = new DataTransfer();
      d.items.add(new File([j], "fridge.json", { type: "application/json" }));
      return d;
    }, json);
    await page.dispatchEvent("body", "dragover", { dataTransfer: dt });
    await page.dispatchEvent("body", "drop", { dataTransfer: dt });
    await until(async () => assert.equal(await page.locator("#qfList .qf-row").count(), 2));
    assert.match(await page.inputValue("#qfText"), /Leeks/);
    // Margarine is remembered as no-date, so both rows are ok
    assert.equal(await page.locator("#qfList .qf-row input[type=checkbox]:checked").count(), 2);
  });

  await step("photo JSON: known foods fill in, new food asks for its kind", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="quick"]');
    await page.fill("#qfText", JSON.stringify([
      { name: "Chicken", sub: "Asda chicken breasts", date: "2026-10-12", price: 3.5 },
      { name: "Halloumi", date: "2026-10-20" },
      { name: "Potatoes", date: "2026-11-30" },
    ]));
    await page.click("#qfCheck");
    assert.equal(await page.locator("#qfList .qf-row").count(), 3);
    const hal = page.locator('#qfList .qf-row:has-text("Halloumi")');
    assert.equal(await hal.locator("input[type=checkbox]").isChecked(), false);
    assert.equal(await hal.locator(".qf-kind [data-kind]").count(), 4);
    await hal.locator('.qf-kind [data-kind="misc"]').click();
    await until(async () => assert.equal(
      await page.locator('#qfList .qf-row:has-text("Halloumi") input[type=checkbox]').isChecked(), true));
    await page.click("#qfAdd");
    await until(async () => assert.match(await text("#qfMsg"), /added 3/i));
    const saved = await page.evaluate(() => fetch("/api/packs").then(r => r.json()));
    const chicken = saved.find(p => p.sub === "Asda chicken breasts");
    assert.ok(chicken, "sub name saved");
    assert.equal(chicken.price, 3.5);
    assert.equal(chicken.kind, "main");
    assert.equal(saved.find(p => p.name === "Halloumi").kind, "misc");
    const pot = saved.find(p => p.name === "Potatoes");
    assert.equal(pot.kind, "veg");
    assert.equal(pot.date, null);
    // next time Halloumi is known
    await page.fill("#qfText", '[{"name":"halloumi","date":"2026-10-22"}]');
    await page.click("#qfCheck");
    assert.equal(await page.locator("#qfList .qf-row input[type=checkbox]").isChecked(), true);
    assert.equal(await page.locator("#qfList .qf-kind").count(), 0);
  });

  await step("use soon strip: 2 days or less, tap opens the menu", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click('[data-kind="main"]');
    await page.fill("#name", "Kippers");
    await page.fill("#days", "1");
    await page.click("#addBtn");
    await page.fill("#name", "Brisket");
    await page.fill("#days", "6");
    await page.click("#addBtn");
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    await until(async () => assert.match(await text("#useSoon"), /Kippers/));
    assert.doesNotMatch(await text("#useSoon"), /Brisket/);
    await page.locator('#useSoon :text("Kippers")').first().click();
    assert.equal(await page.locator("#actUsed").isVisible(), true);
    await page.click("#actCancel");
  });

  const goToday = async iso => {
    await page.goto(URL.replace("today=2026-10-07", "today=" + iso));
    await page.click('[data-tab="meals"]');
  };
  const pastDay = () => page.locator("#dayList .day.past");

  await step("meals v2: past day asks 'Had this meal?' -> yes, all/part used", async () => {
    await goToday("2026-10-10"); // Sat: Thu 8 had Pork + Coleslaw + Peas planned
    assert.equal(await pastDay().count(), 1);
    assert.match(await pastDay().locator(".dh").innerText(), /Thu/);
    assert.match(await pastDay().innerText(), /Had this meal\?/);
    // past day sits above today
    assert.match(await page.locator("#dayList .day").nth(1).getAttribute("class"), /\btoday\b/);
    await pastDay().locator(".had-yes").click();
    assert.equal(await pastDay().locator(".use-row").count(), 3);
    // default is all used; switch Peas to part used
    assert.match(await pastDay().locator('.use-row:has-text("Pork") .all').getAttribute("class"), /\bon\b/);
    await pastDay().locator('.use-row:has-text("Peas") .part').click();
    await pastDay().locator(".had-done").click();
    await until(async () => assert.equal(await pastDay().count(), 0));
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    await until(async () => assert.doesNotMatch(await text("#fridgeView"), /Pork/));
    assert.match(await text("#veg"), /Peas/);
    assert.match(await text("#veg"), /part used/i);
    await openShop();
    await until(async () => assert.match(await shopRow("Pork").innerText(), /used up/i));
  });

  await step("meals v2: takeaway day -> yes -> how much was it?", async () => {
    await goToday("2026-10-11"); // Sun: Sat 10 was a takeaway
    assert.equal(await pastDay().count(), 1);
    assert.match(await pastDay().innerText(), /Takeaway/);
    await pastDay().locator(".had-yes").click();
    assert.match(await pastDay().innerText(), /How much was it\?/);
    await pastDay().locator(".cost-in").fill("24.50");
    await pastDay().locator(".cost-save").click();
    await until(async () => assert.equal(await pastDay().count(), 0));
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="used"]');
    await until(async () => assert.match(await text("#takeawaySum"), /1 · £24\.50/));
  });

  await step("meals v2: no -> what did you have? -> pick, then done", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="quick"]');
    await page.fill("#qfText", JSON.stringify([
      { name: "Lamb", kind: "main", date: "2026-10-25" }, { name: "Beef", kind: "main", date: "2026-10-25" }]));
    await page.click("#qfCheck");
    await page.click("#qfAdd");
    await until(async () => assert.match(await text("#qfMsg"), /added 2/i));
    await page.click('[data-tab="meals"]');
    // plan Lamb for today (Sun 11), which is open
    await page.click('#dayList .day.open #pickList .item:has-text("Lamb")');
    await until(async () => assert.match(await page.locator("#dayList .day.today .dh").innerText(), /Lamb/));
    await goToday("2026-10-12");
    assert.equal(await pastDay().count(), 1);
    await pastDay().locator(".had-no").click();
    assert.match(await pastDay().innerText(), /What did you have\?/);
    // Lamb is back in the picker; pick Beef instead
    assert.equal(await pastDay().locator('#pickList .item:has-text("Lamb")').count(), 1);
    await pastDay().locator('#pickList .item:has-text("Beef")').click();
    await pastDay().locator(".had-skip").click();
    await until(async () => assert.equal(await pastDay().count(), 0));
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    await until(async () => assert.doesNotMatch(await text("#mains"), /Beef/));
    assert.match(await text("#mains"), /Lamb/);
  });

  await step("fridge popup: part used keeps it with a 3-day timer", async () => {
    await page.locator('#mains .card:has-text("Lamb") .pack').first().click();
    await page.click("#actPart");
    await until(async () => assert.match(await page.locator('#mains .card:has-text("Lamb")').innerText(), /3 days left/));
    assert.match(await page.locator('#mains .card:has-text("Lamb")').innerText(), /part used/i);
  });

  await step("meal ideas: top combos under the days, + plans it, grey + shops for it", async () => {
    const post = rec => fetch(`http://localhost:${PORT}/api/meals`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) });
    const lambPeas = { items: [{ name: "Lamb", slot: "main" }, { name: "Peas", slot: "veg" }], takeaway: false, cost: null };
    await post({ day: "2026-10-01", ...lambPeas });
    await post({ day: "2026-10-02", ...lambPeas });
    await goToday("2026-10-12");
    const ideas = page.locator("#mealIdeas .idea");
    await until(async () => assert.ok(await ideas.count() >= 2));
    // sits under the day list
    const days = await page.locator("#dayList").boundingBox();
    const box = await page.locator("#mealIdeas").boundingBox();
    assert.ok(box.y >= days.y + days.height - 1, "ideas under the days");
    // the list scrolls instead of growing
    assert.equal(await page.locator("#mealIdeas .il").evaluate(e => getComputedStyle(e).overflowY), "auto");
    // takeaways are not ideas
    assert.doesNotMatch(await text("#mealIdeas"), /Takeaway/);
    const lamb = page.locator('#mealIdeas .idea:has-text("Lamb + Peas")');
    assert.match(await ideas.first().innerText(), /Lamb \+ Peas/);
    assert.match(await lamb.innerText(), /had 2×/);
    await lamb.locator(".plus").click();
    const todayHead = page.locator("#dayList .day.today .dh");
    await until(async () => {
      const t = await todayHead.innerText();
      assert.match(t, /Lamb/); assert.match(t, /Peas/);
    });
    // Pork + Coleslaw + Peas: Pork and Coleslaw were used up -> grey +, adds them to the list
    const pork = page.locator('#mealIdeas .idea:has-text("Pork + Coleslaw + Peas")');
    assert.match(await pork.innerText(), /need Pork, Coleslaw/);
    assert.match(await pork.locator(".plus").getAttribute("class"), /\boff\b/);
    await pork.locator(".plus").click();
    await openShop();
    await until(async () => assert.equal(await shopRow("Coleslaw").count(), 1));
    assert.equal(await shopRow("Pork").count(), 1);
  });

  await step("print button fills the A4 sheet and opens print", async () => {
    await page.goto(URL);
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await page.click("#printF");
    assert.equal(await page.evaluate(() => window.__printed), 1);
    const sheet = page.locator("#printSheet");
    assert.match(await sheet.locator(".ps-head").innerText(), /7–13 Oct/);
    assert.match(await sheet.locator(".ps-code").innerText(), /SHEET 0710-\d{4}/);
    // numbered rows with U / ½ / B boxes
    const first = sheet.locator(".ps-top tr").first();
    assert.match(await first.innerText(), /^01/);
    assert.equal(await first.locator(".bx").count(), 3);
    // fixed bottom boxes
    assert.equal(await sheet.locator(".ps-added tr").count(), 4);
    assert.equal(await sheet.locator(".ps-need tr").count(), 3);
    assert.equal(await sheet.locator(".ps-meals tr").count(), 7);
    assert.match(await sheet.locator(".ps-meals tr").first().innerText(), /Wed 7 Oct/);
    // corner marks and black bars must print even with "Background graphics" off:
    // marks are drawn with borders, and the sheet asks for exact colours
    const mk = await sheet.locator(".ps-mk").first().evaluate(e => {
      const c = getComputedStyle(e);
      return { border: parseFloat(c.borderTopWidth), bg: c.backgroundColor };
    });
    assert.ok(mk.border >= 10, "corner mark drawn with a thick border: " + mk.border);
    const adjust = await sheet.evaluate(e => getComputedStyle(e).printColorAdjust || getComputedStyle(e).webkitPrintColorAdjust);
    assert.equal(adjust, "exact");
    // on screen the sheet stays hidden; only the print view shows it
    assert.equal(await sheet.isVisible(), false);
    await page.emulateMedia({ media: "print" });
    assert.equal(await sheet.isVisible(), true);
    assert.equal(await page.locator(".phone").isVisible(), false);
    await page.emulateMedia({ media: "screen" });
  });

  await step("🔄 button checks for updates, then reloads the page", async () => {
    await page.goto(URL);
    await page.evaluate(() => { window.__notReloaded = true; });
    const asked = page.waitForRequest(r => r.url().endsWith("/api/update") && r.method() === "POST");
    await page.click("#refresh");
    await asked;
    await page.waitForFunction(() => !window.__notReloaded);
    assert.match(await text("#today"), /Wed 7 Oct/);
  });

  await step("after an update the app says so once", async () => {
    await page.evaluate(() => sessionStorage.setItem("ftUpdated", "1"));
    await page.reload();
    await until(async () => assert.match(await text("#updNote"), /Updated/));
    await page.reload();
    assert.equal(await page.locator("#updNote").isVisible(), false);
  });

  await step("add: typing a saved food jumps to its tab; usuals filter", async () => {
    await page.goto(URL);
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click('[data-kind="main"]');
    assert.ok((await page.locator("#usuals .usual").count()) <= 10, "10 usuals at most");
    // Carrots is a veg starter: typing it moves to the Veg tab, name kept
    await page.fill("#name", "carrots");
    await until(async () => assert.match(await page.locator('.mtabs [data-kind].on').innerText(), /Veg/));
    assert.equal(await page.inputValue("#name"), "carrots");
    // can still change it
    await page.click('[data-kind="side"]');
    assert.match(await page.locator('.mtabs [data-kind].on').innerText(), /Side/);
    assert.equal(await page.inputValue("#name"), "carrots");
    // typing filters the buttons across all foods
    await page.fill("#name", "sau");
    const hits = await page.locator("#usuals .usual").allInnerTexts();
    assert.ok(hits.length >= 1 && hits.every(h => /sau/i.test(h)), "only matches: " + hits);
    await page.fill("#name", "");
    assert.ok((await page.locator("#usuals .usual").count()) > 1);
  });

  await step("print sheet uses P for part used", async () => {
    await page.evaluate(() => { window.print = () => {}; });
    await page.click("#printF");
    assert.match(await text("#printSheet .ps-key"), /P = Part used/);
    assert.doesNotMatch(await page.locator("#printSheet").innerHTML(), /½/);
  });

  await step("📷 read a sheet: print saves it, a photo gives Changes found, Apply all updates the fridge", async () => {
    await page.goto(URL);
    await page.evaluate(() => { window.print = () => {}; });
    await page.click("#printF");
    // the printed sheet is saved with its numbered rows and box positions
    const sheets = await page.evaluate(async () => (await fetch("/api/sheets")).json());
    assert.ok(sheets.length >= 1);
    const sheet = sheets[sheets.length - 1];
    assert.match(sheet.code, /^0710-\d{4}$/);
    assert.ok(sheet.rows.length >= 2);
    assert.equal(sheet.rows[0].no, "01");
    assert.equal(sheet.rows[0].boxes.length, 3);
    for (const b of sheet.rows[0].boxes) assert.ok(b.every(n => n >= 0 && n <= 1), "boxes are 0..1: " + b);

    await page.click("#scanBtn");
    assert.ok(await page.locator("#scanPanel").isVisible());
    assert.match(await text("#scanSheet"), new RegExp(sheet.code));
    // pretend the photo shows row 01 used and row 02 binned
    const [r1, r2] = sheet.rows;
    await page.evaluate(([a, b]) => {
      window.FT_OMR.readSheet = () => ({ ok: true, marks: { [a]: { u: true, p: false, b: false }, [b]: { u: false, p: false, b: true } } });
    }, [r1.no, r2.no]);
    await page.setInputFiles("#scanFile", path.join(__dirname, "..", "docs", "mockup-scan.png"));
    await until(async () => assert.match(await text("#scanChanges"), /Changes found · 2/));
    const row1 = page.locator(`#scanChanges .chg[data-no="${r1.no}"]`);
    assert.match(await row1.innerText(), new RegExp(r1.name));
    assert.match(await row1.locator(".u").getAttribute("class"), /\bon\b/);
    // fix row 02 to Part used
    await page.locator(`#scanChanges .chg[data-no="${r2.no}"] .p`).click();
    await page.click("#scanApply");
    await until(async () => {
      const packs = await page.evaluate(async () => (await fetch("/api/packs")).json());
      assert.equal(packs.find(p => p.id === r1.id).status, "used");
      const p2 = packs.find(p => p.id === r2.id);
      assert.equal(p2.status, "in_fridge");
      assert.equal(p2.partUsed, true);
    });
    assert.equal(await page.locator("#scanPanel").isVisible(), false);
  });

  await step("print warns when the sheet can't be saved (old server)", async () => {
    await page.route("**/api/sheets", r => r.request().method() === "POST" ? r.fulfill({ status: 404, body: "{}" }) : r.continue());
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    let msg = "";
    page.once("dialog", d => { msg = d.message(); d.dismiss(); });
    await page.click("#printF");
    await until(async () => assert.match(msg, /couldn't be saved/i));
    assert.equal(await page.evaluate(() => window.__printed), 0, "cancel = no print");
    page.once("dialog", d => d.accept());
    await page.click("#printF");
    await until(async () => assert.equal(await page.evaluate(() => window.__printed), 1, "OK = print anyway"));
    await page.unroute("**/api/sheets");
  });

  await step("📷 no sheet found in the photo says so", async () => {
    await page.click("#scanBtn");
    await page.evaluate(() => { window.FT_OMR.readSheet = () => ({ ok: false, reason: "corners" }); });
    await page.setInputFiles("#scanFile", path.join(__dirname, "..", "docs", "mockup-scan.png"));
    await until(async () => assert.match(await text("#scanMsg"), /4 black corners/));
    assert.match(await page.locator("#scanMsg").getAttribute("class"), /\berr\b/);
    await page.click("#scanCancel");
  });

  await step("📷 add food from photos opens quick fill", async () => {
    await page.click("#scanBtn");
    await page.click("#scanFood");
    assert.equal(await page.locator("#scanPanel").isVisible(), false);
    assert.ok(await page.locator("#qfCheck").isVisible(), "quick fill shown");
  });

  await step("real copy shows no TEST banner", async () => {
    assert.equal(await page.locator("#testBanner").isVisible(), false);
  });

  await step("data is in the SQLite file outside the app folder", async () => {
    const dbFile = path.join(DATA_DIR, "food.db");
    assert.ok(fs.existsSync(dbFile), "food.db created in data folder");
    assert.ok(!fs.existsSync(path.join(__dirname, "..", "food.db")), "no db inside the app folder");
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.kill();
  console.log("ALL SCREEN CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
