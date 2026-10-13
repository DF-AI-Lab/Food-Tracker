// Photo test rig helpers (V3): parse model replies, score runs, estimate cost.
// Node built-ins only.
const fs = require("node:fs");
const path = require("node:path");

// USD per million tokens
const PRICES = {
  "claude-haiku-5-5": { in: 0.10, out: 0.50 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Keep a YYYY-MM-DD string only if it is a real calendar date.
function realDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const ok = t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  return ok ? s : null;
}

const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const norm = (v) => String(v ?? "").trim().toLowerCase();

// Model text -> one clean entry. Never guesses: bad fields become null.
function parseReply(text) {
  const raw = String(text ?? "").replace(/```\w*/g, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let o;
  try {
    if (start < 0 || end < start) throw new Error("no object");
    o = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { error: "Couldn't read reply", needsCheck: true, date: null };
  }
  const kind = ["main", "side", "veg", "misc"].includes(norm(o.kind)) ? norm(o.kind) : null;
  // Veg never has a date: the app counts from the day it goes in the fridge
  const date = kind === "veg" ? null : realDate(o.date);
  const noDate = o.noDate === true || kind === "veg";
  return {
    name: clean(o.name),
    sub: clean(o.sub),
    kind,
    date,
    bb: o.bb === true && kind !== "veg",
    price: typeof o.price === "number" && Number.isFinite(o.price) ? o.price : null,
    packs: Number.isInteger(o.packs) && o.packs >= 2 ? o.packs : null,
    noDate,
    needsCheck: date === null && !noDate,
  };
}

// One photo: compare the model's entry with the answer key.
function scoreOne(expected, got) {
  got = got || {};
  let date;
  if (got.error) date = "blank";
  else if (expected.noDate || !expected.date) date = got.date == null ? "right" : "wrong";
  else if (got.date === expected.date) date = "right";
  else if (got.date == null) date = "blank";
  else date = "wrong";

  return {
    date,
    name: got.name != null && norm(got.name) === norm(expected.name),
    kind: expected.kind === undefined ? true : got.kind === expected.kind,
    bb: Boolean(expected.bb) === Boolean(got.bb),
    price: expected.price === undefined ? true : got.price === expected.price,
  };
}

// A whole run: expected and results are objects keyed by file name.
function scoreRun(expected, results) {
  const rows = Object.keys(expected).map((file) => {
    const got = results[file] || { error: "missing" };
    return { file, ...scoreOne(expected[file], got), expected: expected[file], got };
  });
  const count = (fn) => rows.filter(fn).length;
  return {
    total: rows.length,
    right: count((r) => r.date === "right"),
    blank: count((r) => r.date === "blank"),
    wrong: count((r) => r.date === "wrong"),
    nameRight: count((r) => r.name),
    kindRight: count((r) => r.kind),
    bbRight: count((r) => r.bb),
    priceRight: count((r) => r.price),
    rows,
  };
}

// Image tokens, same rule the API uses (resize to fit, then w*h / 750).
function estimateTokens(w, h) {
  const scale = Math.min(1, 1568 / Math.max(w, h), Math.sqrt(1150000 / (w * h)));
  return Math.round((w * scale) * (h * scale) / 750);
}

function costUSD(usage, price) {
  return (usage.input_tokens * price.in + usage.output_tokens * price.out) / 1e6;
}

// Fill the prompt template that sits next to this file.
function buildPrompt(names, year) {
  const tpl = fs.readFileSync(path.join(__dirname, "prompt.txt"), "utf8");
  return tpl.split("{{NAMES}}").join(names.join(", ")).split("{{YEAR}}").join(String(year));
}

module.exports = { parseReply, scoreOne, scoreRun, estimateTokens, costUSD, PRICES, buildPrompt };
