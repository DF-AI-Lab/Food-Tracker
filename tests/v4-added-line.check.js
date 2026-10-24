// Fridge rows show "added today" / "added Mon 19 Oct · 5 days ago" under the line (Darren 2026-10-24).
// Run with: node tests/v4-added-line.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
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

  await step("Fridge: dated rows (Bacon, Ham) show 'added today' under the line", async () => {
    await page.click('[data-tab="fridge"]');
    const ham = page.locator(".row", { hasText: "Ham" }).first();
    await until(async () => assert.equal((await ham.locator(".added-line").innerText()).trim(), "added today"));
    const bacon = page.locator(".row", { hasText: "Bacon" }).first();
    assert.equal((await bacon.locator(".added-line").innerText()).trim(), "added today");
    const order = await ham.evaluate(el => [...el.children].map(c => c.className));
    assert.ok(order.indexOf("added-line") > order.indexOf("line"), "added line sits under the bar: " + order);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("all ok");
})().catch(e => { console.error(e); process.exit(1); });
