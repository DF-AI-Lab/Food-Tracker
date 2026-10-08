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
    assert.equal(await page.locator("#dayList .day").count(), 7);
    await page.click('#dayList .day:has-text("Thu")');
    assert.match(await text("#pickFor"), /Thu/);
    await page.click('#pickList .item:has-text("Pork")');
    await until(async () => assert.match(await page.locator('#dayList .day:has-text("Thu")').innerText(), /Pork/));
    assert.match(await page.locator("#mtabs .on").innerText(), /Sides/);
    await page.click('#pickList .item:has-text("Coleslaw")');
    await until(async () => assert.match(await page.locator("#mtabs .on").innerText(), /Veg/));
    await page.click('#pickList .item:has-text("Peas")');
    await until(async () => assert.match(await text("#weekSum"), /Pork \+ Coleslaw \+ Peas/));
    assert.equal(await page.locator("#printWeek").count(), 1);
  });

  await step("meals: out-of-date warning, add anyway, then remove", async () => {
    await page.click("#nextDay");
    assert.match(await text("#pickFor"), /Fri/);
    assert.match(await page.locator("#mtabs .on").innerText(), /Mains/);
    await page.click('#pickList .item:has-text("Salmon")');
    await until(async () => assert.match(await text("#warnBar"), /Salmon will be 3 days out by Fri/));
    await page.click("#wYes");
    const fri = page.locator('#dayList .day:has-text("Fri")');
    await until(async () => assert.equal(await fri.locator(".chip2.warn:has-text('Salmon')").count(), 1));
    await fri.locator(".chip2:has-text('Salmon') .x").click();
    await until(async () => assert.doesNotMatch(await fri.innerText(), /Salmon/));
  });

  await step("meals: takeaway fills the day and moves on", async () => {
    await page.click('#dayList .day:has-text("Sat")');
    await page.click("#pickList .item.ta");
    await until(async () => assert.match(await page.locator('#dayList .day:has-text("Sat")').innerText(), /Takeaway/));
    assert.match(await text("#pickFor"), /Sun/);
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
    await page.click("#theme");
    assert.notEqual(await page.getAttribute("html", "data-theme"), before);
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

  await step("select several packs and freeze them together", async () => {
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    await page.click("#selectBtn");
    await page.locator('#mains .card:has-text("Chicken") .pack').first().click();
    await page.locator('#mains .card:has-text("Sausages") .pack').first().click();
    assert.equal(await page.locator(".pack.sel").count(), 2);
    assert.match(await text("#freezeSel"), /Freeze \(2\)/);
    // tapping a pack in select mode doesn't open the action sheet
    assert.equal(await page.locator("#actUsed").isVisible(), false);
    await page.click("#freezeSel");
    await page.click('[data-view="freezer"]');
    await until(async () => {
      const t = await text("#freezerList");
      assert.match(t, /Chicken/);
      assert.match(t, /Sausages/);
    });
    // select mode is off again
    await page.click('[data-view="fridge"]');
    assert.equal(await page.locator(".pack.sel").count(), 0);
    assert.equal(await page.locator("#freezeSel").isVisible(), false);
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
