// The MCP tools: read and change the household's packs (food) and shopping list.
// Same data shapes as the app (demo/js/logic.js makePacks / markUsed / freeze / defrost).

const KINDS = ["main", "side", "veg", "misc", "cupboard"];
const NEEDS_DATE = ["main", "misc", "cupboard"]; // same rule as the app
const STOCK = ["in_fridge", "frozen"];
const ACTIONS = ["used", "thrown", "freeze", "defrost"];

export const TOOLS = [
  {
    name: "whats_in",
    description: "List the food in stock now (fridge, freezer and cupboard), soonest use-by date first; undated food last. Each item's id is what mark_food needs.",
    inputSchema: {
      type: "object",
      properties: {
        where: { type: "string", enum: ["fridge", "freezer", "cupboard"], description: "Only show this place. Leave out for everything." },
      },
    },
  },
  {
    name: "use_soon",
    description: "List fridge food that is past its date or due within a few days, so it can be used up first. Freezer food and food with no date are left out.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 0, maximum: 365, description: "Look this many days ahead. Default 3." },
      },
    },
  },
  {
    name: "add_food",
    description: "Add food that has just been bought or put away. Makes one pack per count and remembers the food name. Main, misc and cupboard food needs a date unless noDate is true.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the food, e.g. Salmon." },
        kind: { type: "string", enum: KINDS, description: "main, side, veg, misc or cupboard." },
        date: { type: "string", description: "Use-by or best-before date as YYYY-MM-DD." },
        dateType: { type: "string", enum: ["use_by", "best_before"], description: "Default use_by." },
        count: { type: "integer", minimum: 1, maximum: 20, description: "How many packs. Default 1." },
        freezer: { type: "boolean", description: "True if it goes straight into the freezer." },
        noDate: { type: "boolean", description: "True if there is no date on purpose." },
      },
      required: ["name", "kind"],
    },
  },
  {
    name: "mark_food",
    description: "Change one pack in stock: used (eaten), thrown (wasted), freeze, or defrost (back in the fridge, use-by tomorrow). Needs the pack id from whats_in.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Pack id from whats_in or use_soon." },
        action: { type: "string", enum: ACTIONS },
      },
      required: ["id", "action"],
    },
  },
  {
    name: "shopping_list",
    description: "Show the shopping list: items not yet bought and not deleted.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_to_shopping",
    description: "Add items to the shopping list. Names already on the list (ignoring case) are skipped and reported back.",
    inputSchema: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50, description: "Item names, e.g. [\"butter\", \"eggs\"]." },
      },
      required: ["names"],
    },
  },
];

