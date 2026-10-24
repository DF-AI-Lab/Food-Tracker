// Added today in 3 tabs: Added today / No date / 3+ days (Darren 2026-10-24).
// Run with: node tests/v4-added-tabs.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
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

  await page.goto(url("2026-10-24", 10));

  await step("paste a photo reply: Chicken (no date), Bacon (21 days), Ham (2 days), Carrots (veg, no date)", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="quick"]');
    await page.locator("#qfPasteWrap > summary").click();
    await page.fill("#qfText", JSON.stringify([
      { name: "Chicken", kind: "main" },
      { name: "Bacon", kind: "main", date: "2026-11-14" },
      { name: "Ham", kind: "misc", date: "2026-10-26" },
      { name: "Carrots", kind: "veg" },
    ]));
    await page.click("#qfCheck");
    await until(async () => assert.equal(await page.locator("#qfList .qf-row").count(), 4));
    assert.doesNotMatch(await page.locator("#qfList").innerText(), /No date found/);
    await page.click("#qfAdd");
    await until(async () => assert.ok(await page.locator("#addedWrap").isVisible()));
  });

  await step("3 tabs with counts: Added today 4, No date 1, Use in 3 days 1 (Ham); Added today is on", async () => {
    await until(async () => assert.equal(await count("all"), "4"));
    assert.equal(await count("nodate"), "1");
    assert.equal(await count("later"), "1");
    assert.match(await tab("all").innerText(), /Added today/);
    assert.match(await tab("nodate").innerText(), /No date/);
    assert.match(await tab("later").innerText(), /Use in 3 days/);
    assert.ok(await tab("all").evaluate(el => el.classList.contains("on")));
    assert.equal(await rows().count(), 4);
  });

  await step("No date tab: just Chicken, with +1..+7 and Pick date; +2 dates it and it leaves the tab", async () => {
    await tab("nodate").click();
    await until(async () => assert.equal(await rows().count(), 1));
    assert.match(await rows().first().innerText(), /Chicken/);
    const quick = page.locator("#addedToday .added-quick");
    assert.equal(await quick.count(), 1);
    assert.deepEqual((await quick.first().locator("button").allInnerTexts()).map(t => t.trim()), ["+1", "+2", "+3", "+5", "+7", "Pick date"]);
    await quick.first().locator("button", { hasText: "+2" }).click();
    await until(async () => assert.equal(await count("nodate"), "0"));
    assert.equal(await rows().count(), 0);
  });

  await step("Use in 3 days tab: Chicken (now 26 Oct) and Ham, with Edit; Edit Ham +5 moves it out", async () => {
    await tab("later").click();
    await until(async () => assert.equal(await rows().count(), 2));
    assert.equal(await count("later"), "2");
    const ham = page.locator("#addedToday .added-row", { hasText: "Ham" });
    assert.match(await ham.innerText(), /26 Oct/);
    assert.equal(await page.locator("#addedToday .added-quick").count(), 0);
    await ham.locator(".added-edit").click();
    await until(async () => assert.equal(await page.locator("#addedToday .added-quick").count(), 1));
    await page.locator("#addedToday .added-quick button", { hasText: "+5" }).click();
    await until(async () => assert.equal(await count("later"), "1"));
    assert.match(await rows().first().innerText(), /Chicken/);
  });

  await step("back on Added today: Chicken now has 26 Oct, Ham 29 Oct", async () => {
    await tab("all").click();
    await until(async () => assert.equal(await rows().count(), 4));
    assert.match(await page.locator("#addedToday").innerText(), /Chicken[\s\S]*26 Oct/);
    assert.match(await page.locator("#addedToday").innerText(), /Ham[\s\S]*29 Oct/);
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close();
  server.close();
  console.log("ALL ADDED TABS CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
