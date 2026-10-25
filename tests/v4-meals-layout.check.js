// Meals page layout (Darren 2026-10-25): 7 days on top, My meals and Combos fold away, Ideas for the week
// (Plan <day>, Other day, ✎ Edit), Move in Plan my week, Change on a planned day (Swap meal, Move day, Clear).
// Run with: node tests/v4-meals-layout.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5241;
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

  await page.goto(url("2026-10-25", 10));
  await page.click('[data-tab="meals"]');
  await step("Layout: days on top, My meals folded (Edit meals inside, folded), Combos open (All combos inside, folded)", async () => {
    const order = await page.evaluate(() => ["#weekBox", "#dayList", "#myMealsFold", "#combosFold"]
      .map(s => document.querySelector(s)).map(el => el && el.getBoundingClientRect().top));
    assert.ok(order.every(t => t != null), "all four parts are on the page");
    assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], "in that order");
    assert.equal(await isOpen("#myMealsFold"), false);
    assert.equal(await isOpen("#combosFold"), true);
    assert.equal(await page.locator("#myMealsFold #myMeals .ml").count(), 1);
    assert.equal(await page.locator("#myMealsFold #editMealsFold #newMeal").count(), 1);
    assert.equal(await isOpen("#editMealsFold"), false);
    assert.equal(await page.locator("#combosFold #ideasWeek").count(), 1);
    for (const s of ["#comboAdd", ".combo-list", "#aiAsk"]) assert.equal(await page.locator("#combosFold #allCombosFold " + s).count(), 1, s);
    assert.equal(await isOpen("#allCombosFold"), false);
    assert.equal(await page.locator("#ideasTonight").count(), 0, "Ideas for tonight is gone");
  });

  await step("Folds are remembered on this phone", async () => {
    await page.locator("#myMealsFold > summary").click();
    await page.locator("#allCombosFold > summary").click();
    // the state is kept when a slide settles: wait for both to finish before reloading
    await until(async () => assert.equal(await page.locator("#myMealsFold, #allCombosFold").evaluateAll(els => els.every(el => el.getAnimations({ subtree: true }).length === 0)), true));
    await page.reload();
    await page.click('[data-tab="meals"]');
    await until(async () => assert.equal(await isOpen("#myMealsFold"), true));
    assert.equal(await isOpen("#allCombosFold"), true);
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
  for (const [k, n, d] of [["main", "Chicken", 0], ["main", "Gammon", 5], ["main", "Sausages", 4], ["main", "Fish", 7],
    ["side", "Rice", 1], ["side", "Mash", 3], ["side", "Chips", 6], ["veg", "Peas", 9], ["veg", "Sweetcorn", 8]]) await addFood(k, n, d);

  await page.evaluate(k => localStorage.setItem(k, "sk-ant-test"), (APP_DIR === "live" ? "live." : "v4demo.") + "claudeKey");
  const pairs = [["Chicken", "Rice"], ["Gammon", "Mash"], ["Sausages", "Chips"], ["Fish", "Peas"]].map(([a, b]) => ({ a, b, note: "" }));
  await page.route("https://api.anthropic.com/v1/messages", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ pairs }) }] }) }));
  await page.click('[data-tab="meals"]');

  await step("Ask AI adds the combos", async () => {
    await page.click("#aiAsk");
    await until(async () => assert.ok(await page.locator("#aiReview").isVisible()));
    await page.click("#aiAdd");
    await until(async () => assert.ok(await page.locator("#aiReview").isHidden()));
  });

  const cards = page.locator("#ideasWeek .idea-card");
  const card = name => page.locator("#ideasWeek .idea-card", { has: page.locator(".idea-title", { hasText: new RegExp("^" + name) }) });
  const day = i => page.locator("#dayList .day").nth(i);

  await step("Ideas for the week: best 3 in day order; Plan tonight / Plan <day>, Other day, ✎ Edit; old buttons gone", async () => {
    await until(async () => assert.ok((await cards.count()) >= 3));
    assert.equal(await cards.locator(":visible").filter({ has: page.locator(".idea-title") }).count() <= 3, true);
    assert.match(await cards.nth(0).locator(".idea-title").innerText(), /^Chicken/);
    assert.equal((await cards.nth(0).locator(".idea-plan-day").innerText()).trim(), "Plan tonight");
    assert.equal((await card("Gammon").locator(".idea-plan-day").innerText()).trim(), "Plan Mon");
    for (const c of [".idea-other", ".idea-edit"]) assert.equal(await cards.nth(0).locator(c).count(), 1, c);
    for (const c of [".idea-yes", ".idea-not", ".idea-x", ".idea-nfm"]) assert.equal(await cards.nth(0).locator(c).count(), 0, c + " gone");
  });

  await step("Plan tonight: Chicken goes on Sunday and leaves the ideas", async () => {
    await card("Chicken").locator(".idea-plan-day").click();
    await until(async () => assert.match(await day(0).innerText(), /Chicken/));
    await until(async () => assert.equal(await card("Chicken").count(), 0));
  });

  await step("Other day on Gammon: only free days it is in date (Mon–Wed); Wed plans it there", async () => {
    await card("Gammon").locator(".idea-other").click();
    const chips = card("Gammon").locator(".idea-days .idea-day");
    await until(async () => assert.ok((await chips.count()) > 0));
    assert.deepEqual((await chips.allInnerTexts()).map(t => t.trim()), ["Mon", "Tue", "Wed"]);
    await chips.filter({ hasText: "Wed" }).click();
    await until(async () => assert.match(await day(3).innerText(), /Gammon/));
  });

  await step("✎ Edit on Sausages: Not <day> moves it to another day", async () => {
    const c = card("Sausages");
    const before = (await c.locator(".idea-plan-day").innerText()).trim();
    await c.locator(".idea-edit").click();
    const box = c.locator(".idea-editbox");
    await until(async () => assert.ok(await box.isVisible()));
    for (const b of [".idea-meal", ".idea-notday", ".idea-nolike", ".idea-nfm"]) assert.ok((await box.locator(b).count()) >= 1, b);
    assert.match(await box.locator(".idea-nolike").first().innerText(), /Chips with Sausages/);
    assert.equal((await box.locator(".idea-notday").innerText()).trim(), before.replace(/^Plan/, "Not"));
    await box.locator(".idea-notday").click();
    await until(async () => assert.notEqual((await card("Sausages").locator(".idea-plan-day").innerText()).trim(), before));
  });

  await step("✎ Edit → Make it a meal: saved to My meals", async () => {
    await card("Sausages").locator(".idea-edit").click();
    await card("Sausages").locator(".idea-meal").click();
    await until(async () => assert.match(await page.locator("#myMeals .ml").innerText(), /Sausages \+ Chips/));
  });

  const rows = page.locator("#weekPanel .wk-day");
  const title = i => rows.nth(i).locator(".wk-m b").innerText();

  // Drag from the grab handle (sel) to the middle of target, in small steps like a finger
  const drag = async (handle, target) => {
    const a = await handle.boundingBox(), b = await target.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 8, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
  };

  await step("Plan my week: Move swaps two days' ideas", async () => {
    await page.click("#weekBtn");
    await until(async () => assert.ok(await page.locator("#weekPanel").isVisible()));
    const n = await rows.count();
    const withIdea = [];
    for (let i = 0; i < n; i++) if (await rows.nth(i).locator(".wk-grab").count()) withIdea.push(i);
    assert.ok(withIdea.length >= 2, "two days with ideas");
    const [a, b] = withIdea;
    const ta = await title(a), tb = await title(b);
    await drag(rows.nth(a).locator(".wk-grab"), rows.nth(b));
    await until(async () => assert.equal(await title(a), tb));
    assert.equal(await title(b), ta);
    await page.click("#weekCancel");
  });

  await step("Change on Wednesday → Move day → Mon: Gammon moves to Monday", async () => {
    await day(3).locator(".sit-change").first().click();
    const bar = day(3).locator(".chg-bar");
    await until(async () => assert.ok(await bar.isVisible()));
    for (const b of [".chg-swap", ".chg-move", ".chg-clear"]) assert.equal(await bar.locator(b).count(), 1, b);
    await bar.locator(".chg-move").click();
    await bar.locator(".chg-to", { hasText: "Mon" }).click();
    await until(async () => assert.match(await day(1).innerText(), /Gammon/));
    assert.doesNotMatch(await day(3).innerText(), /Gammon/);
  });

  await step("Change on Monday → Clear: Monday is empty again", async () => {
    await day(1).locator(".sit-change").first().click();
    await day(1).locator(".chg-clear").click();
    await until(async () => assert.doesNotMatch(await day(1).innerText(), /Gammon/));
  });

  await step("Change on Sunday → Swap meal: something else, not Chicken", async () => {
    await day(0).locator(".sit-change").first().click();
    await day(0).locator(".chg-swap").click();
    await until(async () => assert.doesNotMatch(await day(0).innerText(), /Chicken/));
    assert.ok((await day(0).locator(".sit").count()) >= 1, "a new meal is planned");
  });

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("all ok");
})().catch(e => { console.error(e); process.exit(1); });
