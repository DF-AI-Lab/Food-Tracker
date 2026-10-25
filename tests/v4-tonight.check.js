// Ideas for tonight v2: best 3 then Show more, a coloured why line (Darren 2026-10-25).
// Run with: node tests/v4-tonight.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5232;
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
  for (const [k, n, d] of [["main", "Chicken", 0], ["main", "Gammon", 5], ["main", "Sausages", 4], ["main", "Fish", 7], ["main", "Pork", 8],
    ["side", "Rice", 1], ["side", "Mash", 3], ["side", "Chips", 6], ["veg", "Peas", 9], ["side", "Beans", 10]]) await addFood(k, n, d);

  // Combos added through Ask AI (faked)
  await page.evaluate(k => localStorage.setItem(k, "sk-ant-test"), (APP_DIR === "live" ? "live." : "v4demo.") + "claudeKey");
  const pairs = [["Chicken", "Rice"], ["Gammon", "Mash"], ["Sausages", "Chips"], ["Fish", "Peas"], ["Pork", "Beans"]].map(([a, b]) => ({ a, b, note: "" }));
  await page.route("https://api.anthropic.com/v1/messages", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ pairs }) }] }) }));
  await page.click('[data-tab="meals"]');
  await page.click("#aiAsk");
  await until(async () => assert.ok(await page.locator("#aiReview").isVisible()));
  await page.click("#aiAdd");

  const cards = page.locator("#ideasTonight .idea-card");
  const visible = async () => (await cards.evaluateAll(els => els.filter(e => e.offsetParent !== null).length));
  const more = page.locator("#ideasTonight .idea-more");

  await step("best 3 shown, the rest behind Show 2 more ideas", async () => {
    await until(async () => assert.equal(await visible(), 3));
    assert.match(await more.innerText(), /Show 2 more ideas/);
  });

  await step("first idea: Chicken, why line red 'goes out today'", async () => {
    const first = cards.first();
    assert.match(await first.locator(".idea-title").innerText(), /^Chicken/);
    const why = first.locator(".idea-why");
    assert.match(await why.innerText(), /Chicken goes out today/);
    assert.ok(await why.evaluate(el => el.classList.contains("st-out")));
    assert.ok(await cards.nth(1).locator(".idea-why").evaluate(el => el.classList.contains("st-soon") || el.classList.contains("st-ok")));
  });

  await step("Show more opens all 5; Show fewer goes back to 3", async () => {
    await more.click();
    await until(async () => assert.equal(await visible(), 5));
    assert.match(await more.innerText(), /Show fewer/);
    await more.click();
    await until(async () => assert.equal(await visible(), 3));
  });

  await step("Not tonight on one: still 3 shown, Show 1 more idea", async () => {
    await cards.first().locator(".idea-not").click();
    await until(async () => assert.match(await more.innerText(), /Show 1 more idea\b/));
    assert.equal(await visible(), 3);
  });

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("all ok");
})().catch(e => { console.error(e); process.exit(1); });
