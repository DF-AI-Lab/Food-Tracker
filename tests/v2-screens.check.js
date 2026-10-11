// Click-through check of the V2 app screens in Chrome (phone size), served the way
// GitHub Pages will serve it: plain static files under /Food-Tracker/v2/, no server API.
// ?local=1 skips sign-in and keeps data in memory (for this check only).
// Run with: npm run check:v2   (needs Playwright installed)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 5198;
const ROOT = path.join(__dirname, "..");
const PAGE_URL = `http://localhost:${PORT}/Food-Tracker/v2/?local=1&today=2026-10-07`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

// Static files only, like GitHub Pages: /Food-Tracker/<path> -> repo/<path>, anything else 404
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
  const text = sel => page.locator(sel).innerText();
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); }
    }
  };

  await page.goto(PAGE_URL);

  await step("opens and shows today", async () => {
    assert.match(await text("#today"), /Wed 7 Oct/);
  });

  await step("fridge starts empty", async () => {
    assert.equal(await page.locator("#mains .pack").count(), 0);
  });

  await step("tabs switch", async () => {
    await page.click('[data-tab="add"]');
    assert.ok(await page.locator('[data-tab-pane="add"]').isVisible());
    await page.click('[data-tab="meals"]');
    assert.ok(await page.locator('[data-tab-pane="meals"]').isVisible());
  });

  await step("can add a pack and see it in the fridge (memory only)", async () => {
    await page.click('[data-tab="add"]');
    await page.click('[data-kind="main"]');
    await page.fill("#name", "Chicken");
    await page.fill("#days", "1");
    await page.click("#addBtn");
    await until(async () => assert.match(await text("#addMsg"), /added/i));
    await page.click('[data-tab="fridge"]');
    await until(async () => assert.equal(await page.locator("#mains .pack").count(), 1));
  });

  // ---------- step 7a: edit a pack ----------
  const openEdit = async name => {
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    await page.locator("#mains .pack", { hasText: name }).click();
    await page.click("#actEdit");
    await page.locator("#editForm").waitFor({ state: "visible" });
  };

  await step("✏️ Edit opens with the pack's details filled in", async () => {
    await openEdit("Chicken");
    assert.equal(await page.inputValue("#editName"), "Chicken");
    assert.equal(await page.inputValue("#editKind"), "main");
    assert.match(await page.inputValue("#editDate"), /^\d{4}-\d{2}-\d{2}$/);
  });

  await step("a blank name is refused with a message, the form stays open", async () => {
    await page.fill("#editName", "  ");
    await page.click("#editSave");
    await until(async () => assert.match(await text("#editMsg"), /Needs a name/));
    assert.ok(await page.locator("#editForm").isVisible());
  });

  await step("save: new name, sub, date and price show on the card", async () => {
    await page.fill("#editName", "chicken thighs");
    await page.fill("#editSub", "Asda");
    await page.fill("#editDate", "2026-10-12");
    await page.selectOption("#editDateType", "best_before");
    await page.fill("#editPrice", "3.50");
    await page.click("#editSave");
    await page.locator("#editForm").waitFor({ state: "hidden" });
    await until(async () => assert.match(await text("#mains"), /Chicken thighs/));
    await openEdit("Chicken thighs");
    assert.equal(await page.inputValue("#editSub"), "Asda");
    assert.equal(await page.inputValue("#editDate"), "2026-10-12");
    assert.equal(await page.inputValue("#editDateType"), "best_before");
    assert.equal(await page.inputValue("#editPrice"), "3.5");
    await page.click("#editCancel");
    await page.locator("#editForm").waitFor({ state: "hidden" });
  });

  await step("undo puts the old details back", async () => {
    await openEdit("Chicken thighs");
    await page.fill("#editName", "Turkey");
    await page.click("#editSave");
    await until(async () => assert.match(await text("#mains"), /Turkey/));
    await page.click("#undoBtn");
    await until(async () => assert.match(await text("#mains"), /Chicken thighs/));
    assert.doesNotMatch(await text("#mains"), /Turkey/);
  });

  await step("top right: 📷 · 🖨️ · 🔔 · ⚙️, bell opens and closes", async () => {
    const ids = await page.locator(".pal button").evaluateAll(bs => bs.map(b => b.id));
    assert.deepEqual(ids, ["scanBtn", "printF", "bellBtn", "settingsBtn"]);
    assert.equal(await page.locator("#bellCount").isVisible(), false, "nothing new");
    await page.click("#bellBtn");
    assert.ok(await page.locator("#bell").isVisible());
    assert.match(await text("#bellList"), /Nothing yet/);
    await page.click("#bellClose");
    assert.equal(await page.locator("#bell").isVisible(), false);
  });

  await step("version number shows at the bottom", async () => {
    await until(async () => assert.match(await text("#ver"), /^v\d+ · \d+ \w+$/));
  });

  await step("test banner stays hidden", async () => {
    assert.equal(await page.locator("#testBanner").isVisible(), false);
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  console.log("ALL V2 SCREEN CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
