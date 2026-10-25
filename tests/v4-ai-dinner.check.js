// Ask AI for dinner (Darren 2026-10-25): the AI picks plates (main + base + goes-with) from the fridge.
// Plan tonight plans it and saves it; 👍 Save keeps it as combos so the app can pick it later; Not this drops it.
// Run with: node tests/v4-ai-dinner.check.js  (V4DIR=live for live)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5244;
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
  const keyName = (APP_DIR === "live" ? "live." : "v4demo.") + "claudeKey";

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
  for (const [k, n, d] of [["main", "Sausages", 1], ["side", "Potatoes", 3], ["veg", "Peas", 9], ["main", "Chicken", 4], ["side", "Rice", 30]]) await addFood(k, n, d);
  await page.click('[data-tab="meals"]');

  let calls = 0;
  const reply = { plates: [
    { main: "Sausages", base: "Potatoes", note: "mash", sides: ["Peas"], why: "Sausages go out tomorrow" },
    { main: "Chicken", base: "Rice", note: "", sides: [], why: "Easy one" }
  ] };
  await page.route("https://api.anthropic.com/v1/messages", async route => {
    calls++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply) }] }) });
  });

  const btn = page.locator("#dinnerBtn");
  const cards = page.locator("#dinnerBox .dinner-card");

  await step("Ask AI for dinner sits next to Plan my week", async () => {
    assert.ok(await btn.isVisible());
    assert.match(await btn.innerText(), /Ask AI for dinner/);
    assert.equal(await page.locator("#weekBox #dinnerBtn").count(), 1);
  });

  await step("No key: says to add it in Settings, no call", async () => {
    await btn.click();
    await until(async () => assert.match(await page.locator("#dinnerMsg").innerText(), /Settings/));
    assert.equal(calls, 0);
  });

  await page.evaluate(k => localStorage.setItem(k, "sk-ant-test"), keyName);

  await step("With a key: shows the AI's plates, each with why and buttons", async () => {
    await btn.click();
    await until(async () => assert.equal(await cards.count(), 2));
    assert.equal(calls, 1);
    const first = cards.nth(0);
    assert.match(await first.locator(".dinner-title").innerText(), /Sausages \+ Potatoes \(mash\) \+ Peas/);
    assert.match(await first.innerText(), /Sausages go out tomorrow/);
    for (const c of [".dinner-plan", ".dinner-save", ".dinner-no"]) assert.equal(await first.locator(c).count(), 1, c);
    assert.match(await first.locator(".dinner-plan").innerText(), /Plan tonight/);
  });

  await step("👍 Save: the plate is kept as combos (with roles); the card says Saved", async () => {
    await cards.nth(1).locator(".dinner-save").click();
    await until(async () => assert.match(await cards.nth(1).innerText(), /Saved/));
    assert.equal(await cards.nth(1).locator(".dinner-save").count(), 0);
    await page.evaluate(() => { document.getElementById("allCombosFold").open = true; });
    await until(async () => assert.match(await page.locator("#combos .combo-list").innerText(), /Rice/));
  });

  await step("Not this: the card goes", async () => {
    await cards.nth(1).locator(".dinner-no").click();
    await until(async () => assert.equal(await cards.count(), 1));
  });

  await step("Plan tonight: today's day card gets the foods; the plate is saved too", async () => {
    await cards.nth(0).locator(".dinner-plan").click();
    await until(async () => assert.equal(await cards.count(), 0));
    await until(async () => assert.match(await page.locator("#dayList .day").nth(0).innerText(), /Sausages/));
    assert.match(await page.locator("#combos .combo-list").innerText(), /Potatoes/);
  });

  assert.deepEqual(errors, [], "no page errors");
  console.log("all ok");
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
