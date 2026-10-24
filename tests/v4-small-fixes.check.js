// V4 demo: small fixes from Darren's feedback notes (16 Oct).
// Run with: node tests/v4-small-fixes.check.js   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5212;
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
  // A phone: touch screen, so the keyboard rules apply
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); }
    }
  };
  const navShown = () => page.locator("#bottomNav").isVisible();

  await page.goto(url("2026-10-16", 10));

  await step("no date found: the row is fine as it is (no Add date step), tap the date to set one", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="quick"]');
    await page.locator("#qfPasteWrap > summary").click();
    await page.fill("#qfText", JSON.stringify([{ name: "Chicken", kind: "main" }]));
    await page.click("#qfCheck");
    await until(async () => assert.match(await page.locator("#qfList").innerText(), /Chicken/));
    assert.doesNotMatch(await page.locator("#qfList").innerText(), /No date found/);
    assert.equal(await page.locator("#qfList .qc", { hasText: "Add date" }).count(), 0);
    assert.equal(await page.locator("#qfList .qf-row input[type=checkbox]").first().isChecked(), true);
  });

  await step("keyboard up (typing in a text box): bottom icons hide; done typing: they come back", async () => {
    await page.click('[data-sub="fridge"]');
    assert.equal(await navShown(), true);
    await page.locator("#name").tap();
    await until(async () => assert.equal(await navShown(), false));
    await page.locator("#name").blur();
    await until(async () => assert.equal(await navShown(), true));
  });

  // (The Add bar at the top while typing, and its ✕, are now covered by tests/add-steps.check.js:
  //  on a phone, adding a food is done in 3 steps.)

  await step("ticking a box does not hide the bottom icons", async () => {
    await page.click('[data-tab="shop"]');
    await page.click('[data-tab="fridge"]');
    assert.equal(await navShown(), true);
  });

  await step("search sits on the title line, between 'Fridge' and the item count", async () => {
    await page.click('[data-tab="fridge"]');
    await until(async () => assert.ok(await page.locator("#fridgeSearch").isVisible()));
    assert.equal(await page.locator(".titlerow #fridgeSearchWrap").count(), 1, "inside the title row");
    const [t, s, c] = [await page.locator("#pageTitle").boundingBox(), await page.locator("#fridgeSearchWrap").boundingBox(), await page.locator("#pageCount").boundingBox()];
    assert.ok(t.x + t.width <= s.x + 1 && s.x + s.width <= c.x + 1, "title | search | count, left to right");
    assert.ok(Math.abs((t.y + t.height / 2) - (s.y + s.height / 2)) < 30, "same line");
    assert.match(await page.locator("#fridgeSearch").getAttribute("placeholder"), /^Search$/);
    await page.locator("#fridgeSearch").fill("chick");
    await until(async () => assert.ok(await page.locator("#searchResults").isVisible()));
    await page.locator("#fridgeSearch").fill("");
    await page.setViewportSize({ width: 320, height: 700 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `no sideways scroll at 320px (${over}px)`);
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await step("header shows the date and version (no 'Synced'); no version line at the bottom", async () => {
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.click('[data-tab="fridge"]');
    const sub = await page.locator("#homeBtn .homesub").innerText();
    assert.match(sub, /v\d+\.\d+/);
    assert.doesNotMatch(sub, /Synced/);
    assert.equal(await page.locator(".homesub #ver").count(), 1, "version lives in the header");
  });

  await step("no page errors", async () => {
    assert.deepEqual(errors, []);
  });

  console.log("ALL V4 SMALL FIXES CHECKS PASSED");
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
