// V2 step 6 in Chrome (phone size): the app installs, opens offline, offers 📲 Install,
// and says "New version, tap to refresh" when a new version is published.
//   npm run check:pwa
// ?local=1&sw=1: memory-only app, but with the service worker on (test modes skip it otherwise).
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 5195;
const ROOT = path.join(__dirname, "..");
const URL_ = `http://localhost:${PORT}/Food-Tracker/v2/?local=1&sw=1&today=2026-10-07`;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
};

// Like GitHub Pages. When `published` is true, sw.js and version.js are served one version up,
// as if a new version had just been merged.
let published = false;
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
    const type = TYPES[path.extname(file)] || "application/octet-stream";
    if (published && (p === "/v2/sw.js" || p === "/v2/js/version.js")) {
      const text = fs.readFileSync(file, "utf8")
        .replace(/const VERSION = (\d+);/, (_, n) => `const VERSION = ${+n + 1};`)
        .replace(/n: (\d+),/, (_, n) => `n: ${+n + 1},`);
      res.writeHead(200, { "Content-Type": type });
      return res.end(text);
    }
    res.writeHead(200, { "Content-Type": type });
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
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 75) throw e; await page.waitForTimeout(200); }
    }
  };
  const version = async () => Number((await page.locator("#ver").innerText()).match(/^v(\d+)/)[1]);

  await page.goto(URL_);

  await step("manifest and icons load", async () => {
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const m = await (await fetch(new URL(href, page.url()))).json();
    assert.equal(m.display, "standalone");
    for (const i of m.icons) {
      const r = await fetch(new URL(i.src, new URL(href, page.url())));
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "image/png");
    }
  });

  let v1;
  await step("service worker takes charge of the page", async () => {
    await until(async () => assert.ok(await page.evaluate(async () =>
      !!(await navigator.serviceWorker.getRegistration()) && !!(await navigator.serviceWorker.ready).active)));
    await page.reload();
    await until(async () => assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller)));
    v1 = await version();
  });

  await step("opens with no internet", async () => {
    await ctx.setOffline(true);
    await page.reload();
    await until(async () => assert.match(await page.locator("#today").innerText(), /Wed 7 Oct/));
    await ctx.setOffline(false);
  });

  await step("📲 Install shows when Chrome offers it, and asks Chrome when tapped", async () => {
    assert.equal(await page.locator("#installBtn").isVisible(), false);
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt");
      e.prompt = () => { window.__prompted = true; return Promise.resolve(); };
      e.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(e);
    });
    await page.locator("#installBtn").waitFor({ state: "visible" });
    await page.click("#installBtn");
    assert.equal(await page.evaluate(() => window.__prompted), true);
    await page.locator("#installBtn").waitFor({ state: "hidden" });
  });

  await step("no 'new version' note while nothing changed", async () => {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForTimeout(1500);
    assert.equal(await page.locator("#newVersion").isVisible(), false);
  });

  await step("a new version is published: the app says so", async () => {
    published = true;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.locator("#newVersion").waitFor({ state: "visible", timeout: 15000 });
    assert.match(await page.locator("#newVersion").innerText(), /New version, tap to refresh/);
  });

  await step("tap it: the page reloads on the new version", async () => {
    await page.click("#newVersion");
    await until(async () => assert.equal(await version(), v1 + 1));
    assert.equal(await page.locator("#newVersion").isVisible(), false);
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  console.log("ALL PWA CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
