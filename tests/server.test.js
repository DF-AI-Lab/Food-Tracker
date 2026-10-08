// Tests for server/server.js (local SQLite server) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startServer } = require("../server/server.js");

const pack = (extra = {}) => ({
  name: "Sausages", kind: "main", date: "2026-10-10", dateType: "use_by",
  status: "in_fridge", added: "2026-10-07", left: null, frozen: null, ...extra,
});

async function withServer(fn, opts = {}) {
  const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "ft-test-"));
  const srv = await startServer({ port: 0, dataDir, today: opts.today });
  const base = `http://localhost:${srv.port}`;
  const api = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, res };
  };
  try { await fn({ api, base, dataDir }); } finally { await srv.close(); }
  return dataDir;
}

test("starts empty and creates food.db in the data folder", async () => {
  await withServer(async ({ api, dataDir }) => {
    const r = await api("GET", "/api/packs");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
    assert.ok(fs.existsSync(path.join(dataDir, "food.db")));
  });
});

test("add returns a new id; get, put and delete work", async () => {
  await withServer(async ({ api }) => {
    const a = await api("POST", "/api/packs", pack());
    assert.equal(a.status, 200);
    assert.equal(typeof a.body.id, "number");
    const id = a.body.id;

    const g = await api("GET", `/api/packs/${id}`);
    assert.equal(g.body.name, "Sausages");
    assert.equal(g.body.id, id);
    assert.equal(g.body.left, null);

    await api("PUT", `/api/packs/${id}`, { ...g.body, status: "used", left: "2026-10-08", del: "2026-10-08" });
    const g2 = await api("GET", `/api/packs/${id}`);
    assert.equal(g2.body.status, "used");
    assert.equal(g2.body.del, "2026-10-08"); // extra fields are kept too

    const d = await api("DELETE", `/api/packs/${id}`);
    assert.equal(d.status, 200);
    assert.equal((await api("GET", `/api/packs/${id}`)).status, 404);
    assert.deepEqual((await api("GET", "/api/packs")).body, []);
  });
});

test("put with a known id re-creates it (undo after delete)", async () => {
  await withServer(async ({ api }) => {
    const { body: { id } } = await api("POST", "/api/packs", pack());
    await api("DELETE", `/api/packs/${id}`);
    await api("PUT", `/api/packs/${id}`, pack({ id }));
    assert.equal((await api("GET", `/api/packs/${id}`)).body.name, "Sausages");
  });
});

test("data survives a restart", async () => {
  const dir = await withServer(async ({ api }) => {
    await api("POST", "/api/packs", pack({ name: "Eggs", kind: "misc" }));
  });
  await withServer(async ({ api }) => {
    const all = (await api("GET", "/api/packs")).body;
    assert.deepEqual(all.map(p => p.name), ["Eggs"]);
  }, { dataDir: dir });
});

test("bad JSON gives 400, unknown id gives 404", async () => {
  await withServer(async ({ base, api }) => {
    const r = await fetch(base + "/api/packs", { method: "POST", body: "nope" });
    assert.equal(r.status, 400);
    assert.equal((await api("GET", "/api/packs/9999")).status, 404);
  });
});

test("serves the app files", async () => {
  await withServer(async ({ base }) => {
    const r = await fetch(base + "/");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /html/);
    assert.match(await r.text(), /<html/i);
    const js = await fetch(base + "/js/logic.js");
    assert.match(js.headers.get("content-type"), /javascript/);
  });
});

test("never serves files outside the app folder", async () => {
  await withServer(async ({ base }) => {
    const r = await fetch(base + "/..%2f..%2fetc%2fpasswd");
    assert.ok(r.status === 403 || r.status === 404);
  });
});

test("daily backup: one copy per day, keeps the last 14", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ft-test-"));
  const backups = path.join(dataDir, "backups");
  fs.mkdirSync(backups);
  for (let d = 1; d <= 20; d++) {
    fs.writeFileSync(path.join(backups, `food-2026-09-${String(d).padStart(2, "0")}.db`), "old");
  }
  await withServer(async ({ api }) => {
    await api("POST", "/api/packs", pack());
    await api("POST", "/api/packs", pack());
  }, { dataDir, today: "2026-10-07" });
  const files = fs.readdirSync(backups).sort();
  assert.equal(files.length, 14);
  assert.equal(files[files.length - 1], "food-2026-10-07.db");
  assert.ok(!files.includes("food-2026-09-01.db"));
});

test("data folder defaults to FoodTrackerData next to the app folder", () => {
  const { defaultDataDir } = require("../server/server.js");
  const appDir = path.join(__dirname, "..");
  assert.equal(defaultDataDir(), path.join(path.dirname(appDir), "FoodTrackerData"));
});
