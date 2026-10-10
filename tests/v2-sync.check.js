// Two phones, one fridge (V2 step 4): food added on one phone shows on the other,
// it survives a reload, and food added offline syncs when back online.
// Chrome at phone size, against the Auth + Firestore emulators with the real rules.
//   npm run check:sync
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 5196;
const ROOT = path.join(__dirname, "..");
const FIREBASE = path.join(ROOT, "node_modules", "firebase");
const BASE = `http://localhost:${PORT}/Food-Tracker/v2/`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };

// Static files only, like GitHub Pages: /Food-Tracker/<path> -> repo/<path>
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
  await fetch("http://127.0.0.1:8085/emulator/v1/projects/demo-food-tracker/databases/(default)/documents", { method: "DELETE" });
  await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-food-tracker/accounts", { method: "DELETE" });

  const server = await startStatic();
  const browser = await chromium.launch();
  const errors = [];

  async function phone(who) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // Firebase from gstatic is served from node_modules (same files, no internet needed)
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)$/, (route) => {
      const name = route.request().url().split("/").pop();
      route.fulfill({ path: path.join(FIREBASE, name), contentType: "text/javascript" });
    });
    const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(`${who}: ${e.message}`));
    page.on("dialog", d => d.accept());
    await page.goto(`${BASE}?emu=1&as=${who}&today=2026-10-07`);
    return { ctx, page };
  }

  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const visible = (page, sel) => page.locator(sel).waitFor({ state: "visible", timeout: 15000 });
  const hidden = (page, sel) => page.locator(sel).waitFor({ state: "hidden", timeout: 15000 });
  const until = async (page, fn) => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 75) throw e; await page.waitForTimeout(200); }
    }
  };
  const fridgeCount = page => page.locator("#mains .pack").count();
  const showFridge = async page => {
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
  };
  async function addMain(page, name) {
    await page.click('[data-tab="add"]');
    await page.click('[data-kind="main"]');
    await page.fill("#name", name);
    await page.fill("#days", "2");
    await page.click("#addBtn");
    await until(page, async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
  }

  const A = await phone("alice");
  const B = await phone("bob");
  let code;

  await step("alice makes a household and an invite", async () => {
    await A.page.click("#signIn");
    await visible(A.page, "#makeHH");
    await A.page.click("#makeHH");
    await hidden(A.page, "#gate");
    await A.page.click("#settingsBtn");
    await A.page.click("#inviteBtn");
    await visible(A.page, "#inviteCode");
    code = (await A.page.locator("#inviteCode").innerText()).trim();
    await A.page.click("#settingsClose");
  });

  await step("bob joins", async () => {
    await B.page.click("#signIn");
    await visible(B.page, "#joinBtn");
    await B.page.fill("#joinCode", code);
    await B.page.click("#joinBtn");
    await hidden(B.page, "#gate");
    await showFridge(B.page);
    assert.equal(await fridgeCount(B.page), 0);
  });

  await step("alice adds Chicken: it shows on alice's fridge", async () => {
    await addMain(A.page, "Chicken");
    await showFridge(A.page);
    await until(A.page, async () => assert.equal(await fridgeCount(A.page), 1));
  });

  await step("bob sees the Chicken without reloading", async () => {
    await until(B.page, async () => assert.equal(await fridgeCount(B.page), 1));
    assert.match(await B.page.locator("#mains").innerText(), /Chicken/);
  });

  await step("still there after both reload", async () => {
    await A.page.reload();
    await B.page.reload();
    await showFridge(A.page);
    await showFridge(B.page);
    await until(A.page, async () => assert.equal(await fridgeCount(A.page), 1));
    await until(B.page, async () => assert.equal(await fridgeCount(B.page), 1));
  });

  await step("alice offline: adds Sausages, sees them at once", async () => {
    await A.ctx.setOffline(true);
    await addMain(A.page, "Sausages");
    await showFridge(A.page);
    await until(A.page, async () => assert.equal(await fridgeCount(A.page), 2));
    await B.page.waitForTimeout(1500);
    assert.equal(await fridgeCount(B.page), 1, "bob can't see it yet");
  });

  await step("alice back online: bob gets the Sausages", async () => {
    await A.ctx.setOffline(false);
    await until(B.page, async () => assert.equal(await fridgeCount(B.page), 2));
    assert.match(await B.page.locator("#mains").innerText(), /Sausages/);
  });

  await step("bob uses the Chicken up: it leaves alice's fridge too", async () => {
    await B.page.locator("#mains .pack", { hasText: "Chicken" }).click();
    await B.page.click("#actUsed");
    await until(B.page, async () => assert.equal(await fridgeCount(B.page), 1));
    await until(A.page, async () => assert.equal(await fridgeCount(A.page), 1));
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  console.log("ALL SYNC CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
