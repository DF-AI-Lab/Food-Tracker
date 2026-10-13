// Real Claude API photo test. Run on the PC (Node 22) with ANTHROPIC_API_KEY set.
// Usage: node tools/photo-test/run-api.js <photoFolder> [--size 1000] [--thinking on|off] [--today YYYY-MM-DD] [--no-retry] [--limit 5] [--expected file]
const fs = require("node:fs");
const path = require("node:path");
const { parseReply, scoreRun, costUSD, PRICES, buildPrompt } = require("./lib.js");

const MODEL = "claude-haiku-5-5";
const RETRY_MODEL = "claude-sonnet-5-5";
const EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const NAMES = ["Chicken", "Mince", "Sausages", "Gammon", "Bacon", "Salmon", "Milk", "Eggs", "Margarine", "Butter", "Cheese", "Yoghurt", "Bread", "Potatoes", "Carrots", "Onions", "Broccoli", "Peppers", "Mushrooms", "Leeks", "Cabbage", "Coleslaw"];

// Sonnet takes a thinking setting; Haiku is turned off
function thinkingFor(model) {
  return model === "claude-sonnet-5-5" ? { type: "between_tools" } : { type: "disabled" };
}

// Retry on an error, a missing date on something that should have one,
// or a date already past (fresh shopping is rarely out of date, so it's likely a misread)
function needsRetry(r, today) {
  if (r.error) return true;
  // "No date" is double-checked too: a missed date must not slip through silently
  if (r.date == null) return r.kind !== "veg";
  return Boolean(today) && r.date < today;
}

// thinking "on" leaves the setting out so the model uses its default
function buildRequest({ model, base64, prompt, thinking = "off" }) {
  return {
    model,
    max_tokens: thinking === "on" ? 8000 : 1024,
    ...(thinking === "on" ? {} : { thinking: thinkingFor(model) }),
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        { type: "text", text: prompt },
      ],
    }],
  };
}

// One photo: ask Haiku, retry a doubtful answer on Sonnet
async function scanOne(photo, { client, prompt, retry = true, model = MODEL, retryModel = RETRY_MODEL, thinking = "off", today = null }) {
  const calls = [];

  // Any API or parse problem becomes a needs-check result
  const ask = async (m) => {
    try {
      const res = await client.messages.create(buildRequest({ model: m, base64: photo.base64, prompt, thinking }));
      calls.push({ model: m, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens });
      const block = res.content.find((b) => b.type === "text");
      return parseReply(block ? block.text : "");
    } catch (err) {
      return { error: err.message, date: null, needsCheck: true };
    }
  };

  let answer = await ask(model);
  let used = model;
  const retried = retry && needsRetry(answer, today);
  if (retried) {
    const again = await ask(retryModel);
    // Keep the first name if the retry lost the date as well
    if (again.date == null && answer.name) {
      again.name = answer.name;
      again.sub = answer.sub;
    }
    answer = again;
    used = retryModel;
  }

  // Still past after the retry: show it, but ask for a check
  if (today && answer.date && answer.date < today) answer.needsCheck = true;

  return { file: photo.file, ...answer, model: used, retried, calls };
}

// Run scan on every photo, at most `limit` at once
async function runAll(photos, scan, limit = 5) {
  const queue = [...photos];
  const out = {};
  const worker = async () => {
    while (queue.length) {
      const r = await scan(queue.shift());
      out[r.file] = r;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, photos.length) }, worker));
  return out;
}

// Per-model calls, tokens and dollars, plus the total
function costSummary(results) {
  const out = { total: 0 };
  for (const r of Object.values(results)) {
    for (const c of r.calls || []) {
      const m = out[c.model] || (out[c.model] = { calls: 0, input_tokens: 0, output_tokens: 0, cost: 0 });
      const cost = costUSD(c, PRICES[c.model]);
      m.calls++;
      m.input_tokens += c.input_tokens;
      m.output_tokens += c.output_tokens;
      m.cost += cost;
      out.total += cost;
    }
  }
  return out;
}

