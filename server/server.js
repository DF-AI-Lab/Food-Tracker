// Local server for Food Tracker: serves the app files and saves packs to a SQLite file.
// Run with: npm start   (port 5178, data in ../FoodTrackerData, or set FT_PORT / FT_DATA_DIR)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { RESTART_CODE, checkForUpdate, startAutoUpdate } = require("./updater");

const APP_DIR = path.join(__dirname, "..");
const KEEP_BACKUPS = 14;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon"
};

function defaultDataDir() {
  return path.join(path.dirname(APP_DIR), "FoodTrackerData");
}

function localToday() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// Open a fresh connection per request and close it after (the file lives in OneDrive)
function withDb(dbFile, fn) {
  const db = new DatabaseSync(dbFile);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS packs (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS shop (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS meals (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS sheets (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS ratings (name TEXT PRIMARY KEY, rating INTEGER NOT NULL)");
    return fn(db);
  } finally {
    db.close();
  }
}

function toPack(row) {
  return { ...JSON.parse(row.data), id: row.id };
}

// One copy per day in backups/, keeping only the newest KEEP_BACKUPS
function backupDaily(dataDir, dbFile, today) {
  const dir = path.join(dataDir, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `food-${today}.db`);
  if (!fs.existsSync(target)) fs.copyFileSync(dbFile, target);
  const files = fs.readdirSync(dir).filter(f => /^food-.*\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readPackBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new HttpError(413, "Too big");
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    throw new HttpError(400, "Bad JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Expected a pack");
  const { id, ...pack } = body; // the id comes from the database, not the body
  return pack;
}

// Version stamp: newest change time of the page files. The background
// auto-update changes it too, so an open page can tell it is out of date.
function appVersion() {
  let newest = 0;
  const look = p => {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) fs.readdirSync(p).forEach(f => look(path.join(p, f)));
      else newest = Math.max(newest, st.mtimeMs);
    } catch (e) { /* missing: ignore */ }
  };
  ["index.html", "js", "css"].forEach(p => look(path.join(APP_DIR, p)));
  return String(Math.floor(newest));
}

async function handleApi(req, res, url, ctx) {
  // Says whether this is the TEST copy (the app shows a banner then)
  if (url.pathname === "/api/info") {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
    return sendJson(res, 200, { test: !!ctx.test });
  }

  // "Update now" (the 🔄 button): pull the latest app from GitHub
  if (url.pathname === "/api/update") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    const r = ctx.update ? await ctx.update() : {};
    const body = { updated: !!r.updated, restart: !!r.restart, version: appVersion() };
    sendJson(res, 200, body);
    // Restart only after the answer has gone out
    if (body.restart && ctx.onRestart) setTimeout(ctx.onRestart, 0);
    return;
  }

  // Ratings: one row per food name
  const r = url.pathname.match(/^\/api\/ratings(?:\/(.+))?$/);
  if (r) return handleRatings(req, res, r[1] === undefined ? null : decodeURIComponent(r[1]), ctx);

  // packs (the fridge), shop (the shopping list), meals (history) and sheets (printed sheets) work the same way
  const m = url.pathname.match(/^\/api\/(packs|shop|meals|sheets)(?:\/(\d+))?$/);
  if (!m) return sendJson(res, 404, { error: "Not found" });
  const table = m[1];
  const id = m[2] !== undefined ? Number(m[2]) : null;
  const method = req.method;

  if (method === "GET" && id === null) {
    const packs = withDb(ctx.dbFile, db =>
      db.prepare(`SELECT id, data FROM ${table} ORDER BY id`).all().map(toPack));
    return sendJson(res, 200, packs);
  }

  if (method === "GET") {
    const row = withDb(ctx.dbFile, db => db.prepare(`SELECT id, data FROM ${table} WHERE id = ?`).get(id));
    if (!row) return sendJson(res, 404, { error: "Not found" });
    return sendJson(res, 200, toPack(row));
  }

  if (method === "POST" && id === null) {
    const pack = await readPackBody(req);
    const newId = withDb(ctx.dbFile, db =>
      Number(db.prepare(`INSERT INTO ${table} (data) VALUES (?)`).run(JSON.stringify(pack)).lastInsertRowid));
    afterWrite(ctx);
    return sendJson(res, 200, { id: newId });
  }

  if (method === "PUT" && id !== null) {
    const pack = await readPackBody(req);
    withDb(ctx.dbFile, db =>
      db.prepare(`INSERT OR REPLACE INTO ${table} (id, data) VALUES (?, ?)`).run(id, JSON.stringify(pack)));
    afterWrite(ctx);
    return sendJson(res, 200, { id });
  }

  if (method === "DELETE" && id !== null) {
    withDb(ctx.dbFile, db => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id));
    afterWrite(ctx);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}

async function handleRatings(req, res, name, ctx) {
  if (req.method === "GET" && name === null) {
    const rows = withDb(ctx.dbFile, db => db.prepare("SELECT name, rating FROM ratings ORDER BY name").all());
    return sendJson(res, 200, rows.map(row => ({ name: row.name, rating: row.rating })));
  }
  if (req.method === "PUT" && name !== null) {
    const body = await readPackBody(req);
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Rating must be 1-5");
    withDb(ctx.dbFile, db => db.prepare("INSERT OR REPLACE INTO ratings (name, rating) VALUES (?, ?)").run(name, rating));
    afterWrite(ctx);
    return sendJson(res, 200, { name, rating });
  }
  return sendJson(res, 405, { error: "Method not allowed" });
}

function afterWrite(ctx) {
  backupDaily(ctx.dataDir, ctx.dbFile, ctx.today || localToday());
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    res.writeHead(400, { "Cache-Control": "no-store" });
    return res.end("Bad path");
  }
  if (rel === "/") rel = "/index.html";

  // Refuse hidden files (.git etc.) and anything that resolves outside the app folder
  if (rel.split("/").some(part => part.startsWith("."))) {
    res.writeHead(403, { "Cache-Control": "no-store" });
    return res.end("Forbidden");
  }
  const file = path.resolve(APP_DIR, "." + rel);
  if (file !== APP_DIR && !file.startsWith(APP_DIR + path.sep)) {
    res.writeHead(403, { "Cache-Control": "no-store" });
    return res.end("Forbidden");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      return res.end("Not found");
    }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

async function handle(req, res, ctx) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url, ctx);
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }
  return serveStatic(req, res, url.pathname);
}

