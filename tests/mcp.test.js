// Tests for the Food Tracker MCP (mcp/) — run with: npm test
// The MCP lets Claude read and change the household's food (packs + shopping list).
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../mcp/src/tools.js");
const loadServer = () => import("../mcp/src/index.js");
const loadFs = () => import("../mcp/src/firestore.js");

const TODAY = "2026-11-08";

// In-memory store with the same shape the Firestore store gives: list/get/put/add per collection
function memStore(seed = {}) {
  const cols = {};
  for (const [name, items] of Object.entries(seed)) {
    cols[name] = new Map(items.map(i => [i.id, { ...i }]));
  }
  const col = name => (cols[name] ||= new Map());
  let n = 0;
  return {
    cols,
    async list(name) { return [...col(name).values()].map(i => ({ ...i })); },
    async get(name, id) { const i = col(name).get(id); return i ? { ...i } : null; },
    async put(name, id, data) { col(name).set(id, { id, ...data }); return id; },
    async add(name, data) { const id = `new${++n}`; col(name).set(id, { id, ...data }); return id; },
  };
}

const PACKS = [
  { id: "a", name: "Chicken", kind: "main", date: "2026-11-09", dateType: "use_by", status: "in_fridge", added: "2026-11-01" },
  { id: "b", name: "Mince", kind: "main", date: "2026-11-20", dateType: "use_by", status: "frozen", added: "2026-10-20" },
  { id: "c", name: "Carrots", kind: "veg", date: null, dateType: null, status: "in_fridge", added: "2026-11-05" },
  { id: "d", name: "Milk", kind: "misc", date: "2026-11-07", dateType: "use_by", status: "in_fridge", added: "2026-11-02" },
  { id: "e", name: "Gammon", kind: "main", date: "2026-11-10", status: "used", left: "2026-11-06" },
  { id: "f", name: "Ham", kind: "main", date: "2026-11-10", status: "deleted", del: 1 },
];

// ---- tool list ----

test("lists the six tools, each with a description and an input schema", async () => {
  const { TOOLS } = await load();
  const names = TOOLS.map(t => t.name).sort();
  assert.deepEqual(names, ["add_food", "add_to_shopping", "mark_food", "shopping_list", "use_soon", "whats_in"]);
  for (const t of TOOLS) {
    assert.ok(t.description && t.description.length > 10, t.name);
    assert.equal(t.inputSchema.type, "object", t.name);
  }
});

// ---- whats_in ----

test("whats_in: only food still in stock, soonest date first, undated last", async () => {
  const { callTool } = await load();
  const store = memStore({ packs: PACKS });
  const out = await callTool("whats_in", {}, { store, today: TODAY });
  assert.deepEqual(out.items.map(i => i.id), ["d", "a", "b", "c"]);
  const milk = out.items[0];
  assert.equal(milk.name, "Milk");
  assert.equal(milk.where, "fridge");
  assert.equal(milk.daysLeft, -1);
  assert.equal(out.items.find(i => i.id === "b").where, "freezer");
  assert.equal(out.items.find(i => i.id === "c").daysLeft, null);
});

test("whats_in: where filter (fridge / freezer / cupboard)", async () => {
  const { callTool } = await load();
  const store = memStore({ packs: [...PACKS, { id: "g", name: "Beans", kind: "cupboard", date: "2027-01-01", status: "in_fridge" }] });
  const freezer = await callTool("whats_in", { where: "freezer" }, { store, today: TODAY });
  assert.deepEqual(freezer.items.map(i => i.id), ["b"]);
  const cupboard = await callTool("whats_in", { where: "cupboard" }, { store, today: TODAY });
  assert.deepEqual(cupboard.items.map(i => i.id), ["g"]);
  const fridge = await callTool("whats_in", { where: "fridge" }, { store, today: TODAY });
  assert.deepEqual(fridge.items.map(i => i.id), ["d", "a", "c"]);
});

// ---- use_soon ----

test("use_soon: fridge food past date or within N days (default 3), not freezer", async () => {
  const { callTool } = await load();
  const store = memStore({ packs: PACKS });
  const out = await callTool("use_soon", {}, { store, today: TODAY });
  assert.deepEqual(out.items.map(i => i.id), ["d", "a"]);
  const wide = await callTool("use_soon", { days: 30 }, { store, today: TODAY });
  assert.deepEqual(wide.items.map(i => i.id), ["d", "a"]); // mince is frozen, carrots have no date
});

// ---- add_food ----

