// V2 step 9: "back up now?" reminder, backup file and restore, in Chrome at phone size.
// Local mode (?local=1): data in memory. Run with: npm run check:v2
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// V2DIR=v2-next runs the same checks against the V2.5 demo
const APP_DIR = process.env.V2DIR || "v2";
const PORT = 5195;
const ROOT = path.join(__dirname, "..");
const PAGE_URL = `http://localhost:${PORT}/Food-Tracker/${APP_DIR}/?local=1&today=2026-10-07`;
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // A desktop browser: no share menu, so the backup downloads
  await page.addInitScript(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; });
  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const until = async fn => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 30) throw e; await page.waitForTimeout(100); }
    }
  };
  const ask = page.locator("#backupAsk");
  async function addMain(name) {
    await page.click('[data-tab="add"]');
    await page.click('[data-kind="main"]');
    await page.fill("#name", name);
    await page.fill("#days", "4");
    await page.click("#addBtn");
    await until(async () => assert.match(await page.locator("#addMsg").innerText(), new RegExp(name)));
  }
  const packsNow = () => page.evaluate(() => window.DB.all());

  await page.goto(PAGE_URL);

  await step("4 changes: no reminder yet", async () => {
    for (const n of ["Beef", "Pork", "Lamb", "Ham"]) await addMain(n);
    await page.waitForTimeout(300);
    assert.equal(await ask.isVisible(), false);
  });

  await step("5th change: 'Back up now?' asks", async () => {
    await addMain("Duck");
    await until(async () => assert.ok(await ask.isVisible()));
    assert.match(await ask.innerText(), /5 changes/);
    assert.match(await ask.innerText(), /Back up now\?/);
  });

  await step("No: hides, and asks again after 5 more changes", async () => {
    await page.click("#backupNo");
    assert.equal(await ask.isVisible(), false);
    for (const n of ["Cod", "Hake", "Veal", "Spam"]) await addMain(n);
    await page.waitForTimeout(300);
    assert.equal(await ask.isVisible(), false, "only 4 more");
    await addMain("Tuna");
    await until(async () => assert.ok(await ask.isVisible()));
    assert.match(await ask.innerText(), /10 changes/);
  });

  let file;
  await step("Yes: the backup file downloads, with all the food in it", async () => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#backupYes")]);
    assert.equal(dl.suggestedFilename(), "food-backup-2026-10-07.json");
    file = path.join(__dirname, "..", "node_modules", ".tmp-backup-check.json");
    await dl.saveAs(file);
    const back = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(back.app, "food-tracker-v2");
    assert.equal(back.packs.length, 10);
    assert.ok(Array.isArray(back.shop) && Array.isArray(back.meals));
    await until(async () => assert.equal(await ask.isVisible(), false));
  });

  await step("after a backup the count starts again", async () => {
    await addMain("Eel");
    await page.waitForTimeout(300);
    assert.equal(await ask.isVisible(), false);
  });

  await step("restore: a file that isn't a backup is refused", async () => {
    let msg = "";
    page.once("dialog", d => { msg = d.message(); d.accept(); });
    await page.setInputFiles("#restoreFile", { name: "notes.json", mimeType: "application/json", buffer: Buffer.from("hello") });
    await until(async () => assert.match(msg, /isn't a Food Tracker backup file/));
    assert.equal((await packsNow()).length, 11, "nothing changed");
  });

  await step("restore: cancel the 'are you sure?' changes nothing", async () => {
    page.once("dialog", d => d.dismiss());
    await page.setInputFiles("#restoreFile", file);
    await page.waitForTimeout(500);
    assert.equal((await packsNow()).length, 11);
  });

  await step("restore: puts everything back as it was in the backup", async () => {
    // change things after the backup: use up Beef (Eel was added after it)
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    await page.locator("#mains .pack", { hasText: "Beef" }).first().click();
    await page.click("#actUsed");
    let msg = "";
    page.once("dialog", d => { msg = d.message(); d.accept(); });
    await page.setInputFiles("#restoreFile", file);
    await until(async () => {
      const packs = await packsNow();
      assert.equal(packs.length, 10);
      assert.ok(!packs.some(p => p.name === "Eel"), "added after the backup: gone");
      assert.equal(packs.find(p => p.name === "Beef").status, "in_fridge", "back in the fridge");
    });
    assert.match(msg, /Replace everything/i);
    await until(async () => assert.match(await page.locator("#mains").innerText(), /Beef/));
    assert.doesNotMatch(await page.locator("#mains").innerText(), /Eel/);
    assert.equal(await ask.isVisible(), false, "a restore counts as backed up");
  });

  await step("phone: Share gets a .txt file (Android won't share .json)", async () => {
    await page.evaluate(() => {
      window.__shared = null;
      Navigator.prototype.canShare = function (d) { return !!(d && d.files && d.files.every(f => f.type === "text/plain")); };
      Navigator.prototype.share = async function (d) { window.__shared = { name: d.files[0].name, type: d.files[0].type, text: await d.files[0].text(), keys: Object.keys(d) }; };
    });
    await page.evaluate(() => document.getElementById("backupBtn").click()); // Settings is hidden in local mode
    await until(async () => assert.ok(await page.evaluate(() => window.__shared)));
    const shared = await page.evaluate(() => window.__shared);
    assert.equal(shared.name, "food-backup-2026-10-07.txt");
    assert.equal(shared.type, "text/plain");
    assert.equal(JSON.parse(shared.text).app, "food-tracker-v2");
    // only the file: a title or text makes Drive save a Google Doc called that, not the file
    assert.deepEqual(shared.keys, ["files"]);
  });

  await step("phone: if Share fails, the file downloads instead (no error box)", async () => {
    let dialog = null;
    const onDialog = d => { dialog = d.message(); d.accept(); };
    page.on("dialog", onDialog);
    await page.evaluate(() => {
      Navigator.prototype.canShare = () => true;
      Navigator.prototype.share = async () => { throw new DOMException("Permission denied", "NotAllowedError"); };
    });
    const [dl] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => document.getElementById("backupBtn").click())]);
    assert.equal(dl.suggestedFilename(), "food-backup-2026-10-07.json");
    await page.waitForTimeout(300);
    page.off("dialog", onDialog);
    assert.equal(dialog, null);
  });

  await step("restore takes the .txt backup too", async () => {
    assert.match(await page.locator("#restoreFile").getAttribute("accept"), /\.txt/);
  });

  await step("go live: a V1 food.db, turned into a backup, restores into V2", async () => {
    const os = require("node:os");
    const { seedData } = require("../server/seed.js");
    const { convertDb } = require("../tools/v1-to-backup.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ft-v1-"));
    seedData(dir, "2026-10-07");
    const backup = convertDb(path.join(dir, "food.db"), "2026-10-07T19:00:00.000Z");
    const v1File = path.join(dir, "food-backup-from-v1.json");
    fs.writeFileSync(v1File, JSON.stringify(backup));
    page.once("dialog", d => d.accept());
    await page.setInputFiles("#restoreFile", v1File);
    await until(async () => assert.equal((await packsNow()).length, backup.packs.length));
    const main = backup.packs.find(p => p.status === "in_fridge" && p.kind === "main");
    await page.click('[data-tab="fridge"]');
    await page.click('[data-view="fridge"]');
    await until(async () => assert.match(await page.locator("#mains").innerText(), new RegExp(main.name)));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  fs.rmSync(file, { force: true });
  await browser.close();
  server.close();
  console.log("ALL V2 BACKUP CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