// ---- small helpers ----
const day = s => Date.parse(s + "T00:00:00Z");
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(day(s)) && new Date(day(s)).toISOString().slice(0, 10) === s;
const addDays = (s, n) => new Date(day(s) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((day(to) - day(from)) / 86400000);
const cap = s => { const t = s.trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const stamp = () => ({ updatedBy: "mcp", updatedAt: new Date().toISOString() });
// Freezer if frozen, cupboard for cupboard food, otherwise fridge
const whereOf = p => (p.status === "frozen" ? "freezer" : p.kind === "cupboard" ? "cupboard" : "fridge");
const view = (p, today) => ({
  id: p.id, name: p.name, kind: p.kind, where: whereOf(p),
  date: p.date ?? null, dateType: p.dateType ?? null,
  daysLeft: p.date ? daysBetween(today, p.date) : null,
  added: p.added ?? null,
});
// Soonest date first, undated last (stable sort keeps the rest in order)
const byDate = (a, b) => (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31");

// ---- tool handlers ----

async function whatsIn({ where }, { store, today }) {
  if (where !== undefined && !["fridge", "freezer", "cupboard"].includes(where)) throw new Error("where must be fridge, freezer or cupboard");
  const items = (await store.list("packs"))
    .filter(p => STOCK.includes(p.status))
    .map(p => view(p, today))
    .filter(i => !where || i.where === where)
    .sort(byDate);
  return { today, items };
}

async function useSoon({ days = 3 }, { store, today }) {
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new Error("days must be a whole number from 0 to 365");
  const items = (await store.list("packs"))
    .filter(p => p.status === "in_fridge" && p.date) // not frozen, has a date
    .map(p => view(p, today))
    .filter(i => i.daysLeft <= days)
    .sort(byDate);
  return { today, items };
}

async function addFood(a, { store, today }) {
  const name = typeof a.name === "string" ? a.name.trim() : "";
  if (!name) throw new Error("name is required");
  if (!KINDS.includes(a.kind)) throw new Error(`kind must be one of: ${KINDS.join(", ")}`);
  const date = a.date ?? null;
  if (date !== null && !isDate(date)) throw new Error("date must be a real date as YYYY-MM-DD");
  if (!date && NEEDS_DATE.includes(a.kind) && a.noDate !== true) throw new Error(`${a.kind} needs a date (YYYY-MM-DD), or set noDate`);
  const dateType = date ? (a.dateType || "use_by") : null;
  if (dateType && !["use_by", "best_before"].includes(dateType)) throw new Error("dateType must be use_by or best_before");
  const count = a.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("count must be a whole number from 1 to 20");

  const freezer = a.freezer === true;
  const pack = {
    name: cap(name), kind: a.kind, date, dateType,
    status: freezer ? "frozen" : "in_fridge",
    added: today, left: null, frozen: freezer ? today : null,
    sub: null, price: null, ...stamp(),
  };
  const added = [];
  for (let i = 0; i < count; i++) added.push(await store.add("packs", pack));
  // Remember the food name, like the app does (doc id = lower-case name)
  await store.put("foods", encodeURIComponent(name.toLowerCase()), { name: pack.name, kind: a.kind, noDate: !date, ...stamp() });
  return { added, name: pack.name, count };
}

async function markFood({ id, action }, { store, today }) {
  if (!ACTIONS.includes(action)) throw new Error(`action must be one of: ${ACTIONS.join(", ")}`);
  const p = id ? await store.get("packs", String(id)) : null;
  if (!p) throw new Error(`No food with id "${id}" (not found). Use whats_in to get the ids.`);
  if (!STOCK.includes(p.status)) throw new Error(`"${p.name}" is not in stock, so it can't be changed`);

  let change;
  switch (action) {
    case "used": change = { status: "used", left: today }; break;
    case "thrown": change = { status: "thrown_away", left: today }; break;
    case "freeze":
      if (p.status === "frozen") throw new Error(`"${p.name}" is already frozen`);
      change = { status: "frozen", frozen: today }; break;
    case "defrost":
      if (p.status !== "frozen") throw new Error(`"${p.name}" is not frozen`);
      change = { status: "in_fridge", date: addDays(today, 1), dateType: "use_by", frozen: null }; break;
  }
  const { id: _id, ...rest } = p;
  const data = { ...rest, ...change, ...stamp() };
  await store.put("packs", String(id), data);
  return { changed: view({ id: String(id), ...data }, today) };
}

async function shoppingList(_args, { store }) {
  const items = (await store.list("shop"))
    .filter(i => !i.got && !i.del)
    .map(i => ({ id: i.id, name: i.name }));
  return { items };
}

async function addToShopping({ names }, { store, today }) {
  if (!Array.isArray(names) || names.length === 0 || names.length > 50) throw new Error("names must be a list of 1 to 50 item names");
  // Names already on the list (not bought, not deleted), compared ignoring case
  const have = new Set((await store.list("shop"))
    .filter(i => !i.got && !i.del)
    .map(i => (i.name || "").trim().toLowerCase()));
  const added = [], alreadyThere = [];
  for (const raw of names) {
    const n = typeof raw === "string" ? raw.trim() : "";
    if (!n) continue;
    const key = n.toLowerCase();
    if (have.has(key)) { alreadyThere.push(n); continue; }
    have.add(key); // also stops duplicates within this call
    const name = cap(n);
    await store.add("shop", { name, got: false, del: null, auto: null, added: today, ...stamp() });
    added.push(name);
  }
  return { added, alreadyThere };
}

const HANDLERS = {
  whats_in: whatsIn,
  use_soon: useSoon,
  add_food: addFood,
  mark_food: markFood,
  shopping_list: shoppingList,
  add_to_shopping: addToShopping,
};

// ctx = { store, today }. Throws Error with a readable message on bad input.
export async function callTool(name, args = {}, ctx) {
  if (!Object.hasOwn(HANDLERS, name)) throw new Error(`Unknown tool: ${name}`);
  return HANDLERS[name](args || {}, ctx);
}
