// V2 step 7b: today's planned meal asks "Had this meal?" from 5pm (Chrome, phone size).
// ?hour= fakes the clock hour (for checks only), like ?today=.
// Run with: npm run check:v2
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// V2DIR=v2-next runs the same checks against the V2.5 demo
const APP_DIR = process.env.V2DIR || "v2";
const PORT = 5199;
const ROOT = path.join(__dirname, "..");
const url = hour => `http://localhost:${PORT}/Food-Tracker/${APP_DIR}/?local=1&today=2026-10-07&hour=${hour}`;
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
  const pastDay = () => page.locator("#dayList .day.past");
  const todayCard = () => page.locator("#dayList .day.today");
  // Today's card is open on load: pick Takeaway for tonight
  const planTakeawayTonight = async hour => {
    await page.goto(url(hour));
    await page.click('[data-tab="meals"]');
    await page.click("#pickList .item.ta");
  };

  await step("before 5pm: tonight's takeaway is planned, not asked", async () => {
    await planTakeawayTonight(16);
    await until(async () => assert.match(await todayCard().innerText(), /Takeaway/));
    assert.equal(await pastDay().count(), 0);
  });

  await step("from 5pm: tonight's plan asks 'Had this meal?'", async () => {
    await planTakeawayTonight(18);
    await until(async () => assert.equal(await pastDay().count(), 1));
    assert.match(await pastDay().innerText(), /Wed/);
    assert.match(await pastDay().innerText(), /Takeaway/);
    // V2.5 demo: a small "Had the takeaway?" line instead of the big "Had this meal?" box
    assert.match(await pastDay().innerText(), APP_DIR === "v2-next" ? /Had the takeaway\?/ : /Had this meal\?/);
    // shown in place of today's planning card, not as well as it
    assert.equal(await todayCard().count(), 0);
  });

  await step("yes -> how much was it? -> done, nothing left to ask", async () => {
    await pastDay().locator(".had-yes").click();
    assert.match(await pastDay().innerText(), /How much was it\?/);
    await pastDay().locator(".cost-in").fill("20");
    await pastDay().locator(".cost-save").click();
    await until(async () => assert.equal(await pastDay().count(), 0));
    await until(async () => assert.equal(await todayCard().count(), 1));
  });

  await step("from 5pm: no -> 'What did you have?'", async () => {
    await planTakeawayTonight(19);
    await until(async () => assert.equal(await pastDay().count(), 1));
    await pastDay().locator(".had-no").click();
    await until(async () => assert.match(await page.locator("#dayList").innerText(), /What did you have\?/));
  });

  if (APP_DIR === "v2-next") {
    await step("V2.5: tonight's card still lets you add more food after 5pm (+ Add)", async () => {
      await page.goto(url(18));
      // two foods in the fridge
      for (const name of ["Chicken", "Bacon"]) {
        await page.click('[data-tab="add"]');
        await page.click('[data-kind="main"]');
        await page.fill("#name", name);
        await page.fill("#days", "4");
        await page.click("#addBtn");
      }
      await page.click('[data-tab="meals"]');
      await page.locator("#pickList .item", { hasText: "Chicken" }).click();
      await until(async () => assert.equal(await pastDay().count(), 1));
      assert.equal(await pastDay().locator(".chip2").count(), 1);
      await pastDay().locator(".had-add").click();
      await pastDay().locator("#pickList .item", { hasText: "Bacon" }).click();
      await until(async () => assert.equal(await pastDay().locator(".chip2").count(), 2));
      assert.match(await pastDay().innerText(), /Used\?/);
    });
  }

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  console.log("ALL V2 TONIGHT CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
