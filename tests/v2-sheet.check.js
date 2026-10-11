// V2 step 8: the printed fridge sheet (new layout) and 📷 scan, in Chrome at phone size.
// Local mode (?local=1): data in memory, seeded with a full fridge before the app starts.
// Run with: npm run check:v2
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// V2DIR=v2-next runs the same checks against the V2.5 demo
const APP_DIR = process.env.V2DIR || "v2";
const PORT = 5197;
const ROOT = path.join(__dirname, "..");
const PAGE_URL = `http://localhost:${PORT}/Food-Tracker/${APP_DIR}/?local=1&today=2026-10-07`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

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

  // A full fridge: 40 mains + 30 sides + 10 veg + 10 misc, none due soon, so both columns overflow.
  // Seeded into the memory DB when the app opens it.
  await page.addInitScript(() => {
    let db;
    Object.defineProperty(window, "DB", {
      configurable: true,
      get: () => db,
      set: v => {
        db = v;
        const open = v.open;
        v.open = async () => {
          await open.call(v);
          const add = (name, kind, i) => v.add({
            name, kind, date: "2026-11-" + String(1 + (i % 28)).padStart(2, "0"), dateType: "use_by",
            status: "in_fridge", added: "2026-10-05", left: null, frozen: null, partUsed: false,
          });
          const two = i => String(i).padStart(2, "0");
          for (let i = 1; i <= 40; i++) await add("Main " + two(i), "main", i);
          for (let i = 1; i <= 30; i++) await add("Side " + two(i), "side", i);
          for (let i = 1; i <= 10; i++) await add("Veg " + two(i), "veg", i);
          for (let i = 1; i <= 10; i++) await add("Misc " + two(i), "misc", i);
        };
      },
    });
  });

  await page.goto(PAGE_URL);
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  const sheet = page.locator("#printSheet");

  await step("print: fills the sheet and opens print", async () => {
    await until(async () => assert.ok((await page.evaluate(() => window.DB.all())).length === 90));
    await page.click("#printF");
    await until(async () => assert.equal(await page.evaluate(() => window.__printed), 1));
    assert.match(await sheet.locator(".ps-code").innerText(), /SHEET 0710-\d{4}/);
    assert.match(await sheet.locator(".ps-head").innerText(), /printed Wed 7 Oct/);
  });

  await step("print: no Meals or Added boxes any more", async () => {
    assert.equal(await sheet.locator(".ps-meals").count(), 0);
    assert.equal(await sheet.locator(".ps-added").count(), 0);
    assert.doesNotMatch(await sheet.locator(".ps-head").innerText(), /Week/);
  });

  await step("print: a strip of the next 7 days near the bottom", async () => {
    const days = await sheet.locator(".ps-days .day").allInnerTexts();
    assert.deepEqual(days.map(d => d.trim()), ["Thu 8", "Fri 9", "Sat 10", "Sun 11", "Mon 12", "Tue 13", "Wed 14"]);
  });

  await step("print view: more rows, and everything fits on the page", async () => {
    await page.emulateMedia({ media: "print" });
    assert.ok(await sheet.isVisible());
    const leftRows = await sheet.locator(".ps-top > div:first-child tr[data-id]").count();
    const rightRows = await sheet.locator(".ps-top > div:last-child tr[data-id]").count();
    assert.ok(leftRows >= 22, "left column rows: " + leftRows);
    assert.ok(rightRows >= 20, "right column rows: " + rightRows);
    const box = async sel => sheet.locator(sel).first().boundingBox();
    const strip = await box(".ps-days");
    const foot = await box(".ps-foot");
    const bl = await box(".ps-bl");
    for (const col of [".ps-top > div:first-child", ".ps-top > div:last-child"]) {
      const c = await box(col);
      assert.ok(c.y + c.height <= strip.y + 1, `${col} ends above the 7-day strip`);
    }
    assert.ok(strip.y + strip.height <= foot.y + 1, "strip above the footer");
    assert.ok(foot.y + foot.height <= bl.y + 1, "footer above the bottom corner marks");
    // the "+N more" lines are there because the fridge does not fit
    assert.match(await sheet.locator(".ps-top").innerText(), /\+\d+ more/);
    await page.emulateMedia({ media: "screen" });
  });

  let saved;
  await step("print: the sheet is saved with every row on the page", async () => {
    const sheets = await page.evaluate(() => window.DB.sheets.all());
    saved = sheets[sheets.length - 1];
    assert.match(saved.code, /^0710-\d{4}$/);
    assert.equal(saved.rows.length, await sheet.locator(".ps-top tr[data-id]").count());
    assert.equal(saved.rows[0].boxes.length, 4);
  });

  const [r1, r2, r3] = saved ? saved.rows : [];

  await step("on a phone after printing: row 2's food is used up", async () => {
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    await page.locator(".pack", { hasText: r2.name }).first().click();
    await page.click("#actUsed");
    await until(async () => {
      const p = (await page.evaluate(() => window.DB.all())).find(x => x.id === r2.id);
      assert.equal(p.status, "used");
    });
  });

  await step("📷 scan: changes found, row 2 shows 'already done'", async () => {
    await page.click("#scanBtn");
    assert.ok(await page.locator("#scanPanel").isVisible());
    await until(async () => assert.match(await text("#scanSheet"), new RegExp(saved.code)));
    await page.evaluate(([a, b, c]) => {
      window.FT_OMR.readSheet = () => ({ ok: true, marks: {
        [a]: { u: true, p: false, b: false, n: false },
        [b]: { u: false, p: false, b: true, n: false },
        [c]: { u: false, p: false, b: false, n: true } } });
    }, [r1.no, r2.no, r3.no]);
    await page.setInputFiles("#scanFile", path.join(ROOT, "docs", "mockup-scan.png"));
    await until(async () => assert.match(await text("#scanChanges"), /Changes found · 2/));
    const done = page.locator(`#scanChanges .chg[data-no="${r2.no}"]`);
    assert.match(await done.getAttribute("class"), /\bdone\b/);
    assert.match(await done.innerText(), new RegExp(r2.name));
    assert.match(await done.innerText(), /already done/);
  });

  await step("📷 apply: real changes made, the 'already done' one left alone", async () => {
    await page.click("#scanApply");
    await until(async () => {
      const packs = await page.evaluate(() => window.DB.all());
      assert.equal(packs.find(p => p.id === r1.id).status, "used");
      assert.equal(packs.find(p => p.id === r2.id).status, "used", "not changed to binned");
      assert.equal(packs.find(p => p.id === r3.id).status, "in_fridge");
      const shop = await page.evaluate(() => window.DB.shop.all());
      assert.ok(shop.some(i => i.name === r3.name && !i.got && !i.del), "N adds to the shopping list");
    });
    assert.equal(await page.locator("#scanPanel").isVisible(), false);
  });

  await step("📷 no sheet found in the photo says so", async () => {
    await page.click("#scanBtn");
    await page.evaluate(() => { window.FT_OMR.readSheet = () => ({ ok: false, reason: "corners" }); });
    await page.setInputFiles("#scanFile", path.join(ROOT, "docs", "mockup-scan.png"));
    await until(async () => assert.match(await text("#scanMsg"), /4 black corners/));
    await page.click("#scanCancel");
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  console.log("ALL V2 SHEET CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