// Full paths of the photos in a folder, sorted by name
function listPhotos(dir) {
  return fs.readdirSync(dir)
    .filter((f) => EXTS.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((f) => path.join(dir, f));
}

function parseArgs(argv) {
  const opts = { dir: null, size: 1000, retry: true, limit: 5, expected: null, thinking: "on", today: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--size") opts.size = Number(argv[++i]);
    else if (a === "--no-retry") opts.retry = false;
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--expected") opts.expected = argv[++i];
    else if (a === "--thinking") opts.thinking = argv[++i] === "off" ? "off" : "on";
    else if (a === "--today") opts.today = argv[++i];
    else if (!opts.dir) opts.dir = a;
  }
  return opts;
}

// Local time as YYYYMMDD-HHMM
function stamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (!opts.dir || !(opts.size > 0) || !(opts.limit > 0)) {
    console.log("Usage: node tools/photo-test/run-api.js <photoFolder> [--size 1000] [--no-retry] [--limit 5] [--expected tools/photo-test/expected.json]");
    return 1;
  }
  if (!fs.existsSync(opts.dir)) {
    console.log(`Folder not found: ${opts.dir}`);
    return 1;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("No API key set. On Windows, open PowerShell and run:");
    console.log('  $env:ANTHROPIC_API_KEY="your-key"');
    console.log("then run this command again in the same window.");
    return 1;
  }

  // Only needed for a real run, so the tests never load them
  let Anthropic, sharp;
  try {
    Anthropic = require("@anthropic-ai/sdk");
    sharp = require("sharp");
  } catch {
    console.log("Missing packages. Run `npm install` first (from the Food-Tracker folder).");
    return 1;
  }
  const client = new Anthropic();
  const prompt = buildPrompt(NAMES, new Date().getFullYear());

  const files = listPhotos(opts.dir);
  if (files.length === 0) {
    console.log(`No photos (jpg, jpeg, png, webp) in ${opts.dir}`);
    return 1;
  }

  // Shrink and rotate each photo; skip any that won't open
  const photos = [];
  for (const f of files) {
    try {
      const buf = await sharp(f).rotate().resize({ width: opts.size, height: opts.size, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      photos.push({ file: path.basename(f), base64: buf.toString("base64") });
    } catch (err) {
      console.log(`Skipping ${path.basename(f)}: ${err.message}`);
    }
  }

  // Dates before "today" get re-checked; --today lets old test photos use the day they were taken
  const today = opts.today || new Date().toISOString().slice(0, 10);

  let done = 0;
  const scan = async (photo) => {
    const r = await scanOne(photo, { client, prompt, retry: opts.retry, thinking: opts.thinking, today });
    done++;
    console.log(`${done} of ${photos.length} ready`);
    return r;
  };
  const results = await runAll(photos, scan, opts.limit);

  console.table(photos.map(({ file }) => {
    const r = results[file];
    return {
      file,
      name: r.name ?? (r.error ? "ERROR" : ""),
      date: r.date ?? "(blank)",
      bb: r.bb ? "yes" : "",
      veg: r.kind === "veg" ? "yes" : "",
      model: r.model,
      retried: r.retried ? "yes" : "",
      check: r.needsCheck ? "CHECK" : "",
    };
  }));

  // Show each different API error once, so a bad setting is easy to spot
  const errors = [...new Set(Object.values(results).map((r) => r.error).filter(Boolean))];
  for (const e of errors) console.log(`Error: ${e}`);

  const cost = costSummary(results);
  for (const [m, c] of Object.entries(cost)) {
    if (m === "total") continue;
    console.log(`${m}: ${c.calls} calls, ${c.input_tokens} in / ${c.output_tokens} out tokens, $${c.cost.toFixed(4)}`);
  }
  console.log(`Total: $${cost.total.toFixed(4)}`);
  console.log(`Average per photo: $${(cost.total / photos.length).toFixed(4)}`);

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `results-api-${opts.size}-${stamp(new Date())}.json`);
  const settings = { size: opts.size, retry: opts.retry, thinking: opts.thinking, today, models: opts.retry ? [MODEL, RETRY_MODEL] : [MODEL] };
  fs.writeFileSync(outFile, JSON.stringify({ settings, cost, results }, null, 2));
  console.log(`Saved: ${outFile}`);
  console.log("Upload this file to Claude to score it.");

  if (opts.expected) {
    const expected = JSON.parse(fs.readFileSync(opts.expected, "utf8"));
    // Score only the photos in this folder
    const subset = Object.fromEntries(Object.entries(expected).filter(([f]) => results[f]));
    if (Object.keys(subset).length === 0) {
      console.log("No file names match the expected file, so not scoring.");
    } else {
      const s = scoreRun(subset, results);
      console.log(`Score (${s.total} photos): right ${s.right}, blank ${s.blank}, WRONG ${s.wrong}`);
    }
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { thinkingFor, needsRetry, buildRequest, scanOne, runAll, costSummary, listPhotos };
