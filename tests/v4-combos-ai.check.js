// Combos v4: groups collapse, AI fill-in (Copy / Download / Paste / Upload, then keep or bin each), Stock check days + colours (Darren 2026-10-25).
// Run with: node tests/v4-combos-ai.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5231;
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
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
  const answer = JSON.stringify({ pairs: [{ a: "Chicken", b: "Rice" }, { a: "Chicken", b: "Sweetcorn" }, { a: "Gammon", b: "Pineapple" }] });

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
  for (const [k, n, d] of [["main", "Chicken", 0], ["side", "Rice", 1], ["veg", "Sweetcorn", 9], ["main", "Gammon", 5], ["misc", "Pineapple", 6], ["main", "Sausages", 4], ["side", "Mash", 3], ["misc", "Gravy", 20]]) await addFood(k, n, d);

  await page.click('[data-tab="meals"]');
  await until(async () => assert.ok(await page.locator("#combos").isVisible()));

  // The Claude API, faked: records the request, answers with 3 pairs (1 uses a food not in the app)
  let apiReq = null;
  await page.route("https://api.anthropic.com/v1/messages", async route => {
    apiReq = { headers: route.request().headers(), body: JSON.parse(route.request().postData()) };
    const pairs = [{ a: "Sausages", b: "Gravy", note: "" }, { a: "Gammon", b: "Rice", note: "" }, { a: "Gammon", b: "Quinoa", note: "" }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify({ pairs }) }] }) });
  });

  await step("Ask AI with no key: says to add it in Settings, no call", async () => {
    await page.click("#aiAsk");
    await until(async () => assert.match(await page.locator("#aiMsg").innerText(), /key in Settings/));
    assert.equal(apiReq, null);
  });

  await step("Settings: save a Claude key (kept on this phone)", async () => {
    await page.click("#settingsBtn");
    await until(async () => assert.ok(await page.locator("#aiKey").isVisible()));
    await page.fill("#aiKey", "sk-ant-test-123");
    await page.click("#aiKeySave");
    await until(async () => assert.match(await page.locator("#aiKeyNote").innerText(), /saved/i));
    await page.click("#settingsClose");
    await page.click('[data-tab="meals"]');
  });

  await step("Ask AI: calls Claude (Haiku, key, browser header), review shows only foods in the app", async () => {
    await page.click("#aiAsk");
    await until(async () => assert.ok(await review.isVisible()));
    assert.equal(apiReq.headers["x-api-key"], "sk-ant-test-123");
    assert.equal(apiReq.headers["anthropic-dangerous-direct-browser-access"], "true");
    assert.equal(apiReq.body.model, "claude-haiku-5-5");
    assert.match(apiReq.body.messages[0].content, /Mains: [^\n]*Gammon/);
    assert.equal(await review.locator(".ai-row").count(), 2, "Quinoa dropped");
    await page.click("#aiCancel");
  });

  await step("AI box: Copy for AI puts the instructions and food on the clipboard", async () => {
    await page.click("#aiCopy");
    await until(async () => {
      const t = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(t, /"pairs"/);
      assert.match(t, /Mains:/);
    });
  });

  await step("Download gives a .txt file", async () => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#aiDownload")]);
    assert.match(dl.suggestedFilename(), /^combos-for-ai-2026-10-25\.txt$/);
  });

  await step("Paste answer: box, Check, review list with 3 rows all kept", async () => {
    assert.ok(await review.isHidden());
    await page.click("#aiPaste");
    await until(async () => assert.ok(await page.locator("#aiPasteText").isVisible()));
    await page.fill("#aiPasteText", "Here you go:\n```json\n" + answer + "\n```");
    await page.click("#aiCheck");
    await until(async () => assert.ok(await review.isVisible()));
    assert.equal(await review.locator(".ai-row").count(), 3);
    assert.match(await page.locator("#aiAdd").innerText(), /Add 3/);
  });

  await step("✗ on Gammon + Pineapple: crossed out, Add 2; ✓ brings it back", async () => {
    const row = review.locator(".ai-row", { hasText: "Pineapple" });
    await row.locator(".ai-no").click();
    await until(async () => assert.ok(await row.evaluate(el => el.classList.contains("off"))));
    assert.match(await page.locator("#aiAdd").innerText(), /Add 2/);
    await row.locator(".ai-yes").click();
    assert.match(await page.locator("#aiAdd").innerText(), /Add 3/);
    await row.locator(".ai-no").click();
  });

  await step("Add 2: review closes, Chicken group shows collapsed with a count", async () => {
    await page.click("#aiAdd");
    await until(async () => assert.ok(await review.isHidden()));
    const g = group("Chicken");
    await until(async () => assert.equal(await g.count(), 1));
    assert.equal((await g.locator(".combo-count").innerText()).trim(), "2");
    assert.ok(await g.locator(".combo-chips").isHidden(), "starts closed");
    assert.equal(await group("Gammon").count(), 0);
  });

  await step("tap the name: opens with chips and + Add; tap again closes", async () => {
    const g = group("Chicken");
    await g.locator(".combo-food").click();
    await until(async () => assert.ok(await g.locator(".combo-chips").isVisible()));
    assert.equal(await g.locator(".combo-chip").count(), 2);
    await g.locator(".combo-more").click();
    await until(async () => assert.match(await page.locator("#comboPick .cp-title").innerText(), /Chicken goes with/));
    await page.click("#cpCancel");
    await g.locator(".combo-food").click();
    await until(async () => assert.ok(await g.locator(".combo-chips").isHidden()));
  });

  await step("Upload a file: same review; ones already added are skipped", async () => {
    const more = JSON.stringify({ pairs: [{ a: "Chicken", b: "Rice" }, { a: "Sausages", b: "Mash" }] });
    await page.setInputFiles("#aiFile", { name: "answer.txt", mimeType: "text/plain", buffer: Buffer.from(more) });
    await until(async () => assert.ok(await review.isVisible()));
    assert.equal(await review.locator(".ai-row").count(), 1);
    await page.click("#aiCancel");
    await until(async () => assert.ok(await review.isHidden()));
  });

  await step("Paste nonsense: a message, no review", async () => {
    await page.click("#aiPaste");
    await page.fill("#aiPasteText", "sorry, no idea");
    await page.click("#aiCheck");
    await until(async () => assert.ok(await page.locator("#aiMsg").isVisible()));
    assert.ok(await review.isHidden());
  });

  await step("Stock check: every dated row shows days, coloured", async () => {
    await page.click('[data-tab="fridge"]');
    await page.click("#stockBtn");
    await until(async () => assert.ok(await page.locator("#stockPanel").isVisible()));
    let seen = 0;
    for (const key of ["main", "side", "veg", "misc"]) {
      await page.click(`#stockPanel [data-stock="${key}"]`);
      const dates = page.locator("#stockList .sr-date");
      const n = await dates.count();
      for (let i = 0; i < n; i++) {
        const d = dates.nth(i);
        const t = (await d.innerText()).trim();
        if (/^added/.test(t)) continue;
        assert.match(t, /(days? out|today|\d+ days?)/, t);
        assert.ok(await d.evaluate(el => /\bst-(out|soon|ok)\b/.test(el.className)), t);
        seen++;
      }
    }
    assert.ok(seen > 0, "some dated rows");
  });

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("all ok");
})().catch(e => { console.error(e); process.exit(1); });
