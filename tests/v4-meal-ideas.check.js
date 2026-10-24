// Meal ideas step 1: Combos (pairs) and Ideas for tonight (Darren 2026-10-24).
// Run with: node tests/v4-meal-ideas.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5216;
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
  const addFood = async (kind, name, days) => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click(`[data-kind="${kind}"]`);
    await page.fill("#name", name);
    await page.fill("#days", String(days));
    await page.click("#addBtn");
    await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
  };
  const addPair = async (a, aKind, b, bKind) => {
    const pick = page.locator("#comboPick");
    await page.click("#comboAdd");
    await pick.locator(`[data-cpkind="${aKind}"]`).click();
    await pick.locator(".cp-chip", { hasText: new RegExp("^" + a + "$") }).click();
    await pick.locator(`[data-cpkind="${bKind}"]`).click();
    await pick.locator(".cp-chip", { hasText: new RegExp("^" + b + "$") }).click();
    await page.click("#cpSave");
  };
  const idea = name => page.locator("#ideasTonight .idea-card", { hasText: name });

  await page.goto(url("2026-10-24", 10));

  await step("fridge: Chicken, Chips, Cauli cheese, Pizza, Coleslaw", async () => {
    await addFood("main", "Chicken", 3);
    await addFood("side", "Chips", 6);
    await addFood("side", "Cauli cheese", 1);
    await addFood("main", "Pizza", 6);
    await addFood("side", "Coleslaw", 2);
  });

  await step("Meals: no pairs yet, so no ideas; Combos section is there", async () => {
    await page.click('[data-tab="meals"]');
    await until(async () => assert.ok(await page.locator("#combos").isVisible()));
    assert.equal(await page.locator("#ideasTonight .idea-card").count(), 0);
  });

  await step("add pairs by hand: they show in Combos", async () => {
    await addPair("Chicken", "main", "Chips", "side");
    await addPair("Chicken", "main", "Cauli cheese", "side");
    await addPair("Pizza", "main", "Coleslaw", "side");
    await until(async () => assert.equal(await page.locator("#combos .combo-chip").count(), 3));
  });

  await step("Ideas for tonight: Chicken + Cauli cheese + Chips first, then Pizza + Coleslaw", async () => {
    await until(async () => assert.equal(await page.locator("#ideasTonight .idea-card").count(), 2));
    const first = page.locator("#ideasTonight .idea-card").first();
    assert.match(await first.innerText(), /Chicken[\s\S]*Cauli cheese[\s\S]*Chips/);
    assert.ok(await first.locator(".idea-yes").isVisible());
    assert.ok(await first.locator(".idea-not").isVisible());
    assert.match(await first.locator(".idea-not").innerText(), /Not tonight/);
    assert.match(await first.locator(".idea-nfm").innerText(), /Not for me/);
  });

  await step("Not tonight hides Pizza today; a day old it no longer counts", async () => {
    await idea("Pizza").locator(".idea-not").click();
    await until(async () => assert.equal(await idea("Pizza").count(), 0));
    // kept on this phone with today's date, so tomorrow it no longer counts
    const saved = await page.evaluate(() => {
      const k = Object.keys(localStorage).find(x => x.endsWith(".notTonight"));
      return k ? JSON.parse(localStorage.getItem(k)) : null;
    });
    assert.deepEqual(saved, { day: "2026-10-24", keys: ["pizza"] });
    await page.evaluate(() => {
      const k = Object.keys(localStorage).find(x => x.endsWith(".notTonight"));
      localStorage.setItem(k, JSON.stringify({ day: "2026-10-23", keys: ["pizza"] }));
    });
    await page.click('[data-tab="fridge"]');
    await page.click('[data-tab="meals"]');
    await until(async () => assert.equal(await idea("Pizza").count(), 1));
  });

  await step("Not for me on Pizza (1 pair): pair goes to Hidden, idea gone", async () => {
    await idea("Pizza").locator(".idea-nfm").click();
    await until(async () => assert.equal(await idea("Pizza").count(), 0));
    await until(async () => assert.equal(await page.locator("#combosHidden .combo-row", { hasText: "Pizza" }).count(), 1));
    assert.equal(await page.locator("#combos .combo-list .combo-group", { hasText: "Pizza" }).count(), 0);
  });

  await step("Bring back: Pizza idea returns", async () => {
    await page.locator("#combosHidden .combo-row", { hasText: "Pizza" }).locator(".combo-back").click();
    await until(async () => assert.equal(await idea("Pizza").count(), 1));
  });

  await step("Not for me on Chicken (2 pairs): asks which pair", async () => {
    await idea("Chicken").locator(".idea-nfm").click();
    const opts = idea("Chicken").locator(".idea-pair");
    await until(async () => assert.equal(await opts.count(), 2));
    await idea("Chicken").locator(".idea-pair", { hasText: "Cauli cheese" }).click();
    await until(async () => assert.doesNotMatch(await idea("Chicken").innerText(), /Cauli cheese/));
    assert.match(await idea("Chicken").innerText(), /Chips/);
    await page.locator("#combosHidden .combo-row", { hasText: "Cauli cheese" }).locator(".combo-back").click();
    await until(async () => assert.match(await idea("Chicken").innerText(), /Cauli cheese/));
  });

  await step("Yes: pick a day; a later day warns what runs out; Plan tonight", async () => {
    await idea("Chicken").locator(".idea-yes").click();
    const card = idea("Chicken");
    await until(async () => assert.equal(await card.locator(".idea-day").count(), 4));
    assert.match(await card.locator(".idea-day.on").innerText(), /Tonight/);
    assert.equal((await card.locator(".idea-warn").innerText()).trim(), "");
    await card.locator(".idea-day").nth(3).click(); // 3 days on: Cauli cheese (1 day) and Chicken (3 days) out
    await until(async () => assert.match(await card.locator(".idea-warn").innerText(), /Cauli cheese/));
    await card.locator(".idea-cancel").click();
    await until(async () => assert.equal(await card.locator(".idea-day").count(), 0));
    await card.locator(".idea-yes").click();
    await until(async () => assert.equal(await card.locator(".idea-day").count(), 4));
    await card.locator(".idea-plan").click();
    await until(async () => assert.equal(await idea("Chicken").count(), 0));
    assert.equal(await idea("Pizza").count(), 1);
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));
  await browser.close();
  server.close();
  console.log("ALL MEAL IDEAS CHECKS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
