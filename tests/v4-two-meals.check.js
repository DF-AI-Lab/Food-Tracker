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
  // Asking: one card per day; each waiting meal is its own block inside it
  const pastCards = () => page.locator("#dayList .day.past");
  const past = meal => page.locator(`#dayList .day.past .ask-meal[data-meal="${meal}"]`);
  const pick = name => page.locator("#pickList .item", { hasText: name }).first().click();
  // Change the clock hour without a reload (test mode keeps its data in memory only),
  // then redraw the Meals page by switching tabs
  const setHour = async (today, hour) => {
    await page.evaluate(u => history.replaceState(null, "", u), url(today, hour));
    await page.click('[data-tab="fridge"]');
    await page.click('[data-tab="meals"]');
  };
  const openAsk = async block => {
    if (await block.locator(".had-yes").isVisible()) return;
    await block.locator(".ask-line").click();
    await until(async () => assert.ok(await block.locator(".had-yes").isVisible()));
  };

  await page.goto(url("2026-10-20", 10));

  const seg = meal => todayCard().locator(`.meal-seg button[data-meal="${meal}"]`);
  const isOn = async meal => /\bon\b/.test(await seg(meal).getAttribute("class"));
  const now = () => todayCard().locator(".meal-now");
  const other = () => todayCard().locator(".other-meal");

  await step("fridge has chicken, sausage rolls and chips", async () => {
    for (const [name, kind] of [["Chicken", "main"], ["Sausage rolls", "main"], ["Chips", "side"]]) {
      await page.click('[data-tab="add"]');
      await page.click('[data-sub="fridge"]');
      await page.click(`[data-kind="${kind}"]`);
      await page.fill("#name", name);
      if (await page.locator("#days").isVisible()) await page.fill("#days", "4");
      await page.click("#addBtn");
      await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
    }
  });

  await step("open day: two equal buttons Dinner | Tea at the top, Tea on", async () => {
    await page.click('[data-tab="meals"]');
    await until(async () => assert.ok(await seg("dinner").isVisible()));
    assert.ok(await seg("tea").isVisible());
    assert.equal(await isOn("tea"), true);
    assert.equal(await isOn("dinner"), false);
    const [a, b] = [await seg("dinner").boundingBox(), await seg("tea").boundingBox()];
    assert.ok(Math.abs(a.width - b.width) <= 2, "same width");
    assert.ok(Math.abs(a.y - b.y) <= 2, "side by side");
    assert.match(await page.locator("#pickFor").innerText(), /Tea/);
  });

  await step("tap Dinner: main AND side both go to dinner (the side used to jump to tea)", async () => {
    await seg("dinner").click();
    await until(async () => assert.equal(await isOn("dinner"), true));
    assert.match(await page.locator("#pickFor").innerText(), /Dinner/);
    await pick("Sausage rolls");
    await until(async () => assert.match(await now().innerText(), /Sausage rolls/));
    assert.equal(await isOn("dinner"), true, "still on Dinner after a pick");
    await page.locator('#mtabs [data-s="side"]').click();
    await pick("Chips");
    await until(async () => assert.match(await now().innerText(), /Chips/));
    assert.equal(await isOn("dinner"), true, "still on Dinner after the side");
  });

  await step("tap Tea: tea's foods show, dinner is one quiet line underneath", async () => {
    await seg("tea").click();
    await until(async () => assert.equal(await isOn("tea"), true));
    assert.doesNotMatch(await now().innerText(), /Sausage rolls|Chips/);
    await pick("Chicken");
    await until(async () => assert.match(await now().innerText(), /Chicken/));
    const o = await other().innerText();
    assert.match(o, /Dinner/);
    assert.match(o, /Sausage rolls/);
    assert.match(o, /Chips/);
  });

  await step("closed day: a DINNER line and a TEA line with their foods", async () => {
    await todayCard().locator(".dh").click();
    await until(async () => assert.equal(await page.locator("#mtabs").isVisible(), false));
    assert.match(await sit(todayCard(), "dinner").innerText(), /Sausage rolls/);
    assert.match(await sit(todayCard(), "dinner").innerText(), /Chips/);
    assert.match(await sit(todayCard(), "tea").innerText(), /Chicken/);
    assert.doesNotMatch(await sit(todayCard(), "tea").innerText(), /Sausage rolls/);
    assert.equal(await todayCard().locator(".meal-seg").count(), 0, "no buttons while closed");
  });

  await step("a day with only tea shows no DINNER line when closed", async () => {
    const tomorrow = page.locator("#dayList .day").filter({ hasText: "21 Oct" });
    assert.equal(await tomorrow.locator('.sit[data-meal="dinner"]').count(), 0);
  });

  await step("2pm: dinner asked; tea still planned on today's card", async () => {
    await setHour("2026-10-20", 15);
    await until(async () => assert.equal(await past("dinner").count(), 1));
    assert.equal(await past("tea").count(), 0);
    const d = await past("dinner").innerText();
    assert.match(d, /DINNER|Dinner/);
    assert.match(d, /Sausage rolls/);
    assert.match(d, /Chips/);
    assert.doesNotMatch(d, /Chicken/);
    assert.match(await todayCard().innerText(), /Chicken/);
    assert.doesNotMatch(await todayCard().innerText(), /Sausage rolls/);
  });

  await step("5pm with dinner still waiting: ONE card for the day, a dinner line and a tea line", async () => {
    await setHour("2026-10-20", 18);
    await until(async () => assert.equal(await past("tea").count(), 1));
    assert.equal(await pastCards().count(), 1, "one card for the day");
    assert.equal(await past("dinner").count(), 1);
    assert.match(await past("tea").innerText(), /Chicken/);
    assert.doesNotMatch(await past("tea").innerText(), /Sausage rolls/);
    assert.equal(await todayCard().count(), 0);
    // closed: each line has its own Used? tag and no buttons
    assert.equal(await past("dinner").locator(".ask-tag").count(), 1);
    assert.equal(await past("tea").locator(".ask-tag").count(), 1);
    assert.equal(await pastCards().locator(".had-yes").count(), 0);
  });

  await step("tap dinner: only dinner's buttons open (small); tap tea: they move to tea", async () => {
    await openAsk(past("dinner"));
    assert.equal(await past("tea").locator(".had-yes").count(), 0);
    const h = (await past("dinner").locator(".had-yes").boundingBox()).height;
    assert.ok(h <= 36, `small asking buttons (${h}px)`);
    await openAsk(past("tea"));
    assert.equal(await past("dinner").locator(".had-yes").count(), 0);
    await openAsk(past("dinner"));
  });

  await step("dinner: Yes -> how much did you use? -> Done; card stays with tea only", async () => {
    await past("dinner").locator(".had-yes").click();
    await until(async () => assert.match(await past("dinner").innerText(), /How much did you use\?/));
    await past("dinner").locator(".had-done").click();
    await until(async () => assert.equal(await past("dinner").count(), 0));
    assert.equal(await pastCards().count(), 1);
    assert.match(await past("tea").innerText(), /Chicken/);
  });

  await step("tea: Yes -> Done; the card goes", async () => {
    await openAsk(past("tea"));
    await past("tea").locator(".had-yes").click();
    await until(async () => assert.match(await past("tea").innerText(), /How much did you use\?/));
    await past("tea").locator(".had-done").click();
    await until(async () => assert.equal(await pastCards().count(), 0));
  });

  await step("a takeaway for dinner: planned for dinner, asked at 2pm, cost saved", async () => {
    await page.goto(url("2026-10-21", 10));
    await page.click('[data-tab="meals"]');
    await until(async () => assert.ok(await seg("dinner").isVisible()));
    await seg("dinner").click();
    await until(async () => assert.equal(await isOn("dinner"), true));
    await page.locator("#pickList .item.ta").click();
    await until(async () => assert.match(await now().innerText(), /Takeaway/));
    await seg("tea").click();
    await until(async () => assert.equal(await isOn("tea"), true));
    assert.doesNotMatch(await now().innerText(), /Takeaway/);

    await setHour("2026-10-21", 15);
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
    await until(async () => assert.ok(await seg("dinner").isVisible()));
    await seg("dinner").click();
    await until(async () => assert.equal(await isOn("dinner"), true));
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
