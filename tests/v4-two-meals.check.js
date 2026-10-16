// V4 demo: dinner (midday, optional) + tea (evening) on the Meals page (#144, mock #145).
// Run with: node tests/v4-two-meals.check.js   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5211;
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
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); }
    }
  };
  const todayCard = () => page.locator("#dayList .day.today");
  const sit = (card, meal) => card.locator(`.sit[data-meal="${meal}"]`);
  const past = meal => page.locator(`#dayList .day.past[data-meal="${meal}"]`);
  const pick = name => page.locator("#pickList .item", { hasText: name }).first().click();
  const openAsk = async card => {
    if (await card.locator(".had-yes").isVisible()) return;
    await card.locator(".dh").click();
    await until(async () => assert.ok(await card.locator(".had-yes").isVisible()));
  };

  await page.goto(url("2026-10-20", 10));

  await step("fridge has chicken and sausage rolls", async () => {
    for (const name of ["Chicken", "Sausage rolls"]) {
      await page.click('[data-tab="add"]');
      await page.click('[data-sub="fridge"]');
      await page.click('[data-kind="main"]');
      await page.fill("#name", name);
      await page.fill("#days", "4");
      await page.click("#addBtn");
      await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
    }
  });

  await step("open day with tea only: '+ Dinner' on offer, no dinner/tea rows yet (looks as now)", async () => {
    await page.click('[data-tab="meals"]');
    await until(async () => assert.ok(await todayCard().locator(".add-dinner").isVisible()));
    assert.equal(await todayCard().locator(".sit").count(), 0);
    assert.doesNotMatch(await page.locator("#pickFor").innerText(), /Dinner|Tea/);
  });

  await step("'+ Dinner': dinner and tea rows appear, picker adds to dinner", async () => {
    await todayCard().locator(".add-dinner").click();
    await until(async () => assert.equal(await sit(todayCard(), "dinner").count(), 1));
    assert.equal(await sit(todayCard(), "tea").count(), 1);
    assert.match(await sit(todayCard(), "dinner").getAttribute("class"), /\bsel\b/);
    assert.match(await page.locator("#pickFor").innerText(), /Dinner/);
    await pick("Sausage rolls");
    await until(async () => assert.match(await sit(todayCard(), "dinner").innerText(), /Sausage rolls/));
    assert.doesNotMatch(await sit(todayCard(), "tea").innerText(), /Sausage rolls/);
    assert.equal(await todayCard().locator(".add-dinner").count(), 0, "no + Dinner once there is a dinner");
  });

  await step("tap TEA: picker adds to tea", async () => {
    await sit(todayCard(), "tea").locator(".sit-lbl").click();
    await until(async () => assert.match(await sit(todayCard(), "tea").getAttribute("class"), /\bsel\b/));
    assert.match(await page.locator("#pickFor").innerText(), /Tea/);
    await pick("Chicken");
    await until(async () => assert.match(await sit(todayCard(), "tea").innerText(), /Chicken/));
    assert.doesNotMatch(await sit(todayCard(), "dinner").innerText(), /Chicken/);
  });

  await step("closed day still shows DINNER and TEA with their foods", async () => {
    await todayCard().locator(".dh").click();
    await until(async () => assert.equal(await page.locator("#mtabs").isVisible(), false));
    const t = await todayCard().innerText();
    assert.match(t, /DINNER|Dinner/);
    assert.match(t, /TEA|Tea/);
    assert.match(t, /Sausage rolls/);
    assert.match(t, /Chicken/);
  });

  await step("2pm: dinner asked on its own card; tea still planned on today's card", async () => {
    await page.goto(url("2026-10-20", 15));
    await page.click('[data-tab="meals"]');
    await until(async () => assert.equal(await past("dinner").count(), 1));
    assert.equal(await past("tea").count(), 0);
    const d = await past("dinner").innerText();
    assert.match(d, /Dinner/);
    assert.match(d, /Sausage rolls/);
    assert.doesNotMatch(d, /Chicken/);
    assert.match(await todayCard().innerText(), /Chicken/);
    assert.doesNotMatch(await todayCard().innerText(), /Sausage rolls/);
  });

  await step("dinner: Yes -> how much did you use? -> Done; tea untouched", async () => {
    await openAsk(past("dinner"));
    await past("dinner").locator(".had-yes").click();
    await until(async () => assert.match(await past("dinner").innerText(), /How much did you use\?/));
    await past("dinner").locator(".had-done").click();
    await until(async () => assert.equal(await past("dinner").count(), 0));
    assert.match(await todayCard().innerText(), /Chicken/);
  });

  await step("5pm: tea asked; nothing else on today", async () => {
    await page.goto(url("2026-10-20", 18));
    await page.click('[data-tab="meals"]');
    await until(async () => assert.equal(await past("tea").count(), 1));
    assert.equal(await past("dinner").count(), 0);
    assert.match(await past("tea").innerText(), /Chicken/);
    assert.equal(await todayCard().count(), 0);
  });

  await step("tea: Yes -> Done; nothing left to ask", async () => {
    await openAsk(past("tea"));
    await past("tea").locator(".had-yes").click();
    await until(async () => assert.match(await past("tea").innerText(), /How much did you use\?/));
    await past("tea").locator(".had-done").click();
    await until(async () => assert.equal(await page.locator("#dayList .day.past").count(), 0));
  });

  await step("a takeaway for dinner: planned for dinner, asked at 2pm, cost saved", async () => {
    await page.goto(url("2026-10-21", 10));
    await page.click('[data-tab="meals"]');
    await until(async () => assert.ok(await todayCard().locator(".add-dinner").isVisible()));
    await todayCard().locator(".add-dinner").click();
    await until(async () => assert.equal(await sit(todayCard(), "dinner").count(), 1));
    await page.locator("#pickList .item.ta").click();
    await until(async () => assert.match(await sit(todayCard(), "dinner").innerText(), /Takeaway/));
    assert.doesNotMatch(await sit(todayCard(), "tea").innerText(), /Takeaway/);

    await page.goto(url("2026-10-21", 15));
    await page.click('[data-tab="meals"]');
    await until(async () => assert.equal(await past("dinner").count(), 1));
    await openAsk(past("dinner"));
    await past("dinner").locator(".had-yes").click();
    await until(async () => assert.match(await past("dinner").innerText(), /How much was it\?/));
    await past("dinner").locator(".cost-in").fill("12");
    await past("dinner").locator(".cost-save").click();
    await until(async () => assert.equal(await past("dinner").count(), 0));
  });

  await step("320px: the day card fits", async () => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(url("2026-10-22", 10));
    await page.click('[data-tab="meals"]');
    await until(async () => assert.ok(await todayCard().locator(".add-dinner").isVisible()));
    await todayCard().locator(".add-dinner").click();
    await until(async () => assert.equal(await sit(todayCard(), "dinner").count(), 1));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `no sideways scroll (${over}px)`);
  });

  await step("no page errors", async () => {
    assert.deepEqual(errors, []);
  });

  console.log("ALL V4 TWO MEALS CHECKS PASSED");
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
