// Meals: ✕ on an idea's food (Not tonight / Don't like), AI ✗ saved, Plan my week, a day's top 3 (Darren 2026-10-25).
// Run with: node tests/v4-week.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5233;
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
  const group = name => page.locator("#combos .combo-list .combo-group", { has: page.locator(".combo-food", { hasText: new RegExp("^" + name) }) });
  const review = page.locator("#aiReview");

  await page.goto(url("2026-10-25", 10));
  const addFood = async (kind, name, days) => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click(`[data-kind="${kind}"]`);
    await page.fill("#name", name);
    await page.fill("#days", String(days));
    await page.click("#addBtn");
    await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
  };
  for (const [k, n, d] of [["main", "Chicken", 0], ["main", "Gammon", 5], ["main", "Sausages", 4], ["main", "Fish", 7],
    ["side", "Rice", 1], ["side", "Mash", 3], ["side", "Chips", 6], ["veg", "Peas", 9], ["veg", "Sweetcorn", 8]]) await addFood(k, n, d);

  // Combos through Ask AI (faked); Fish + Chips gets ✗
  await page.evaluate(() => localStorage.setItem("v4demo.claudeKey", "sk-ant-test"));
  const pairs = [["Chicken", "Rice"], ["Chicken", "Sweetcorn"], ["Gammon", "Mash"], ["Sausages", "Chips"], ["Fish", "Peas"], ["Fish", "Chips"]].map(([a, b]) => ({ a, b, note: "" }));
  await page.route("https://api.anthropic.com/v1/messages", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ pairs }) }] }) }));
  await page.click('[data-tab="meals"]');

  await step("AI review: ✗ on Fish + Chips is saved as don't like; asking again brings nothing new", async () => {
    await page.click("#aiAsk");
    await until(async () => assert.ok(await review.isVisible()));
    await review.locator(".ai-row", { hasText: "Fish" }).filter({ hasText: "Chips" }).locator(".ai-no").click();
    assert.match(await page.locator("#aiAdd").innerText(), /Add 5/);
    await page.click("#aiAdd");
    await until(async () => assert.ok(await review.isHidden()));
    await page.click("#aiAsk");
    await until(async () => assert.match(await page.locator("#aiMsg").innerText(), /Nothing new/));
    assert.ok(await review.isHidden());
  });

  const idea = name => page.locator("#ideasTonight .idea-card", { has: page.locator(".idea-title", { hasText: new RegExp("^" + name) }) });
  const food = (card, name) => card.locator(".idea-food", { hasText: name });

  await step("✕ on Sweetcorn → Not tonight: gone from Chicken's idea, Rice stays", async () => {
    const c = idea("Chicken");
    await until(async () => assert.equal(await c.count(), 1));
    assert.equal(await food(c, "Chicken").locator(".idea-x").count(), 0, "no ✕ on the main");
    await food(c, "Sweetcorn").locator(".idea-x").click();
    await until(async () => assert.ok(await c.locator(".idea-xpop").isVisible()));
    assert.match(await c.locator(".idea-xpop").innerText(), /Sweetcorn with Chicken/);
    await c.locator(".idea-xnot").click();
    await until(async () => assert.equal(await food(idea("Chicken"), "Sweetcorn").count(), 0));
    assert.equal(await food(idea("Chicken"), "Rice").count(), 1);
  });

  await step("✕ on Rice → Don't like: Chicken + Rice hidden, Chicken idea gone", async () => {
    await food(idea("Chicken"), "Rice").locator(".idea-x").click();
    await idea("Chicken").locator(".idea-xbad").click();
    await until(async () => assert.equal(await idea("Chicken").count(), 0));
  });

  const rows = page.locator("#weekPanel .wk-day");
  const title = i => rows.nth(i).locator(".wk-m b").innerText();

  await step("Plan my week: 7 days, soonest out first, empty days say Nothing left", async () => {
    await page.click("#weekBtn");
    await until(async () => assert.ok(await page.locator("#weekPanel").isVisible()));
    assert.equal(await rows.count(), 7);
    assert.match(await title(0), /^Gammon \+ Mash/);
    assert.match(await title(1), /^Sausages \+ Chips/);
    assert.match(await title(2), /^Fish \+ Peas/);
    for (let i = 3; i < 7; i++) assert.match(await rows.nth(i).innerText(), /Nothing left/);
    assert.match(await page.locator("#weekPlan").innerText(), /Plan these 3/);
  });

  await step("Swap Sunday: Sausages first, Gammon moves to Monday; untick Tuesday → Plan these 2", async () => {
    await rows.nth(0).locator(".wk-swap").click();
    await until(async () => assert.match(await title(0), /^Sausages/));
    assert.match(await title(1), /^Gammon/);
    await rows.nth(2).locator(".wk-tick").click();
    await until(async () => assert.match(await page.locator("#weekPlan").innerText(), /Plan these 2/));
  });

  await step("Plan these 2: panel closes, Sunday and Monday planned", async () => {
    await page.click("#weekPlan");
    await until(async () => assert.ok(await page.locator("#weekPanel").isHidden()));
    const days = page.locator("#dayList .day");
    await until(async () => assert.match(await days.nth(0).innerText(), /Sausages/));
    assert.match(await days.nth(1).innerText(), /Gammon/);
    assert.doesNotMatch(await days.nth(2).innerText(), /Fish/);
  });

  await step("Open Wednesday: its top 3 shows Fish + Peas; Plan puts it on Wednesday", async () => {
    const wed = page.locator("#dayList .day").nth(3);
    await wed.locator(".dh").click();
    const box = page.locator("#dayList .day.open .day-ideas");
    await until(async () => assert.ok(await box.isVisible()));
    const opts = box.locator(".dt-idea");
    assert.ok((await opts.count()) >= 1 && (await opts.count()) <= 3);
    const fish = opts.filter({ hasText: "Fish" });
    assert.equal(await fish.count(), 1);
    await fish.locator(".dt-plan").click();
    await until(async () => assert.match(await page.locator("#dayList .day").nth(3).innerText(), /Fish/));
  });

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("all ok");
})().catch(e => { console.error(e); process.exit(1); });