function startServer({ port = 0, dataDir = defaultDataDir(), today, test = false, update, onRestart } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, "food.db");
  withDb(dbFile, () => {}); // create the file and table now

  const ctx = { dataDir, dbFile, today, test, update, onRestart };
  const server = http.createServer((req, res) => {
    handle(req, res, ctx).catch(err => {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      sendJson(res, 500, { error: "Server error" });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close() {
          return new Promise(done => {
            server.closeAllConnections();
            server.close(() => done());
          });
        }
      });
    });
  });
}

module.exports = { startServer, defaultDataDir };

if (require.main === module) {
  const port = Number(process.env.FT_PORT) || 5178;
  const dataDir = process.env.FT_DATA_DIR || defaultDataDir();
  // Auto-update from GitHub only when the Windows launcher turns it on
  const autoUpdate = process.env.FT_AUTO_UPDATE === "1";
  const restart = () => process.exit(RESTART_CODE);
  startServer({
    port,
    dataDir,
    test: process.env.FT_TEST === "1",
    update: autoUpdate ? () => checkForUpdate({ cwd: APP_DIR }) : undefined,
    onRestart: autoUpdate ? restart : undefined
  })
    .then(srv => {
      console.log(`Food Tracker running at http://localhost:${srv.port}`);
      if (autoUpdate) startAutoUpdate({ cwd: APP_DIR, onRestart: restart });
    })
    .catch(err => {
      if (err.code === "EADDRINUSE") process.exit(0); // already running
      console.error(err);
      process.exit(1);
    });
}
