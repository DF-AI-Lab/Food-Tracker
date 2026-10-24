// Combos v2: + Add, pick a food, tick what goes with it, Save N pairs (Darren 2026-10-24).
// Run with: node tests/v4-combos-pick.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5217;
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
  const tab = key => page.locator(`#addedWrap [data-added="${key}"]`);
  const count = async key => (await tab(key).locator("b").innerText()).trim();
  const rows = () => page.locator("#addedToday .added-row");

  const pick = page.locator("#comboPick");
  const chip = name => pick.locator(".cp-chip", { hasText: new RegExp("^" + name + "$") });
  const kindTab = k => pick.locator(`[data-cpkind="${k}"]`);

  await page.goto(url("2026-10-24", 10));
  await page.click('[data-tab="meals"]');

  await step("old typing boxes are gone; + Add opens the picker on Main", async () => {
    await until(async () => assert.ok(await page.locator("#combos").isVisible()));
    assert.equal(await page.locator("#comboA").count(), 0);
    assert.ok(await pick.isHidden());
    await page.click("#comboAdd");
    await until(async () => assert.ok(await pick.isVisible()));
    assert.match(await pick.locator(".cp-title").innerText(), /Pick a food/);
    assert.equal(await pick.locator("[data-cpkind]").count(), 4);
    assert.ok(await kindTab("main").evaluate(el => el.classList.contains("on")));
  });

  await step("pick Sausages: 'Sausages goes with', Side tab on", async () => {
    await chip("Sausages").click();
    await until(async () => assert.match(await pick.locator(".cp-title").innerText(), /Sausages goes with/));
    assert.ok(await kindTab("side").evaluate(el => el.classList.contains("on")));
    assert.ok(await page.locator("#cpSave").isDisabled());
  });

  await step("tick Mash, Chips (Side), Peas (Veg), Gravy granules (Other): Save 4 pairs", async () => {
    await chip("Mash").click();
    await chip("Chips").click();
    assert.ok(await chip("Chips").evaluate(el => el.classList.contains("on")));
    await kindTab("veg").click();
    await chip("Peas").click();
    await kindTab("misc").click();
    await chip("Gravy granules").click();
    await kindTab("side").click();
    assert.ok(await chip("Mash").evaluate(el => el.classList.contains("on")), "ticks kept across tabs");
    assert.match(await page.locator("#cpSave").innerText(), /Save 4 pairs/);
    await page.click("#cpSave");
    await until(async () => assert.ok(await pick.isHidden()));
  });

  await step("list: one Sausages group with 4 foods", async () => {
    const g = page.locator("#combos .combo-list .combo-group", { hasText: "Sausages" });
    await until(async () => assert.equal(await g.count(), 1));
    assert.equal(await g.locator(".combo-chip").count(), 4);
    assert.match(await g.innerText(), /Chips[\s\S]*Gravy granules[\s\S]*Mash[\s\S]*Peas/);
  });

  await step("+ Add Sausages again: Mash already ticked and locked; Cancel closes", async () => {
    await page.click("#comboAdd");
    await chip("Sausages").click();
    await until(async () => assert.ok(await chip("Mash").isDisabled()));
    assert.ok(await chip("Mash").evaluate(el => el.classList.contains("on")));
    await page.click("#cpCancel");
    await until(async () => assert.ok(await pick.isHidden()));
  });

  await step("x on Peas hides that pair: it moves to Hidden", async () => {
    const g = page.locator("#combos .combo-list .combo-group", { hasText: "Sausages" });
    await g.locator(".combo-chip", { hasText: "Peas" }).locator(".combo-x").click();
    await until(async () => assert.equal(await g.locator(".combo-chip").count(), 3));
    await until(async () => assert.equal(await page.locator("#combosHidden .combo-row", { hasText: "Peas" }).count(), 1));
  });

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("all ok");
})().catch(e => { console.error(e); process.exit(1); });
