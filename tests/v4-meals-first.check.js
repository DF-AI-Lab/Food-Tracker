// My meals first, then combos; Edit on a day's top 3 (✕ a food: Not this day / Don't like; Not this day for the idea) (Darren 2026-10-25).
// Run with: node tests/v4-meals-first.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5234;
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
  for (const [k, n, d] of [["main", "Chicken", 2], ["veg", "Peppers", 3], ["misc", "Wraps", 10], ["main", "Gammon", 5], ["side", "Mash", 4], ["veg", "Peas", 9]]) await addFood(k, n, d);

  await page.evaluate(() => localStorage.setItem("v4demo.claudeKey", "sk-ant-test"));
  const pairs = [["Gammon", "Mash"], ["Gammon", "Peas"]].map(([a, b]) => ({ a, b, note: "" }));
  await page.route("https://api.anthropic.com/v1/messages", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ pairs }) }] }) }));
  await page.click('[data-tab="meals"]');
  await page.click("#aiAsk");
  await until(async () => assert.ok(await page.locator("#aiReview").isVisible()));
  await page.click("#aiAdd");

  // A saved meal: Fajitas = Chicken, Peppers, Wraps
  const typeFresh = async (typed, pick) => {
    await page.fill("#freshIn", typed);
    const sug = page.locator("#freshSuggest .sug", { hasText: pick });
    await until(async () => assert.ok((await sug.count()) >= 1));
    await sug.first().click();
  };
  await page.click("#newMeal");
  await page.fill("#mealName", "Fajitas");
  for (const f of ["Chicken", "Peppers", "Wraps"]) await typeFresh(f, f);
  await page.click("#mealSave");
  await until(async () => assert.ok(await page.locator("#mealForm").isHidden()));

  const cards = page.locator("#ideasTonight .idea-card");

  await step("Ideas for tonight: Fajitas (my meal) first, then Gammon; no ✕ or Not for me on a meal", async () => {
    await until(async () => assert.match(await cards.first().locator(".idea-title").innerText(), /^Fajitas$/));
    assert.match(await cards.nth(1).locator(".idea-title").innerText(), /^Gammon/);
    assert.equal(await cards.first().locator(".idea-x").count(), 0);
    assert.equal(await cards.first().locator(".idea-nfm").count(), 0);
    assert.equal(await cards.first().locator(".idea-food").count(), 3);
  });

  await step("Yes → Plan tonight: Fajitas planned as the meal", async () => {
    await cards.first().locator(".idea-yes").click();
    await cards.first().locator(".idea-plan").click();
    await until(async () => assert.match(await page.locator("#dayList .day").nth(0).innerText(), /Fajitas/));
  });

  const openDay = async i => {
    await page.locator("#dayList .day").nth(i).locator(".dh").click();
    await until(async () => assert.ok(await page.locator("#dayList .day.open .day-ideas").isVisible()));
    return page.locator("#dayList .day.open .day-ideas");
  };
  const first = box => box.locator(".dt-idea").first();

  await step("Tuesday's top 3: Gammon + Mash + Peas; Edit shows its foods with ✕ on the sides", async () => {
    const box = await openDay(2);
    assert.match(await first(box).locator("b").first().innerText(), /^Gammon \+ Mash \+ Peas/);
    await first(box).locator(".dt-edit").click();
    await until(async () => assert.equal(await box.locator(".idea-food").count(), 3));
    assert.equal(await box.locator(".idea-food", { hasText: "Gammon" }).locator(".idea-x").count(), 0);
  });

  await step("✕ Peas → Not this day: Gammon + Mash on Tuesday", async () => {
    const box = page.locator("#dayList .day.open .day-ideas");
    await box.locator(".idea-food", { hasText: "Peas" }).locator(".idea-x").click();
    await until(async () => assert.ok(await box.locator(".idea-xpop").isVisible()));
    assert.match(await box.locator(".idea-xnot").innerText(), /Not this day/);
    await box.locator(".idea-xnot").click();
    await until(async () => assert.match(await first(box).locator("b").first().innerText(), /^Gammon \+ Mash$/));
  });

  await step("Not this day on the whole idea: Tuesday has no ideas left", async () => {
    const box = page.locator("#dayList .day.open .day-ideas");
    if (!(await box.locator(".dt-not").count())) await first(box).locator(".dt-edit").click();
    await box.locator(".dt-not").first().click();
    await until(async () => assert.equal(await page.locator("#dayList .day.open .day-ideas").count(), 0));
  });

  await step("Wednesday: Gammon + Mash + Peas is back; ✕ Peas → Don't like hides it for good", async () => {
    await page.locator("#dayList .day").nth(3).locator(".dh").click();
    const box = page.locator("#dayList .day.open .day-ideas");
    await until(async () => assert.match(await first(box).locator("b").first().innerText(), /^Gammon \+ Mash \+ Peas/));
    await first(box).locator(".dt-edit").click();
    await box.locator(".idea-food", { hasText: "Peas" }).locator(".idea-x").click();
    await box.locator(".idea-xbad").click();
    await until(async () => assert.match(await first(box).locator("b").first().innerText(), /^Gammon \+ Mash$/));
  });

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("all ok");
})().catch(e => { console.error(e); process.exit(1); });