test("add_food: saves packs the same shape the app makes, one per count", async () => {
  const { callTool } = await load();
  const store = memStore();
  const out = await callTool("add_food", { name: "salmon", kind: "main", date: "2026-11-12", count: 2 }, { store, today: TODAY });
  assert.equal(out.added.length, 2);
  const packs = await store.list("packs");
  assert.equal(packs.length, 2);
  const p = packs[0];
  assert.equal(p.name, "Salmon");
  assert.equal(p.kind, "main");
  assert.equal(p.date, "2026-11-12");
  assert.equal(p.dateType, "use_by");
  assert.equal(p.status, "in_fridge");
  assert.equal(p.added, TODAY);
  assert.equal(p.left, null);
  assert.equal(p.frozen, null);
  assert.equal(p.updatedBy, "mcp");
});

test("add_food: freezer, best before, no date for veg", async () => {
  const { callTool } = await load();
  const store = memStore();
  await callTool("add_food", { name: "Peas", kind: "veg", freezer: true }, { store, today: TODAY });
  await callTool("add_food", { name: "Cheese", kind: "misc", date: "2026-12-01", dateType: "best_before" }, { store, today: TODAY });
  const [peas, cheese] = await store.list("packs");
  assert.equal(peas.status, "frozen");
  assert.equal(peas.frozen, TODAY);
  assert.equal(peas.date, null);
  assert.equal(cheese.dateType, "best_before");
});

test("add_food: also remembers the food name (foods list) like the app does", async () => {
  const { callTool } = await load();
  const store = memStore();
  await callTool("add_food", { name: "Salmon", kind: "main", date: "2026-11-12" }, { store, today: TODAY });
  const foods = await store.list("foods");
  assert.equal(foods.length, 1);
  assert.equal(foods[0].id, "salmon");
  assert.equal(foods[0].name, "Salmon");
  assert.equal(foods[0].kind, "main");
});

test("add_food: refuses bad input with a clear message", async () => {
  const { callTool } = await load();
  const store = memStore();
  await assert.rejects(callTool("add_food", { name: "", kind: "veg" }, { store, today: TODAY }), /name/i);
  await assert.rejects(callTool("add_food", { name: "X", kind: "pudding" }, { store, today: TODAY }), /kind/i);
  await assert.rejects(callTool("add_food", { name: "X", kind: "main" }, { store, today: TODAY }), /date/i);
  await assert.rejects(callTool("add_food", { name: "X", kind: "veg", date: "2026-02-30" }, { store, today: TODAY }), /date/i);
  await assert.rejects(callTool("add_food", { name: "X", kind: "veg", count: 0 }, { store, today: TODAY }), /count/i);
  await assert.rejects(callTool("add_food", { name: "X", kind: "veg", count: 21 }, { store, today: TODAY }), /count/i);
  assert.equal((await store.list("packs")).length, 0);
});

// ---- mark_food ----

test("mark_food: used / thrown / freeze / defrost, same as the app", async () => {
  const { callTool } = await load();
  const store = memStore({ packs: PACKS });
  await callTool("mark_food", { id: "a", action: "used" }, { store, today: TODAY });
  assert.equal((await store.get("packs", "a")).status, "used");
  assert.equal((await store.get("packs", "a")).left, TODAY);
  await callTool("mark_food", { id: "d", action: "thrown" }, { store, today: TODAY });
  assert.equal((await store.get("packs", "d")).status, "thrown_away");
  await callTool("mark_food", { id: "c", action: "freeze" }, { store, today: TODAY });
  assert.equal((await store.get("packs", "c")).status, "frozen");
  assert.equal((await store.get("packs", "c")).frozen, TODAY);
  await callTool("mark_food", { id: "b", action: "defrost" }, { store, today: TODAY });
  const mince = await store.get("packs", "b");
  assert.equal(mince.status, "in_fridge");
  assert.equal(mince.date, "2026-11-09");
  assert.equal(mince.frozen, null);
  assert.equal(mince.updatedBy, "mcp");
});

test("mark_food: unknown id, gone food, or bad action is refused", async () => {
  const { callTool } = await load();
  const store = memStore({ packs: PACKS });
  await assert.rejects(callTool("mark_food", { id: "zzz", action: "used" }, { store, today: TODAY }), /not found/i);
  await assert.rejects(callTool("mark_food", { id: "e", action: "used" }, { store, today: TODAY }), /not in stock/i);
  await assert.rejects(callTool("mark_food", { id: "a", action: "eat" }, { store, today: TODAY }), /action/i);
});

// ---- shopping ----

