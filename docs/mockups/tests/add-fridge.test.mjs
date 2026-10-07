// UI tests for the "Add to fridge" mock-up. "Today" in the mock is Wed 7 Oct 2026.
// Run: node docs/mockups/tests/add-fridge.test.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const page_url = "file://" + path.resolve(here, "../fridge-mock.html");

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(2000);
await page.route(/^https?:/, r => r.abort()); // no web fonts in tests
const errors = [];
page.on("pageerror", e => errors.push(e.message));

async function fresh() {
  await page.goto(page_url, { waitUntil: "domcontentloaded" });
  await page.click("#tA");
  await page.click("#aF");
}
const text = sel => page.locator(sel).innerText();
const typeDate = async v => { await page.fill("#fDate", ""); await page.type("#fDate", v); };

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fresh(); await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message.split("\n")[0]); }
}

await test("Add to fridge is visible", async () => {
  assert.ok(await page.locator("#addFridge").isVisible());
  for (const id of ["#fName", "#micBtn", "#fDate", "#addBtn", "#packN", "#dtUse", "#dtBB"])
    assert.ok(await page.locator(id).count(), id + " missing");
});

await test("DDMM 1211 -> Thu 12 Nov 2026", async () => {
  await typeDate("1211");
  assert.match(await text("#dateOut"), /Thu 12 Nov 2026/);
});

await test("DDMM in the past is out of date, same year (0610)", async () => {
  await typeDate("0610");
  const t = await text("#dateOut");
  assert.match(t, /6 Oct 2026/);
  assert.match(t, /out of date/i);
});

await test("DDMM nearest date: 0201 -> 2 Jan 2027, not out of date", async () => {
  await typeDate("0201");
  const t = await text("#dateOut");
  assert.match(t, /2 Jan 2027/);
  assert.doesNotMatch(t, /out of date/i);
});

await test("Bad DDMM 3102 -> Not a date", async () => {
  await typeDate("3102");
  assert.match(await text("#dateOut"), /not a date/i);
});

await test("Quick-pick +3 shows the real date and sets it", async () => {
  const b = page.locator('#quick [data-plus="3"]');
  assert.match(await b.innerText(), /Sat 10 Oct/);
  await b.click();
  assert.match(await text("#dateOut"), /Sat 10 Oct/);
});

await test("Usual button fills name and kind (Sausages -> main)", async () => {
  await page.click('#usualTabs [data-u="main"]');
  await page.click('#usualChips button:has-text("Sausages")');
  assert.equal(await page.inputValue("#fName"), "Sausages");
  assert.match(await page.locator('#kindBtns [data-kind="main"]').getAttribute("class"), /\bon\b/);
});

await test("Usual veg (Carrots) -> side with no date", async () => {
  await page.click('#usualTabs [data-u="veg"]');
  await page.click('#usualChips button:has-text("Carrots")');
  assert.match(await page.locator('#kindBtns [data-kind="side"]').getAttribute("class"), /\bon\b/);
  assert.match(await text("#dateOut"), /no date/i);
});

await test("Add 2 packs of Sausages 1211 -> Mains count +2, shown in Just added", async () => {
  const before = Number(await text("#cM"));
  await page.fill("#fName", "Sausages");
  await page.click('#kindBtns [data-kind="main"]');
  await page.click("#packPlus");
  assert.equal((await text("#packN")).trim(), "2");
  await typeDate("1211");
  await page.click("#addBtn");
  assert.equal(Number(await text("#cM")), before + 2);
  assert.match(await text("#justAdded"), /2 × Sausages/);
});

await test("Main with no date is refused", async () => {
  const before = Number(await text("#cM"));
  await page.fill("#fName", "Chicken");
  await page.click('#kindBtns [data-kind="main"]');
  await page.click("#addBtn");
  assert.equal(Number(await text("#cM")), before);
  assert.match(await text("#addMsg"), /needs a date/i);
});

await test("Best before toggle is saved", async () => {
  await page.fill("#fName", "Cheese");
  await page.click('#kindBtns [data-kind="misc"]');
  await typeDate("2010");
  await page.click("#dtBB");
  await page.click("#addBtn");
  assert.match(await text("#justAdded"), /BB/);
});

await test("Undo removes the last add", async () => {
  const before = Number(await text("#cM"));
  await page.fill("#fName", "Bacon");
  await page.click('#kindBtns [data-kind="main"]');
  await typeDate("1510");
  await page.click("#addBtn");
  assert.equal(Number(await text("#cM")), before + 1);
  await page.click("#undoAdd");
  assert.equal(Number(await text("#cM")), before);
});

await test("Voice (mocked) fills name and date", async () => {
  await page.click("#micBtn");
  await page.waitForFunction(() => document.querySelector("#fName").value !== "", null, { timeout: 4000 });
  assert.match(await page.inputValue("#fName"), /chicken/i);
  assert.match(await text("#dateOut"), /14 Oct/);
});

await test("No page errors", async () => { assert.deepEqual(errors, []); });

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
