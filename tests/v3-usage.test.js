// Photo cost line in Settings (Darren 2026-10-14) — run with: npm test
// The Worker's GET /usage counts photos and Claude cost (USD, same as the Anthropic bill).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

for (const dir of ["v2", "v2-next"]) {
  const P = require(path.join(__dirname, "..", dir, "js", "photos.js"));
  const read = f => fs.readFileSync(path.join(__dirname, "..", dir, f), "utf8");

  test(`${dir}: usage lines in plain words`, () => {
    const data = {
      week: { used: 23, cap: 100 },
      month: { month: "2026-10", cost: 0.1234, calls: { "claude-haiku-5-5": 140, "claude-sonnet-5-5": 6 } },
    };
    assert.deepEqual(P.usageText(data), {
      month: "This month: $0.12 · Haiku 140 · Sonnet 6",
      week: "This week: 23 of 100 photos",
    });
    assert.deepEqual(P.usageText({ week: { used: 0, cap: 100 }, month: null }), {
      month: "This month: $0.00 · no photos yet",
      week: "This week: 0 of 100 photos",
    });
    assert.equal(P.usageText({ week: { used: 1, cap: 100 }, month: { cost: 0.0008, calls: { "claude-haiku-5-5": 1 } } }).month,
      "This month: under $0.01 · Haiku 1");
    assert.equal(P.usageText(null), null);
  });

  test(`${dir}: fetchUsage asks the Worker with the sign-in token, never throws`, async () => {
    const calls = [];
    const fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ week: { used: 2, cap: 100 } }) }; };
    const out = await P.fetchUsage({ fetch, getToken: async () => "tok", household: "h1" });
    assert.equal(calls[0].url, P.WORKER_URL + "/usage?household=h1");
    assert.equal(calls[0].init.headers.authorization, "Bearer tok");
    assert.deepEqual(out, { week: { used: 2, cap: 100 } });
    assert.equal(await P.fetchUsage({ fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }), getToken: async () => "t", household: "h" }), null);
    assert.equal(await P.fetchUsage({ fetch: async () => { throw new Error("offline"); }, getToken: async () => "t", household: "h" }), null);
  });

  test(`${dir}: Settings shows the photo cost lines`, () => {
    const html = read("index.html");
    assert.match(html, /id="usageMonth"/);
    assert.match(html, /id="usageWeek"/);
    assert.match(read("js/account.js"), /FT_PHOTOS\.fetchUsage\(/);
  });
}
