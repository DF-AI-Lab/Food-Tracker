// Stock check Edit box: (i) help, counter left, Wrong section? right, + adds straight away (Darren 2026-11-04).
// Run with: node tests/v4-stock-edit.check.js   (demo)   or   V4DIR=live node tests/v4-stock-edit.check.js
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "demo";
const PORT = 5217;
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
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => srv.listen(PORT, () => r(srv)));
}

(async () => {
  const server = await startStatic();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } }); // narrow, like a Fold cover screen
  const page = await ctx.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const until = async fn => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); } } };
  const addFood = async (kind, name, days) => {
    await page.click('[data-tab="add"]');
    await page.click('[data-sub="fridge"]');
    await page.click(`[data-kind="${kind}"]`);
    await page.fill("#name", name);
    await page.fill("#days", String(days));
    await page.click("#addBtn");
    await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
  };
  const box = page.locator("#stockList .stock-editbox");
  const rowOf = name => page.locator("#stockList .stock-row", { hasText: name });
  const openEdit = async (section, name) => {
    await page.click(`#stockPanel [data-stock="${section}"]`);
    await until(async () => assert.equal(await rowOf(name).count(), 1));
    await rowOf(name).locator(".stock-edit").click();
    await until(async () => assert.ok(await box.isVisible()));
  };

  try {
    await page.goto(url("2026-11-04", 10));
    await step("fridge has Sausages (main) and Ribs (veg by mistake)", async () => {
      await addFood("main", "Sausages", 2);
      await addFood("veg", "Ribs", 6);
      await page.click('[data-tab="fridge"]');
      await page.click("#stockBtn");
      await until(async () => assert.ok(await page.locator("#stockPanel").isVisible()));
    });

    await step("Edit box: counter shown even for 1 (starts at 0), no Delete note, (i) button", async () => {
      await openEdit("main", "Sausages");
      assert.equal((await box.locator(".stock-left").innerText()).trim(), "0");
      assert.equal(await box.locator(".stock-delnote").count(), 0);
      assert.ok(await box.locator(".stock-info").isVisible());
      assert.ok(await box.locator(".stock-move").isVisible());
      assert.equal(await box.locator(".stock-used").isDisabled(), false);
      // counter on the left, Wrong section? on the right, same line
      const c = await box.locator(".stock-step").boundingBox();
      const m = await box.locator(".stock-move").boundingBox();
      assert.ok(c.x < m.x, "counter left of Wrong section?");
      assert.ok(Math.abs((c.y + c.height / 2) - (m.y + m.height / 2)) < 12, "same line");
    });

    await step("(i) floats on top: the box does not grow, and it explains each button", async () => {
      const before = (await box.boundingBox()).height;
      await box.locator(".stock-info").click();
      const pop = page.locator(".stock-help");
      await until(async () => assert.ok(await pop.isVisible()));
      assert.match(await pop.innerText(), /Used/);
      assert.match(await pop.innerText(), /Thrown away/);
      assert.match(await pop.innerText(), /never there/);
      assert.match(await pop.innerText(), /Wrong section/);
      assert.equal((await box.boundingBox()).height, before);
      await box.locator(".stock-info").click();
      await until(async () => assert.equal(await pop.isVisible(), false));
    });

    await step("+ above what is there adds one straight away (Sausages becomes ×2), box stays open", async () => {
      await box.locator(".stock-plus").click(); // 0 -> 1 (back to all there)
      assert.equal((await box.locator(".stock-left").innerText()).trim(), "1");
      assert.equal(await box.locator(".stock-used").isDisabled(), true);
      await box.locator(".stock-plus").click(); // 1 -> 2: one more added
      await until(async () => assert.match(await rowOf("Sausages").innerText(), /×2/));
      assert.ok(await box.isVisible());
      assert.equal((await box.locator(".stock-left").innerText()).trim(), "2");
      assert.equal(await box.locator(".stock-used").isDisabled(), true);
      await box.locator(".stock-cancel").click();
      await until(async () => assert.equal(await box.count(), 0));
      assert.match(await rowOf("Sausages").innerText(), /×2/); // still saved after Cancel
    });

    await step("Wrong section? floats the 6 sections; Mains (where Ribs belong) moves both straight away", async () => {
      await openEdit("veg", "Ribs");
      const before = (await box.boundingBox()).height;
      await box.locator(".stock-move").click();
      const pick = page.locator(".stock-sections");
      await until(async () => assert.ok(await pick.isVisible()));
      assert.equal(await pick.locator("button").count(), 6);
      assert.equal((await box.boundingBox()).height, before);
      await pick.locator('[data-move="main"]').click();
      await until(async () => assert.equal(await rowOf("Ribs").count(), 0)); // gone from Veg
      await page.click('#stockPanel [data-stock="main"]');
      await until(async () => assert.equal(await rowOf("Ribs").count(), 1));
    });

    await step("Wrong section? → Freezer moves it to the Freezer section", async () => {
      await openEdit("main", "Ribs");
      await box.locator(".stock-move").click();
      await page.locator('.stock-sections [data-move="freezer"]').click();
      await page.click('#stockPanel [data-stock="freezer"]');
      await until(async () => assert.equal(await rowOf("Ribs").count(), 1));
    });

    await step("− then Used still works (Sausages ×2 → 1)", async () => {
      await openEdit("main", "Sausages");
      assert.equal((await box.locator(".stock-left").innerText()).trim(), "1");
      await box.locator(".stock-used").click();
      await until(async () => assert.doesNotMatch(await rowOf("Sausages").innerText(), /×2/));
    });

    await step("no sideways scroll and no page errors", async () => {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(wide, false);
      assert.deepEqual(errors, []);
    });
    console.log("ALL OK");
  } catch (e) {
    console.error(e); process.exitCode = 1;
  } finally {
    await browser.close(); server.close();
  }
})();
