// Tests for tools/photo-test/run-api.js (real Claude API photo test, run on the PC) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { thinkingFor, needsRetry, buildRequest, scanOne, runAll, costSummary, listPhotos } = require("../tools/photo-test/run-api.js");

// Fake Anthropic client: answers from a list per model, records every request
function fakeClient(answers) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (req) => {
        calls.push(req);
        const text = answers[req.model].shift();
        if (text instanceof Error) throw text;
        return { content: [{ type: "text", text }], usage: { input_tokens: 1600, output_tokens: 80 } };
      },
    },
  };
}

test("thinking is turned off the way each model accepts", () => {
  assert.deepEqual(thinkingFor("claude-haiku-5-5"), { type: "disabled" });
  assert.deepEqual(thinkingFor("claude-sonnet-5-5"), { type: "between_tools" });
});

test("needsRetry only for a missing date on a non-veg item", () => {
  assert.equal(needsRetry({ date: null, needsCheck: true }), true);
  assert.equal(needsRetry({ error: "Couldn't read reply", date: null, needsCheck: true }), true);
  assert.equal(needsRetry({ date: "2026-10-14", needsCheck: false }), false);
  assert.equal(needsRetry({ kind: "veg", date: null, noDate: true, needsCheck: false }), false);
});

test("buildRequest sends one jpeg photo then the prompt", () => {
  const req = buildRequest({ model: "claude-haiku-5-5", base64: "AAAA", prompt: "Read it" });
  assert.equal(req.model, "claude-haiku-5-5");
  assert.ok(req.max_tokens >= 512);
  assert.deepEqual(req.thinking, { type: "disabled" });
  const [img, txt] = req.messages[0].content;
  assert.equal(img.type, "image");
  assert.deepEqual(img.source, { type: "base64", media_type: "image/jpeg", data: "AAAA" });
  assert.deepEqual(txt, { type: "text", text: "Read it" });
});

test("scanOne keeps a good Haiku answer and makes one call", async () => {
  const client = fakeClient({ "claude-haiku-5-5": ['{"name":"Milk","date":"2026-10-14"}'] });
  const r = await scanOne({ file: "a.jpg", base64: "AAAA" }, { client, prompt: "p" });
  assert.equal(r.file, "a.jpg");
  assert.equal(r.date, "2026-10-14");
  assert.equal(r.model, "claude-haiku-5-5");
  assert.equal(r.calls.length, 1);
  assert.equal(client.calls.length, 1);
});

test("scanOne retries a blank date on Sonnet", async () => {
  const client = fakeClient({
    "claude-haiku-5-5": ['{"name":"Chicken"}'],
    "claude-sonnet-5-5": ['{"name":"Chicken","date":"2026-10-10"}'],
  });
  const r = await scanOne({ file: "b.jpg", base64: "AAAA" }, { client, prompt: "p" });
  assert.equal(r.date, "2026-10-10");
  assert.equal(r.model, "claude-sonnet-5-5");
  assert.equal(r.retried, true);
  assert.deepEqual(r.calls.map(c => c.model), ["claude-haiku-5-5", "claude-sonnet-5-5"]);
});

test("scanOne does not retry veg", async () => {
  const client = fakeClient({ "claude-haiku-5-5": ['{"name":"Carrots","kind":"veg"}'] });
  const r = await scanOne({ file: "c.jpg", base64: "AAAA" }, { client, prompt: "p" });
  assert.equal(r.kind, "veg");
  assert.equal(client.calls.length, 1);
});

test("scanOne can skip the Sonnet retry", async () => {
  const client = fakeClient({ "claude-haiku-5-5": ['{"name":"Chicken"}'] });
  const r = await scanOne({ file: "d.jpg", base64: "AAAA" }, { client, prompt: "p", retry: false });
  assert.equal(r.date, null);
  assert.equal(client.calls.length, 1);
});

test("scanOne turns an API error into a needs-check result", async () => {
  const client = fakeClient({ "claude-haiku-5-5": [new Error("API error 500")], "claude-sonnet-5-5": [new Error("API error 500")] });
  const r = await scanOne({ file: "e.jpg", base64: "AAAA" }, { client, prompt: "p" });
  assert.equal(r.file, "e.jpg");
  assert.ok(r.error);
  assert.equal(r.needsCheck, true);
});