test("shopping_list: items not yet got and not deleted", async () => {
  const { callTool } = await load();
  const store = memStore({ shop: [
    { id: "s1", name: "Bread", got: false, del: null },
    { id: "s2", name: "Eggs", got: true, del: null },
    { id: "s3", name: "Jam", got: false, del: 123 },
  ] });
  const out = await callTool("shopping_list", {}, { store, today: TODAY });
  assert.deepEqual(out.items, [{ id: "s1", name: "Bread" }]);
});

test("add_to_shopping: adds in the app's shape; skips a name already on the list", async () => {
  const { callTool } = await load();
  const store = memStore({ shop: [{ id: "s1", name: "Bread", got: false, del: null }] });
  const out = await callTool("add_to_shopping", { names: ["butter", "bread", " "] }, { store, today: TODAY });
  assert.deepEqual(out.added, ["Butter"]);
  assert.deepEqual(out.alreadyThere, ["bread"]);
  const items = await store.list("shop");
  const butter = items.find(i => i.name === "Butter");
  assert.equal(butter.got, false);
  assert.equal(butter.del, null);
  assert.equal(butter.auto, null);
  assert.equal(butter.added, TODAY);
});

test("unknown tool is refused", async () => {
  const { callTool } = await load();
  await assert.rejects(callTool("nope", {}, { store: memStore(), today: TODAY }), /unknown tool/i);
});

// ---- Firestore value conversion ----

test("firestore: plain object <-> Firestore REST fields round trip", async () => {
  const { toFields, fromFields } = await loadFs();
  const obj = { name: "Milk", count: 2, price: 1.2, got: false, date: null, tags: ["a"], sub: { x: 1 } };
  const f = toFields(obj);
  assert.deepEqual(f.name, { stringValue: "Milk" });
  assert.deepEqual(f.count, { integerValue: "2" });
  assert.deepEqual(f.price, { doubleValue: 1.2 });
  assert.deepEqual(f.got, { booleanValue: false });
  assert.deepEqual(f.date, { nullValue: null });
  assert.deepEqual(fromFields(f), obj);
  assert.equal(typeof fromFields({ t: { timestampValue: "2026-11-08T10:00:00Z" } }).t, "string");
});

// ---- the HTTP / JSON-RPC server ----

const ENV = { MCP_TOKEN: "secret-token-123" };
const rpc = (body, token = "secret-token-123") =>
  new Request(`https://x.workers.dev/mcp/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("server: wrong or missing token gets 404, nothing else said", async () => {
  const { handle } = await loadServer();
  const res = await handle(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "wrong"), ENV, { store: memStore(), today: TODAY });
  assert.equal(res.status, 404);
  const res2 = await handle(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }), {}, { store: memStore(), today: TODAY });
  assert.equal(res2.status, 404); // no token set = closed
});

test("server: initialize answers with server info and tools capability", async () => {
  const { handle } = await loadServer();
  const res = await handle(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }), ENV, { store: memStore(), today: TODAY });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.id, 1);
  assert.ok(j.result.protocolVersion);
  assert.ok(j.result.capabilities.tools);
  assert.equal(j.result.serverInfo.name, "food-tracker");
});

test("server: notifications get 202 with no body", async () => {
  const { handle } = await loadServer();
  const res = await handle(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }), ENV, { store: memStore(), today: TODAY });
  assert.equal(res.status, 202);
});

test("server: tools/list and tools/call", async () => {
  const { handle } = await loadServer();
  const store = memStore({ packs: PACKS });
  const list = await (await handle(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }), ENV, { store, today: TODAY })).json();
  assert.equal(list.result.tools.length, 6);
  const call = await (await handle(rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "use_soon", arguments: {} } }), ENV, { store, today: TODAY })).json();
  assert.equal(call.result.isError, undefined);
  const data = JSON.parse(call.result.content[0].text);
  assert.deepEqual(data.items.map(i => i.id), ["d", "a"]);
});

test("server: a tool error comes back as isError, not a crash", async () => {
  const { handle } = await loadServer();
  const call = await (await handle(rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "mark_food", arguments: { id: "zzz", action: "used" } } }), ENV, { store: memStore(), today: TODAY })).json();
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /not found/i);
});

test("server: unknown method is a JSON-RPC error; GET is 405", async () => {
  const { handle } = await loadServer();
  const j = await (await handle(rpc({ jsonrpc: "2.0", id: 5, method: "foo/bar" }), ENV, { store: memStore(), today: TODAY })).json();
  assert.equal(j.error.code, -32601);
  const get = await handle(new Request("https://x.workers.dev/mcp/secret-token-123"), ENV, { store: memStore(), today: TODAY });
  assert.equal(get.status, 405);
});
