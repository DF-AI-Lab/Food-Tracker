// Add a food in 3 steps on a phone (Darren 2026-10-16, mock docs/mockups/add-steps-mock.html): live and V4 demo.
// Run with: V4DIR=v2 node tests/add-steps.check.js  (and V4DIR=demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const APP_DIR = process.env.V4DIR || "v2";
const PORT = 5213;
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
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await phone.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); }
    }
  };
  const shown = sel => page.locator(sel).isVisible();
  const onStep = async n => assert.equal(await page.locator("#addSteps").getAttribute("data-step"), String(n));

  await page.goto(url("2026-10-16", 10));
  await page.click('[data-tab="add"]');
  await page.click('[data-sub="fridge"]');

  const midY = async sel => { const b = await page.locator(sel).boundingBox(); return b.y + b.height / 2; };

  await step("phone, step 1 (Food): name + what it is; date and packs hidden; Next waits for a name", async () => {
    await until(async () => assert.ok(await shown("#addSteps")));
    assert.ok(await shown("#subTabs"), "Quick fill / One item still reachable before starting");
    assert.equal(await shown("#top"), false, "header hidden on the steps");
    assert.equal(await page.locator(".st-1 .lbl").first().isVisible(), false, "no 'What is it?' label");
    await onStep(1);
    assert.ok(await shown("#name"));
    assert.ok(await shown('[data-kind="main"]'));
    assert.equal(await shown("#ddmm"), false);
    assert.equal(await shown("#count"), false);
    assert.equal(await shown("#addBar"), false);
    assert.ok(await page.locator("#stepNext").isDisabled());
  });

  await step("while typing, the page header is hidden so the steps sit at the top", async () => {
    await page.locator("#name").tap();
    await page.locator("#name").fill("Chicken thighs");
    await until(async () => assert.equal(await shown("#top"), false));
    const box = await page.locator("#addSteps").boundingBox();
    assert.ok(box.y < 200, `steps near the top (${box.y}px)`);
  });

  await step("typing: quick-pick chips hide, page at the very top, step bar pinned", async () => {
    // a quick-pick chip, as if foods had been added before
    await page.evaluate(() => { const b = document.createElement("button"); b.className = "chip"; b.textContent = "Bacon"; document.getElementById("usuals").appendChild(b); });
    await page.locator("#name").blur();
    await page.locator("#name").tap();
    await until(async () => assert.equal(await page.locator("#usuals").isVisible(), false));
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.ok((await page.locator("#addSteps").boundingBox()).y < 60);
  });

  await step("Next sits at the end of the name row (above the keyboard)", async () => {
    assert.ok(Math.abs(await midY("#stepNext") - await midY("#name")) < 8, "same row as the name");
    assert.ok((await page.locator("#stepNext").boundingBox()).y < 300, "near the top");
  });

  await step("the keyboard's Enter/Next key moves on (step 1 -> 2)", async () => {
    await page.locator('[data-kind="side"]').tap();
    await page.locator("#name").press("Enter");
    await until(async () => onStep(2));
    assert.ok(await shown("#ddmm"));
    assert.ok(await shown("#days"));
    assert.equal(await shown("#name"), false);
    assert.match(await page.locator("#addSteps").innerText(), /Chicken thighs/);
    assert.equal(await page.locator(".st-2 .lbl").first().isVisible(), false, "no 'Date' label");
    assert.ok(Math.abs(await midY("#stepNext") - await midY("#ddmm")) < 8, "Next on the date row");
    assert.ok(Math.abs(await midY("label.noDate") - await midY('[data-dt="use_by"]')) < 8, "No date next to Use by");
  });

  await step("Next -> step 3 (Add): packs, freezer, and the Add bar", async () => {
    await page.locator("#ddmm").fill("2010");
    await page.locator("#stepNext").tap();
    await until(async () => onStep(3));
    assert.ok(await shown("#count"));
    assert.ok(await shown("#addBtn"));
    assert.equal(await shown("#ddmm"), false);
    assert.match(await page.locator("#abSum").innerText(), /20 Oct/);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.waitForTimeout(300);
    assert.equal(await shown("#top"), false, "header still hidden on step 3 (keyboard closed)");
    assert.equal(await shown(".titlerow"), false);
    assert.ok((await page.locator("#addSteps").boundingBox()).y < 80, "steps fixed at the top");
  });

  await step("Back goes one step back, and forward again", async () => {
    await page.locator("#stepBack").tap();
    await until(async () => onStep(2));
    assert.equal(await page.locator("#ddmm").inputValue(), "2010", "keeps what was typed");
    await page.locator("#stepNext").tap();
    await until(async () => onStep(3));
  });

  await step("Add: the food goes in, and it is back to step 1 with an empty name", async () => {
    await page.locator("#addBtn").tap();
    await until(async () => assert.match(await page.locator("#addMsg").innerText(), /added/i));
    await until(async () => onStep(1));
    assert.equal(await page.locator("#name").inputValue(), "");
    assert.ok(await shown("#name"));
  });

  await step("Cancel (✕ in the step bar) clears it and goes back to step 1, adding nothing", async () => {
    await page.locator("#name").fill("Cancel me");
    await page.locator("#stepNext").tap();
    await until(async () => onStep(2));
    await page.locator("#stepCancel").tap();
    await until(async () => onStep(1));
    assert.equal(await page.locator("#name").inputValue(), "");
    assert.doesNotMatch(await page.locator("#addMsg").innerText(), /Cancel me/);
  });

  await step("✕ cancels from step 3 too, and Quick fill / One item come back", async () => {
    await page.locator("#name").fill("Pie");
    await page.locator("#stepNext").tap();
    await page.locator("#stepNext").tap();
    await until(async () => onStep(3));
    await page.locator("#stepCancel").tap();
    await until(async () => onStep(1));
    assert.equal(await page.locator("#name").inputValue(), "");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await until(async () => assert.ok(await shown("#subTabs")));
  });

  await step("320px: no sideways scroll", async () => {
    await page.setViewportSize({ width: 320, height: 700 });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, `no sideways scroll (${over}px)`);
  });

  await step("computer (no touch): the form looks as before, no steps", async () => {
    const desk = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await desk.goto(url("2026-10-16", 10));
    await desk.click('[data-tab="add"]');
    await desk.click('[data-sub="fridge"]');
    assert.equal(await desk.locator("#addSteps").isVisible(), false);
    assert.ok(await desk.locator("#ddmm").isVisible());
    assert.ok(await desk.locator("#name").isVisible());
  });

  await step("no page errors", async () => {
    assert.deepEqual(errors, []);
  });

  console.log("ALL ADD STEPS CHECKS PASSED");
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
