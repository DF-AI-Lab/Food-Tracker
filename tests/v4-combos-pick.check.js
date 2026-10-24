// Combos v3: + Add, tick 1 food or more (a dish: name + note), Next, tick what goes with it (notes allowed), Save (Darren 2026-10-24).
// Run with: node tests/v4-combos-pick.check.js  (demo)   (Chrome, phone size, local data, ?today= and ?hour= faked)
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
  const tab = key => page.locator(`#addedWrap [data-added="${key}"]`);
  const count = async key => (await tab(key).locator("b").innerText()).trim();
  const rows = () => page.locator("#addedToday .added-row");

  const pick = page.locator("#comboPick");
  const chip = name => pick.locator(".cp-chip", { hasText: new RegExp("^" + name + "$") });
  const kindTab = k => pick.locator(`[data-cpkind="${k}"]`);
  const group = name => page.locator("#combos .combo-list .combo-group", { has: page.locator(".combo-food", { hasText: new RegExp("^" + name + "$") }) });
  const isOn = loc => loc.evaluate(el => el.classList.contains("on"));

  await page.goto(url("2026-10-24", 10));
  await page.click('[data-tab="meals"]');

  await step("+ Add opens step 1 on Main: 'What is it made of?', Next locked", async () => {
    await until(async () => assert.ok(await page.locator("#combos").isVisible()));
    assert.ok(await pick.isHidden());
    await page.click("#comboAdd");
    await until(async () => assert.ok(await pick.isVisible()));
    assert.match(await pick.locator(".cp-title").innerText(), /What is it made of/);
    assert.equal(await pick.locator(".cp-tabs [data-cpkind]").count(), 4);
    assert.ok(await isOn(kindTab("main")));
    assert.ok(await page.locator("#cpNext").isDisabled());
    assert.ok(await page.locator("#cpName").isHidden());
  });

  await step("make a dish: Cauliflower (Veg) + Cheese sauce (Side) named Cauli cheese, Next, Cancel", async () => {
    await kindTab("veg").click();
    await chip("Cauliflower").click();
    assert.ok(await page.locator("#cpNext").isEnabled(), "1 food: Next works");
    await kindTab("side").click();
    await chip("Cauliflower cheese").count(); // just the tab switch
    await page.fill("#cpType", "Cheese sauce");
    await page.click("#cpTypeAdd");
    await until(async () => assert.ok(await page.locator("#cpName").isVisible()));
    assert.ok(await page.locator("#cpNext").isDisabled(), "2 foods: needs a name");
    await page.fill("#cpName", "Cauli cheese");
    await until(async () => assert.ok(await page.locator("#cpNext").isEnabled()));
    await page.click("#cpNext");
    await until(async () => assert.match(await pick.locator(".cp-title").innerText(), /Cauli cheese goes with/));
    await page.click("#cpCancel");
    await until(async () => assert.ok(await pick.isHidden()));
    await until(async () => assert.equal(await group("Cauli cheese").count(), 1));
    assert.match(await group("Cauli cheese").locator(".combo-made").innerText(), /Cauliflower \+ Cheese sauce/);
  });

  await step("make Pigs in blankets: Sausages + Bacon, note 'wrapped in bacon'", async () => {
    await page.click("#comboAdd");
    await chip("Sausages").click();
    await chip("Bacon").click();
    await page.fill("#cpName", "Pigs in blankets");
    await page.fill("#cpNote", "wrapped in bacon");
    await page.click("#cpNext");
    await until(async () => assert.match(await pick.locator(".cp-title").innerText(), /Pigs in blankets goes with/));
    assert.equal(await pick.locator(".cp-tabs [data-cpkind]").count(), 5, "Combos tab added");
    assert.ok(await isOn(kindTab("side")));
  });

  await step("goes with: Potatoes (veg) with note 'chips, mash', Peas, and the Cauli cheese dish: Save 4 pairs", async () => {
    await kindTab("veg").click();
    await chip("Potatoes").click();
    await chip("Peas").click();
    const note = pick.locator(".cp-tick", { hasText: "Potatoes" }).locator(".cp-note");
    await note.fill("chips, mash");
    await kindTab("dish").click();
    assert.equal(await chip("Pigs in blankets").count(), 0, "not itself");
    await chip("Cauli cheese").click();
    await until(async () => assert.match(await page.locator("#cpSave").innerText(), /Save 4 pairs/));
    await page.click("#cpSave");
    await until(async () => assert.ok(await pick.isHidden()));
  });

  await step("list: Pigs in blankets card: made of, note, 4 goes-with chips incl. Potatoes (chips)", async () => {
    const g = group("Pigs in blankets");
    await until(async () => assert.equal(await g.count(), 1));
    assert.match(await g.locator(".combo-made").innerText(), /Sausages \+ Bacon · wrapped in bacon/);
    assert.equal(await g.locator(".combo-chip").count(), 4);
    const t = await g.innerText();
    assert.match(t, /Potatoes \(chips\)/);
    assert.match(t, /Potatoes \(mash\)/);
    assert.match(t, /Cauli cheese/);
  });

  await step("tap the card name: opens goes-with for it; Peas locked; Cancel", async () => {
    await group("Pigs in blankets").locator(".combo-food").click();
    await until(async () => assert.match(await pick.locator(".cp-title").innerText(), /Pigs in blankets goes with/));
    await kindTab("veg").click();
    assert.ok(await chip("Peas").isDisabled());
    await page.click("#cpCancel");
  });

  await step("x on Peas hides that pair", async () => {
    const g = group("Pigs in blankets");
    await g.locator(".combo-chip", { hasText: "Peas" }).locator(".combo-x").click();
    await until(async () => assert.equal(await g.locator(".combo-chip").count(), 3));
    await until(async () => assert.equal(await page.locator("#combosHidden .combo-row", { hasText: "Peas" }).count(), 1));
  });

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("all ok");
})().catch(e => { console.error(e); process.exit(1); });
