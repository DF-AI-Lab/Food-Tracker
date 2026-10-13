// Top bar fits every phone width with all 4 buttons (bell, camera, print, settings) — run: node tests/v3-topbar.check.js
// V2DIR=v2-next (default) or V2DIR=v2. Darren 2026-10-13: "must still fit on all mobiles".
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const APP_DIR = process.env.V2DIR || "v2-next";
const PORT = 5207;
const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/Food-Tracker/, "");
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const browser = await chromium.launch();
  for (const width of [320, 344, 360, 375, 390, 412]) {
    const page = await browser.newPage({ viewport: { width, height: 700 } });
    await page.goto(`http://localhost:${PORT}/Food-Tracker/${APP_DIR}/?local=1&today=2026-10-13`);
    await page.waitForSelector("#top");
    // Local mode has no account, so Settings is hidden; on a signed-in phone it shows: measure all four
    await page.evaluate(() => { document.getElementById("settingsBtn").hidden = false; document.getElementById("bellBtn").hidden = false; });
    const r = await page.evaluate(() => {
      const ids = ["homeBtn", "bellBtn", "scanBtn", "printF", "settingsBtn"];
      const box = id => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, vis: !e.hidden && b.width > 0 }; };
      const brand = document.querySelector(".brand");
      const bell = document.getElementById("bellBtn").getBoundingClientRect();
      const words = brand ? (() => { const rg = document.createRange(); rg.selectNodeContents(brand); return rg.getBoundingClientRect(); })() : null;
      return { page: document.documentElement.scrollWidth, vw: innerWidth, boxes: Object.fromEntries(ids.map(i => [i, box(i)])),
        brandRight: words ? words.right : null, buttonsLeft: document.querySelector(".pal").getBoundingClientRect().left };
    });
    assert.ok(r.page <= r.vw, `${width}px: page scrolls sideways (${r.page})`);
    for (const id of ["homeBtn", "bellBtn", "scanBtn", "printF", "settingsBtn"]) {
      const b = r.boxes[id];
      if (APP_DIR === "v2" && id === "homeBtn") continue;
      assert.ok(b && b.vis, `${width}px: ${id} showing`);
      assert.ok(b.l >= 0 && b.r <= r.vw, `${width}px: ${id} inside the screen (${Math.round(b.l)}-${Math.round(b.r)})`);
    }
    if (r.boxes.homeBtn) assert.ok(r.boxes.homeBtn.r <= r.boxes.bellBtn.l, `${width}px: home and buttons don't overlap`);
    if (r.brandRight !== null) assert.ok(r.brandRight <= r.buttonsLeft, `${width}px: "Food Tracker" runs under the buttons (${Math.round(r.brandRight)} > ${Math.round(r.buttonsLeft)})`);
    console.log(`ok - ${width}px fits`);
    await page.close();
  }
  await browser.close();
  srv.close();
  console.log("ALL TOP BAR CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