test("runAll keys every answer by its own photo and limits calls at once", async () => {
  let live = 0, peak = 0;
  const scan = async (p) => {
    live++; peak = Math.max(peak, live);
    await new Promise(r => setTimeout(r, 5));
    live--;
    return { file: p.file, date: p.file === "x3.jpg" ? "2026-10-03" : null };
  };
  const photos = Array.from({ length: 12 }, (_, i) => ({ file: `x${i}.jpg` }));
  const out = await runAll(photos, scan, 5);
  assert.equal(Object.keys(out).length, 12);
  assert.equal(out["x3.jpg"].date, "2026-10-03");
  assert.ok(peak <= 5, `peak ${peak}`);
});

test("costSummary adds up calls and dollars per model", () => {
  const results = {
    "a.jpg": { calls: [{ model: "claude-haiku-5-5", input_tokens: 1000000, output_tokens: 0 }] },
    "b.jpg": { calls: [
      { model: "claude-haiku-5-5", input_tokens: 0, output_tokens: 1000000 },
      { model: "claude-sonnet-5-5", input_tokens: 1000000, output_tokens: 0 },
    ] },
  };
  const s = costSummary(results);
  assert.equal(s["claude-haiku-5-5"].calls, 2);
  assert.equal(s["claude-haiku-5-5"].cost, 0.6);
  assert.equal(s["claude-sonnet-5-5"].calls, 1);
  assert.equal(s["claude-sonnet-5-5"].cost, 2);
  assert.equal(s.total, 2.6);
});

test("listPhotos finds only photos, sorted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pt-"));
  for (const f of ["b.JPG", "a.jpeg", "c.png", "notes.txt", "d.webp"]) fs.writeFileSync(path.join(dir, f), "x");
  assert.deepEqual(listPhotos(dir).map(p => path.basename(p)), ["a.jpeg", "b.JPG", "c.png", "d.webp"]);
});

// ---- v2: past dates are re-checked, thinking can be on ----

test("needsRetry re-checks a date that is already past", () => {
  assert.equal(needsRetry({ date: "2026-10-01", needsCheck: false }, "2026-10-08"), true);
  assert.equal(needsRetry({ date: "2026-10-10", needsCheck: false }, "2026-10-08"), false);
  assert.equal(needsRetry({ date: "2026-10-08", needsCheck: false }, "2026-10-08"), false);
});

test("thinking on leaves the thinking setting out (model default)", () => {
  assert.equal(buildRequest({ model: "claude-haiku-5-5", base64: "A", prompt: "p", thinking: "on" }).thinking, undefined);
  assert.deepEqual(buildRequest({ model: "claude-haiku-5-5", base64: "A", prompt: "p", thinking: "off" }).thinking, { type: "disabled" });
});

test("scanOne sends a past date to Sonnet and keeps Sonnet's date", async () => {
  const client = fakeClient({
    "claude-haiku-5-5": ['{"name":"Chicken","date":"2026-10-01"}'],
    "claude-sonnet-5-5": ['{"name":"Chicken","date":"2026-10-10"}'],
  });
  const r = await scanOne({ file: "f.jpg", base64: "A" }, { client, prompt: "p", today: "2026-10-08" });
  assert.equal(r.date, "2026-10-10");
  assert.equal(r.retried, true);
  assert.equal(r.needsCheck, false);
});

test("scanOne flags a date that is still past after Sonnet", async () => {
  const client = fakeClient({
    "claude-haiku-5-5": ['{"name":"Ham","date":"2026-10-01"}'],
    "claude-sonnet-5-5": ['{"name":"Ham","date":"2026-10-01"}'],
  });
  const r = await scanOne({ file: "g.jpg", base64: "A" }, { client, prompt: "p", today: "2026-10-08" });
  assert.equal(r.date, "2026-10-01");
  assert.equal(r.needsCheck, true);
});

test("needsRetry double-checks 'no date' on a non-veg item", () => {
  assert.equal(needsRetry({ date: null, noDate: true, needsCheck: false }), true);
  assert.equal(needsRetry({ date: null, noDate: true, kind: "veg", needsCheck: false }), false);
});

test("scanOne accepts 'no date' when Sonnet agrees", async () => {
  const client = fakeClient({
    "claude-haiku-5-5": ['{"name":"Ketchup","noDate":true}'],
    "claude-sonnet-5-5": ['{"name":"Ketchup","noDate":true}'],
  });
  const r = await scanOne({ file: "h.jpg", base64: "A" }, { client, prompt: "p" });
  assert.equal(r.retried, true);
  assert.equal(r.noDate, true);
  assert.equal(r.needsCheck, false);
});
