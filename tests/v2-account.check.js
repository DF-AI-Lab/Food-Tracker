// Sign-in and household screens (V2 step 3), in Chrome at phone size, against the
// Firestore + Auth emulators with the real rules. Fake Google sign-in (?emu=1&as=<name>)
// only exists in emulator mode.
//   npm run check:account
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 5197;
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
  // Start from an empty emulator database
  await fetch("http://127.0.0.1:8085/emulator/v1/projects/demo-food-tracker/databases/(default)/documents", { method: "DELETE" });
  await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-food-tracker/accounts", { method: "DELETE" });

  const server = await startStatic();
  const browser = await chromium.launch();
  const errors = [];

  // One browser profile per person (like separate phones)
  async function phone(who, extra = "") {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // The app loads Firebase from gstatic: serve the same files from node_modules (no internet needed)
    await ctx.route(/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)$/, (route) => {
      const name = route.request().url().split("/").pop();
      route.fulfill({ path: path.join(FIREBASE, name), contentType: "text/javascript" });
    });
    const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(`${who}: ${e.message}`));
    page.on("dialog", d => d.accept());
    await page.goto(`${BASE}?emu=1&as=${who}&today=2026-10-07${extra}`);
    return page;
  }

  const step = async (name, fn) => { await fn(); console.log("ok -", name); };
  const visible = (page, sel) => page.locator(sel).waitFor({ state: "visible", timeout: 10000 });
  const hidden = (page, sel) => page.locator(sel).waitFor({ state: "hidden", timeout: 10000 });
  const until = async (page, fn) => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) { if (i >= 50) throw e; await page.waitForTimeout(200); }
    }
  };

  const alice = await phone("alice");
  let code;

  await step("signed out: shows the sign-in screen, not the app", async () => {
    await visible(alice, "#gate");
    await visible(alice, "#signIn");
  });

  await step("after sign-in with no household: offers make or join", async () => {
    await alice.click("#signIn");
    await visible(alice, "#makeHH");
    await visible(alice, "#joinBtn");
  });

  await step("make a household: the app opens", async () => {
    await alice.fill("#hhName", "Home");
    await alice.click("#makeHH");
    await hidden(alice, "#gate");
    assert.match(await alice.locator("#today").innerText(), /Wed 7 Oct/);
  });

  await step("stays signed in after a reload", async () => {
    await alice.reload();
    await until(alice, async () => assert.match(await alice.locator("#today").innerText(), /Wed 7 Oct/));
    await hidden(alice, "#gate");
  });

  await step("settings shows the household and me as the only member", async () => {
    await alice.click("#settingsBtn");
    await visible(alice, "#settings");
    assert.match(await alice.locator("#hhTitle").innerText(), /Home/);
    await until(alice, async () => assert.equal(await alice.locator("#members li").count(), 1));
    assert.match(await alice.locator("#members li").first().innerText(), /Alice/);
    assert.equal(await alice.locator("#members li button").count(), 0, "no ❌ on yourself");
  });

  await step("invite: shows a code, a link and a QR", async () => {
    await alice.click("#inviteBtn");
    await visible(alice, "#inviteCode");
    code = (await alice.locator("#inviteCode").innerText()).trim();
    assert.match(code, /^[A-Z2-9]{8}$/);
    assert.match(await alice.locator("#inviteLink").innerText(), new RegExp(`\\?join=${code}`));
    assert.ok(await alice.locator("#inviteQr svg, #inviteQr img").count() >= 1, "QR shown");
  });

  const bob = await phone("bob", "");
  await step("second phone joins with the code from the link", async () => {
    await bob.goto(`${BASE}?emu=1&as=bob&today=2026-10-07&join=${code}`);
    await bob.click("#signIn");
    await visible(bob, "#joinBtn");
    assert.equal(await bob.inputValue("#joinCode"), code, "code filled in from the link");
    await bob.click("#joinBtn");
    await hidden(bob, "#gate");
    assert.ok(!bob.url().includes("join="), "code removed from the address bar");
  });

  const carol = await phone("carol");
  await step("wrong code gives a clear message", async () => {
    await carol.click("#signIn");
    await visible(carol, "#joinBtn");
    await carol.fill("#joinCode", "NOPE2345");
    await carol.click("#joinBtn");
    await until(carol, async () => assert.match(await carol.locator("#gateMsg").innerText(), /wrong or has run out/i));
    await visible(carol, "#gate");
  });

  await step("members list now shows both, with ❌ on the other person", async () => {
    await alice.click("#settingsClose");
    await alice.click("#settingsBtn");
    await until(alice, async () => assert.equal(await alice.locator("#members li").count(), 2));
    const bobRow = alice.locator("#members li", { hasText: "Bob" });
    assert.equal(await bobRow.locator("button").count(), 1);
  });

  await step("❌ removes a member", async () => {
    await alice.locator("#members li", { hasText: "Bob" }).locator("button").click();
    await until(alice, async () => assert.equal(await alice.locator("#members li").count(), 1));
  });

  await step("removed phone is back at make-or-join after a reload", async () => {
    await bob.reload();
    await visible(bob, "#gate");
    await visible(bob, "#makeHH");
  });

  await step("sign out goes back to the sign-in screen", async () => {
    await alice.click("#signOut");
    await visible(alice, "#gate");
    await visible(alice, "#signIn");
  });

  await step("no page errors", async () => assert.deepEqual(errors, []));

  await browser.close();
  server.close();
  console.log("ALL ACCOUNT CHECKS PASSED");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
