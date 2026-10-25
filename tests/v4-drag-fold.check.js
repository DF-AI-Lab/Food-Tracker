// Meals: grab and move (Plan my week rows, planned days) and folds that slide open and shut (Darren 2026-10-25).
// Run with: node tests/v4-drag-fold.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5242;
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
  const isOpen = sel => page.locator(sel).evaluate(el => el.open);

  // Drag from the grab handle (sel) to the middle of target, in small steps like a finger
  const drag = async (handle, target) => {
    const a = await handle.boundingBox(), b = await target.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 8, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
  };

  await page.goto(url("2026-10-25", 10));
  await page.click('[data-tab="meals"]');

  await step("Fold closes with a slide, not a flash: still open while it slides, then shut", async () => {
    const fold = page.locator("#combosFold");
    assert.equal(await fold.evaluate(el => el.open), true);
    await page.locator("#combosFold > summary").click();
    await page.waitForTimeout(60);
    assert.equal(await fold.evaluate(el => el.open), true, "still open mid-slide");
    assert.ok(await fold.evaluate(el => el.getAnimations({ subtree: true }).length > 0), "an animation is running");
    await until(async () => assert.equal(await fold.evaluate(el => el.open), false));
  });

  await step("Fold opens with a slide too", async () => {
    const fold = page.locator("#combosFold");
    await page.locator("#combosFold > summary").click();
    await page.waitForTimeout(60);
    assert.equal(await fold.evaluate(el => el.open), true);
    assert.ok(await fold.evaluate(el => el.getAnimations({ subtree: true }).length > 0), "an animation is running");
    await page.waitForTimeout(600);
    assert.equal(await fold.evaluate(el => el.getAnimations({ subtree: true }).length), 0, "done after the slide");
  });

  const addFood = async (kind, name, days) => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click(`[data-kind="${kind}"]`);
    await page.fill("#name", name);
    await page.fill("#days", String(days));
    await page.click("#addBtn");
    await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
  };
  for (const [k, n, d] of [["main", "Gammon", 5], ["main", "Sausages", 4], ["main", "Fish", 7],
    ["side", "Mash", 3], ["side", "Chips", 6], ["veg", "Peas", 9]]) await addFood(k, n, d);
  await page.evaluate(k => localStorage.setItem(k, "sk-ant-test"), (APP_DIR === "live" ? "live." : "v4demo.") + "claudeKey");
  const pairs = [["Gammon", "Mash"], ["Sausages", "Chips"], ["Fish", "Peas"]].map(([a, b]) => ({ a, b, note: "" }));
  await page.route("https://api.anthropic.com/v1/messages", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ pairs }) }] }) }));
  await page.click('[data-tab="meals"]');
  if (!(await page.locator("#allCombosFold").evaluate(el => el.open))) await page.locator("#allCombosFold > summary").click();
  await page.click("#aiAsk");
  await until(async () => assert.ok(await page.locator("#aiReview").isVisible()));
  await page.click("#aiAdd");
  await until(async () => assert.ok(await page.locator("#aiReview").isHidden()));

  const rows = page.locator("#weekPanel .wk-day");
  const title = i => rows.nth(i).locator(".wk-m b").innerText();

  await step("Plan my week: grab handle on each idea row (no Move button); drag row 0 onto row 2 swaps them", async () => {
    await page.click("#weekBtn");
    await until(async () => assert.ok(await page.locator("#weekPanel").isVisible()));
    assert.equal(await page.locator("#weekPanel .wk-move").count(), 0, "Move button gone");
    assert.ok((await rows.nth(0).locator(".wk-grab").count()) === 1);
    const t0 = await title(0), t2 = await title(2);
    await drag(rows.nth(0).locator(".wk-grab"), rows.nth(2));
    await until(async () => assert.equal(await title(0), t2));
    assert.equal(await title(2), t0);
  });

  await step("Dropping where the food would be out of date does nothing", async () => {
    // Row 0 now holds Fish (in date all week); Gammon+Mash (Mash out Wed) is on row 2 = Tue. Drag Gammon to Sat (row 6).
    const t2 = await title(2);
    assert.match(t2, /^Gammon/);
    await drag(rows.nth(2).locator(".wk-grab"), rows.nth(6));
    await page.waitForTimeout(200);
    assert.equal(await title(2), t2, "Gammon stays on Tue");
  });

  await step("Plan these, then drag a planned day onto another day: the meal moves", async () => {
    await page.click("#weekPlan");
    await until(async () => assert.ok(await page.locator("#weekPanel").isHidden()));
    const day = i => page.locator("#dayList .day").nth(i);
    await until(async () => assert.match(await day(0).innerText(), /Fish/));
    assert.doesNotMatch(await day(5).innerText(), /Fish/);
    // Plan these no longer closes the open day card: close today's card, so its planned sitting shows as a closed line
    if (await page.locator("#dayList .day.open").count()) await page.locator("#dayList .day.open .dh").click();
    const grab = day(0).locator(".sit-grab").first();
    assert.equal(await grab.count(), 1, "planned day has a grab handle");
    await drag(grab, day(5));
    await until(async () => assert.match(await day(5).innerText(), /Fish/));
    assert.doesNotMatch(await day(0).innerText(), /Fish/);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("all ok");
})().catch(e => { console.error(e); process.exit(1); });
