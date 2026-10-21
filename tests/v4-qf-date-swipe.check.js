// Quick fill: quick date buttons under a row, swipe a row away (Darren 2026-10-21, Android).
// Run with: node tests/v4-qf-date-swipe.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
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
  const ctx = await browser.newContext({ ...require("playwright").devices["Pixel 7"] });
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
  const rows = page.locator("#qfList .qf-row");
  // A finger swipe on a row (pointer events, like a phone)
  const swipe = (i, dx) => rows.nth(i).evaluate((el, dx) => {
    const r = el.getBoundingClientRect(), y = r.top + r.height / 2, x0 = r.left + r.width / 2;
    const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: y }));
    ev("pointerdown", x0);
    for (let k = 1; k <= 6; k++) ev("pointermove", x0 + (dx * k) / 6);
    ev("pointerup", x0 + dx);
  }, dx);

  await page.goto(url("2026-10-21", 10));
  await page.click('[data-tab="add"]');
  const paste = async json => {
    await page.evaluate(() => { document.getElementById("qfPasteWrap").open = true; });
    await page.fill("#qfText", json);
    await page.click("#qfCheck");
  };

  await step("tap 'no date': quick day buttons and Pick date show under the row", async () => {
    await paste('[{"name":"Ham","kind":"main","date":null,"dateMissing":true},{"name":"Cheese","kind":"misc","date":"2026-10-30"},{"name":"Soup","kind":"main","date":"2026-10-28"}]');
    await until(async () => assert.equal(await rows.count(), 3));
    await rows.nth(0).locator(".qf-date").tap({ force: true });
    const quick = page.locator("#qfList .qf-quickdate");
    await until(async () => assert.ok(await quick.isVisible()));
    assert.deepEqual((await quick.locator("button").allInnerTexts()).map(t => t.trim()), ["+1", "+2", "+3", "+5", "+7", "Pick date"]);
  });

  await step("tap +3: Ham gets Sat 24 Oct straight away, and the buttons close", async () => {
    await page.locator("#qfList .qf-quickdate button", { hasText: "+3" }).tap();
    await until(async () => assert.match(await rows.nth(0).innerText(), /Ham[\s\S]*Sat 24 Oct/));
    assert.equal(await page.locator("#qfList .qf-quickdate").count(), 0);
    assert.equal(await rows.nth(0).locator("input[type=checkbox]").isChecked(), true);
  });

  await step("Pick date: the date box saves even if only 'change' fires", async () => {
    await rows.nth(0).locator(".qf-date").tap({ force: true });
    await page.locator("#qfList .qf-quickdate button", { hasText: "Pick date" }).tap();
    const inp = page.locator("#qfList input.qf-datein");
    await until(async () => assert.equal(await inp.count(), 1));
    await inp.evaluate(el => { el.value = "2026-10-27"; el.dispatchEvent(new Event("change", { bubbles: true })); });
    await until(async () => assert.match(await rows.nth(0).innerText(), /Ham[\s\S]*Tue 27 Oct/));
  });

  await step("a short drag does nothing", async () => {
    await swipe(1, 30);
    await page.waitForTimeout(400);
    assert.equal(await rows.count(), 3);
  });

  await step("swipe Cheese left: it goes from the list", async () => {
    await swipe(1, -200);
    await until(async () => assert.equal(await rows.count(), 2));
    assert.doesNotMatch(await page.locator("#qfList").innerText(), /Cheese/);
  });

  await step("swipe Soup right: it goes too", async () => {
    await swipe(1, 200);
    await until(async () => assert.equal(await rows.count(), 1));
    assert.doesNotMatch(await page.locator("#qfList").innerText(), /Soup/);
  });

  await step("Add ticked adds only Ham, with its date", async () => {
    await page.click("#qfAdd");
    await page.click('[data-tab="fridge"]');
    const txt = await until(async () => {
      const t = await page.locator("#fridgeView").innerText();
      assert.match(t, /Ham/);
      return t;
    });
    assert.match(txt, /Tue 27 Oct/);
    assert.doesNotMatch(txt, /Cheese|Soup/);
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  console.log("ALL QF DATE / SWIPE CHECKS PASSED");
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
