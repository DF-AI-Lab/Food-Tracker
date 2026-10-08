// Tests for js/logic.js — run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/logic.js");

const TODAY = "2026-10-07"; // a Wednesday

// ---------- dates ----------

test("addDays moves across months", () => {
  assert.equal(L.addDays("2026-10-07", 3), "2026-10-10");
  assert.equal(L.addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(L.addDays("2026-10-07", -7), "2026-09-30");
});

test("daysLeft counts whole days from today", () => {
  assert.equal(L.daysLeft("2026-10-07", TODAY), 0);
  assert.equal(L.daysLeft("2026-10-10", TODAY), 3);
  assert.equal(L.daysLeft("2026-10-05", TODAY), -2);
  assert.equal(L.daysLeft("2026-11-07", TODAY), 31);
});

test("formatDate gives short UK style", () => {
  assert.equal(L.formatDate("2026-10-07"), "Wed 7 Oct");
  assert.equal(L.formatDate("2026-11-12"), "Thu 12 Nov");
});

// ---------- date shortcuts ----------

test("parseDDMM: 4 digits = this year", () => {
  assert.equal(L.parseDDMM("1211", TODAY), "2026-11-12");
  assert.equal(L.parseDDMM("0810", TODAY), "2026-10-08");
});

test("parseDDMM: never rolls to next year (past stays past)", () => {
  assert.equal(L.parseDDMM("0110", TODAY), "2026-10-01");
  assert.equal(L.parseDDMM("0501", TODAY), "2026-01-05");
});

test("parseDDMM: 6 digits = DDMMYY", () => {
  assert.equal(L.parseDDMM("081026", TODAY), "2026-10-08");
  assert.equal(L.parseDDMM("020127", TODAY), "2027-01-02");
});

test("parseDDMM: bad input gives null", () => {
  assert.equal(L.parseDDMM("", TODAY), null);
  assert.equal(L.parseDDMM("12", TODAY), null);
  assert.equal(L.parseDDMM("3202", TODAY), null); // 32 Feb
  assert.equal(L.parseDDMM("3102", TODAY), null); // 31 Feb
  assert.equal(L.parseDDMM("0013", TODAY), null);
  assert.equal(L.parseDDMM("ab12", TODAY), null);
});

test("parseDays: number of days from today", () => {
  assert.equal(L.parseDays("3", TODAY), "2026-10-10");
  assert.equal(L.parseDays("0", TODAY), "2026-10-07");
  assert.equal(L.parseDays("", TODAY), null);
  assert.equal(L.parseDays("x", TODAY), null);
  assert.equal(L.parseDays("-2", TODAY), null);
});

// ---------- countdown + colour ----------

test("countdown shows only at 5 days or fewer", () => {
  assert.equal(L.countdown("2026-10-13", TODAY), "Tue 13 Oct"); // 6 days -> date
  assert.equal(L.countdown("2026-10-12", TODAY), "5 days left");
  assert.equal(L.countdown("2026-10-10", TODAY), "3 days left");
  assert.equal(L.countdown("2026-10-08", TODAY), "1 day left");
  assert.equal(L.countdown("2026-10-07", TODAY), "Today!");
  assert.equal(L.countdown("2026-10-06", TODAY), "1 day out");
  assert.equal(L.countdown("2026-10-05", TODAY), "2 days out");
});

test("colour: green >3, amber 3..0, red when out", () => {
  assert.equal(L.colour("2026-10-11", TODAY), "green"); // 4
  assert.equal(L.colour("2026-10-10", TODAY), "amber"); // 3
  assert.equal(L.colour("2026-10-07", TODAY), "amber"); // 0
  assert.equal(L.colour("2026-10-06", TODAY), "red");   // -1
});

test("ageLabel and old flag for undated veg", () => {
  assert.equal(L.ageLabel("2026-10-07", TODAY), "Added today");
  assert.equal(L.ageLabel("2026-10-06", TODAY), "1 day old");
  assert.equal(L.ageLabel("2026-09-29", TODAY), "8 days old");
  assert.equal(L.isOld("2026-10-01", TODAY), false); // 6 days
  assert.equal(L.isOld("2026-09-30", TODAY), true);  // 7 days
});

// ---------- making packs ----------

test("makePacks: one record per pack", () => {
  const out = L.makePacks({ name: "Sausages", kind: "main", date: "2026-10-10", dateType: "use_by", count: 3 }, TODAY);
  assert.equal(out.length, 3);
  for (const p of out) {
    assert.equal(p.name, "Sausages");
    assert.equal(p.kind, "main");
    assert.equal(p.status, "in_fridge");
    assert.equal(p.added, TODAY);
    assert.equal(p.left, null);
    assert.equal(p.frozen, null);
  }
});

test("makePacks: straight to freezer", () => {
  const [p] = L.makePacks({ name: "Mince", kind: "main", date: "2026-10-09", dateType: "use_by", count: 1, toFreezer: true }, TODAY);
  assert.equal(p.status, "frozen");
  assert.equal(p.frozen, TODAY);
});

test("makePacks: name is tidied (trimmed, first letter capital)", () => {
  const [p] = L.makePacks({ name: "  chicken ", kind: "main", date: "2026-10-09", dateType: "use_by", count: 1 }, TODAY);
  assert.equal(p.name, "Chicken");
});

test("makePacks: mains and misc need a date, sides don't", () => {
  assert.throws(() => L.makePacks({ name: "Chicken", kind: "main", date: null, count: 1 }, TODAY));
  assert.throws(() => L.makePacks({ name: "Milk", kind: "misc", date: null, count: 1 }, TODAY));
  assert.throws(() => L.makePacks({ name: "", kind: "side", date: null, count: 1 }, TODAY));
  const [p] = L.makePacks({ name: "Carrots", kind: "side", date: null, count: 1 }, TODAY);
  assert.equal(p.date, null);
  assert.equal(p.dateType, null);
});

// ---------- pack actions ----------

const base = { id: 1, name: "Bacon", kind: "main", date: "2026-10-09", dateType: "use_by", status: "in_fridge", added: "2026-10-01", left: null, frozen: null };

test("used / thrown away set status and left date", () => {
  const u = L.markUsed(base, TODAY);
  assert.equal(u.status, "used");
  assert.equal(u.left, TODAY);
  const t = L.markThrown(base, TODAY);
  assert.equal(t.status, "thrown_away");
  assert.equal(t.left, TODAY);
  assert.equal(base.status, "in_fridge", "original not changed");
});

test("freeze and defrost", () => {
  const f = L.freeze(base, TODAY);
  assert.equal(f.status, "frozen");
  assert.equal(f.frozen, TODAY);
  const d = L.defrost(f, "2026-11-01");
  assert.equal(d.status, "in_fridge");
  assert.equal(d.date, "2026-11-02"); // use by tomorrow
  assert.equal(d.dateType, "use_by");
  assert.equal(d.frozen, null);
});

// ---------- fridge view ----------

function pk(id, name, kind, date, extra = {}) {
  return { id, name, kind, date, dateType: date ? "use_by" : null, status: "in_fridge", added: "2026-10-05", left: null, frozen: null, ...extra };
}

test("cards: same name shares a card, max 2, soonest first", () => {
  const packs = [
    pk(1, "Sausages", "main", "2026-10-14"),
    pk(2, "Sausages", "main", "2026-10-08"),
    pk(3, "Sausages", "main", "2026-10-10"),
    pk(4, "Chicken", "main", "2026-10-09"),
  ];
  const cards = L.cards(packs, "main");
  assert.deepEqual(cards.map(c => [c.name, c.packs.map(p => p.id)]), [
    ["Sausages", [2, 3]],
    ["Chicken", [4]],
    ["Sausages", [1]],
  ]);
});

test("fridgeView splits mains, misc, sides, veg", () => {
  const packs = [
    pk(1, "Chicken", "main", "2026-10-09"),
    pk(2, "Coleslaw", "side", "2026-10-09"),
    pk(3, "Milk", "misc", "2026-10-10"),      // 3 days -> shown
    pk(4, "Ketchup", "misc", "2027-03-01"),   // shown as "all OK"
    pk(5, "Butter", "misc", "2026-10-14"),    // 7 days -> all OK
    pk(6, "Onions", "side", null, { added: "2026-09-27" }),
    pk(7, "Carrots", "side", null, { added: "2026-10-05" }),
    pk(8, "Old", "main", "2026-10-09", { status: "used" }),
    pk(9, "Ice", "main", "2026-10-09", { status: "frozen" }),
  ];
  const v = L.fridgeView(packs, TODAY);
  assert.deepEqual(v.mains.map(c => c.name), ["Chicken"]);
  assert.deepEqual(v.sides.map(c => c.name), ["Coleslaw"]);
  assert.deepEqual(v.misc.map(p => p.name), ["Milk"]);
  assert.equal(v.miscOk, 2);
  assert.deepEqual(v.veg.map(p => p.name), ["Onions", "Carrots"]); // oldest first
  assert.equal(v.mainCount, 1);
  assert.equal(v.sideCount, 3); // coleslaw + 2 veg
});

// ---------- freezer ----------

test("freezerList oldest first with age label and 3-month flag", () => {
  const packs = [
    pk(1, "Chicken", "main", "2026-10-03", { status: "frozen", frozen: "2026-10-01" }),
    pk(2, "Bread", "misc", "2026-07-10", { status: "frozen", frozen: "2026-06-30" }),
    pk(3, "Mince", "main", "2026-09-22", { status: "frozen", frozen: "2026-09-20" }),
    pk(4, "Bacon", "main", "2026-10-09"),
  ];
  const list = L.freezerList(packs, TODAY);
  assert.deepEqual(list.map(x => x.pack.name), ["Bread", "Mince", "Chicken"]);
  assert.equal(list[1].label, "in 20 Sep · 2 weeks");
  assert.equal(list[2].label, "in 1 Oct · 6 days");
  assert.equal(list[0].old, true);
  assert.equal(list[1].old, false);
});

test("freezeAge words", () => {
  assert.equal(L.freezeAge("2026-10-06", TODAY), "1 day");
  assert.equal(L.freezeAge("2026-10-07", TODAY), "today");
  assert.equal(L.freezeAge("2026-09-23", TODAY), "2 weeks");
  assert.equal(L.freezeAge("2026-06-30", TODAY), "3 months");
});

// ---------- used & wasted ----------

test("usedSummary counts this month, newest first", () => {
  const packs = [
    pk(1, "Mince", "main", "2026-10-04", { status: "used", left: "2026-10-03" }),
    pk(2, "Yoghurt", "side", null, { status: "thrown_away", left: "2026-10-05" }),
    pk(3, "Ham", "main", "2026-09-20", { status: "used", left: "2026-09-28" }),
    pk(4, "Bacon", "main", "2026-10-09"),
  ];
  const s = L.usedSummary(packs, TODAY);
  assert.equal(s.used, 1);
  assert.equal(s.wasted, 1);
  assert.deepEqual(s.list.map(p => p.name), ["Yoghurt", "Mince", "Ham"]);
});

// ---------- usual buttons ----------

test("starters include the user's favourites", () => {
  assert.deepEqual(L.STARTERS.main, ["Chicken", "Mince", "Sausages", "Gammon"]);
  assert.ok(L.STARTERS.side.includes("Dauphinoise potatoes"));
  assert.ok(L.STARTERS.side.includes("Sweetcorn cobs"));
  assert.deepEqual(L.STARTERS.misc, ["Milk", "Eggs", "Margarine", "Butter"]);
});

test("usuals: starters first, then re-ordered by most added", () => {
  assert.deepEqual(L.usuals([], "main"), ["Chicken", "Mince", "Sausages", "Gammon"]);
  const packs = [
    pk(1, "Gammon", "main", "2026-10-09"),
    pk(2, "Gammon", "main", "2026-10-09", { status: "used" }),
    pk(3, "Bacon", "main", "2026-10-09"),
    pk(4, "Bacon", "main", "2026-10-09"),
    pk(5, "Bacon", "main", "2026-10-09"),
    pk(6, "Chips", "side", "2026-10-09"),
  ];
  assert.deepEqual(L.usuals(packs, "main"), ["Bacon", "Gammon", "Chicken", "Mince", "Sausages"]);
});

// ---------- quick fill (JSON from Claude) ----------

test("parseQuickFill reads a plain array", () => {
  const r = L.parseQuickFill(`[
    {"name":"sausages","kind":"main","date":"2026-10-10","packs":2},
    {"name":"Carrots","kind":"side","date":null},
    {"name":"Milk","kind":"misc","date":"2026-10-12","dateType":"best_before"}
  ]`, TODAY);
  assert.equal(r.error, null);
  assert.deepEqual(r.items.map(i => [i.name, i.kind, i.date, i.dateType, i.count, i.ok]), [
    ["Sausages", "main", "2026-10-10", "use_by", 2, true],
    ["Carrots", "side", null, null, 1, true],
    ["Milk", "misc", "2026-10-12", "best_before", 1, true],
  ]);
});

test("parseQuickFill copes with code fences, extra text and {items:[...]}", () => {
  const r = L.parseQuickFill('Here you go:\n```json\n{"items":[{"name":"Eggs","kind":"misc","date":"2026-10-20"}]}\n```\nEnjoy!', TODAY);
  assert.equal(r.error, null);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].name, "Eggs");
});

test("parseQuickFill: veg kept as veg, freezer flag kept", () => {
  const r = L.parseQuickFill('[{"name":"Peas","kind":"veg","date":null},{"name":"Mince","kind":"main","date":"2026-10-09","freezer":true}]', TODAY);
  assert.equal(r.items[0].kind, "veg");
  assert.equal(r.items[0].ok, true);
  assert.equal(r.items[1].toFreezer, true);
});

test("parseQuickFill flags bad rows but keeps the good ones", () => {
  const r = L.parseQuickFill(`[
    {"name":"Chicken","kind":"main","date":null},
    {"name":"Cheese","kind":"cheese","date":"2026-10-20"},
    {"name":"","kind":"side","date":null},
    {"name":"Ham","kind":"main","date":"10/10/2026"},
    {"name":"Bacon","kind":"main","date":"2026-10-11","packs":99}
  ]`, TODAY);
  assert.equal(r.error, null);
  assert.deepEqual(r.items.map(i => i.ok), [false, false, false, false, true]);
  assert.match(r.items[0].problem, /date/i);
  assert.match(r.items[1].problem, /main, side, veg or misc/i);
  assert.equal(r.items[4].count, 20); // capped
});

test("parseQuickFill: not JSON gives an error", () => {
  assert.match(L.parseQuickFill("hello", TODAY).error, /read/i);
  assert.match(L.parseQuickFill("", TODAY).error, /paste/i);
  assert.match(L.parseQuickFill("[]", TODAY).error, /no food/i);
});

test("CLAUDE_PROMPT explains the format", () => {
  assert.match(L.CLAUDE_PROMPT, /"kind"/);
  assert.match(L.CLAUDE_PROMPT, /main/);
  assert.match(L.CLAUDE_PROMPT, /ask/i);
});

// ---------- delete (mistakes): not saved as used/wasted, kept 1 day for Undo ----------

const delPack = (id, del) => ({ id, name: "Haggis", kind: "main", date: "2026-10-09", dateType: "use_by",
  status: "deleted", added: "2026-10-01", left: null, frozen: null, del });

test("markDeleted sets status deleted and the del date, without changing the original", () => {
  const p = { ...delPack(1, null), status: "in_fridge" };
  const d = L.markDeleted(p, TODAY);
  assert.equal(d.status, "deleted");
  assert.equal(d.del, TODAY);
  assert.equal(p.status, "in_fridge");
});

test("deletedList shows deletes from today and yesterday, newest first", () => {
  const packs = [delPack(1, "2026-10-06"), delPack(2, TODAY), delPack(3, "2026-10-05"),
    { ...delPack(4, null), status: "in_fridge" }];
  assert.deepEqual(L.deletedList(packs, TODAY).map(p => p.id), [2, 1]);
});

test("expiredDeletes lists deleted packs older than 1 day (to remove for good)", () => {
  const packs = [delPack(1, "2026-10-06"), delPack(2, TODAY), delPack(3, "2026-10-05"), delPack(4, "2026-09-01")];
  assert.deepEqual(L.expiredDeletes(packs, TODAY).map(p => p.id).sort(), [3, 4]);
});

test("deleted packs count nowhere: fridge, used & wasted, freezer, usuals", () => {
  const packs = [delPack(1, TODAY)];
  const v = L.fridgeView(packs, TODAY);
  assert.equal(v.mainCount, 0);
  assert.equal(v.mains.length, 0);
  const u = L.usedSummary(packs, TODAY);
  assert.equal(u.used + u.wasted, 0);
  assert.equal(u.list.length, 0);
  assert.equal(L.freezerList(packs, TODAY).length, 0);
  assert.ok(!L.usuals(packs, "main").includes("Haggis"));
});

// ---------- Veg as its own kind ----------

test("STARTERS has a veg list; kinds are main, side, veg, misc", () => {
  assert.ok(Array.isArray(L.STARTERS.veg) && L.STARTERS.veg.length >= 4);
  assert.ok(L.STARTERS.veg.includes("Carrots"));
  assert.deepEqual(L.KINDS, ["main", "side", "veg", "misc"]);
});

test("makePacks: veg needs no date", () => {
  const [p] = L.makePacks({ name: "onions", kind: "veg", date: null, count: 1 }, TODAY);
  assert.equal(p.kind, "veg");
  assert.equal(p.date, null);
  assert.equal(p.dateType, null);
});

test("fridgeView: veg goes in the veg box (with undated sides), oldest first, and counts as a side", () => {
  const v = L.fridgeView([
    pk(1, "Coleslaw", "side", "2026-10-09"),
    pk(2, "Carrots", "veg", null, { added: "2026-10-05" }),
    pk(3, "Onions", "veg", null, { added: "2026-09-27" }),
    pk(4, "Peas", "side", null, { added: "2026-10-01" }),
    pk(5, "Leeks", "veg", "2026-10-12", { added: "2026-10-06" }),
  ], TODAY);
  assert.deepEqual(v.veg.map(p => p.name), ["Onions", "Peas", "Carrots", "Leeks"]);
  assert.deepEqual(v.sides.map(c => c.name), ["Coleslaw"]);
  assert.equal(v.sideCount, 5);
});

// ---------- "No date" for any kind, remembered per food ----------

test("makePacks: any kind may skip the date when noDate is set", () => {
  const [m] = L.makePacks({ name: "Margarine", kind: "misc", date: null, count: 1, noDate: true }, TODAY);
  assert.equal(m.date, null);
  const [c] = L.makePacks({ name: "Pie", kind: "main", date: null, count: 1, noDate: true }, TODAY);
  assert.equal(c.date, null);
  // without noDate, mains and misc still need a date
  assert.throws(() => L.makePacks({ name: "Eggs", kind: "misc", date: null, count: 1 }, TODAY));
});

test("rememberedNoDate: true when the latest pack of that food had no date", () => {
  const packs = [
    pk(1, "Margarine", "misc", null, { added: "2026-10-01" }),
    pk(2, "Eggs", "misc", "2026-10-20", { added: "2026-10-01" }),
    pk(3, "Ham", "main", null, { added: "2026-09-01", status: "used" }),
    pk(4, "Ham", "main", "2026-10-09", { added: "2026-10-03" }),
  ];
  assert.equal(L.rememberedNoDate(packs, "margarine"), true);   // any case
  assert.equal(L.rememberedNoDate(packs, " Margarine "), true); // trims
  assert.equal(L.rememberedNoDate(packs, "Eggs"), false);
  assert.equal(L.rememberedNoDate(packs, "Ham"), false);        // latest has a date again
  assert.equal(L.rememberedNoDate(packs, "Butter"), false);     // never seen
});

test("fridgeView: undated mains listed separately (oldest first) and counted", () => {
  const v = L.fridgeView([
    pk(1, "Chicken", "main", "2026-10-09"),
    pk(2, "Pie", "main", null, { added: "2026-10-04" }),
    pk(3, "Quiche", "main", null, { added: "2026-10-02" }),
    pk(4, "Margarine", "misc", null),
  ], TODAY);
  assert.deepEqual(v.mains.map(c => c.name), ["Chicken"]);
  assert.deepEqual(v.mainsNoDate.map(p => p.name), ["Quiche", "Pie"]);
  assert.equal(v.mainCount, 3);
  assert.equal(v.miscOk, 1);
});

// ---------- Quick fill: veg + no date ----------

test("parseQuickFill: veg is its own kind ('vegetable' too)", () => {
  const r = L.parseQuickFill(`[{"name":"carrots","kind":"veg","date":null},{"name":"Leeks","kind":"vegetable"}]`, TODAY);
  assert.deepEqual(r.items.map(i => [i.name, i.kind, i.ok]), [["Carrots", "veg", true], ["Leeks", "veg", true]]);
});

test("parseQuickFill: main/misc with no date is ok when noDate:true or remembered", () => {
  const packs = [pk(1, "Margarine", "misc", null)];
  const r = L.parseQuickFill(`[
    {"name":"margarine","kind":"misc","date":null},
    {"name":"Ketchup","kind":"misc","date":null,"noDate":true},
    {"name":"Eggs","kind":"misc","date":null}
  ]`, TODAY, packs);
  assert.deepEqual(r.items.map(i => [i.name, i.ok, i.noDate]), [
    ["Margarine", true, true],
    ["Ketchup", true, true],
    ["Eggs", false, false],
  ]);
  assert.equal(r.items[2].problem, "Needs a date");
});

test("CLAUDE_PROMPT mentions veg and noDate", () => {
  assert.match(L.CLAUDE_PROMPT, /"veg"/);
  assert.match(L.CLAUDE_PROMPT, /noDate/);
});

// ---------- Photo check JSON: name, sub, date, price (+ bb, packs) ----------

test("Potatoes is a veg starter, not a side", () => {
  assert.ok(L.STARTERS.veg.includes("Potatoes"));
  assert.ok(!L.STARTERS.side.includes("Potatoes"));
});

test("rememberedKind: latest pack's kind, else the starter lists, else null", () => {
  const packs = [
    pk(1, "Halloumi", "side", "2026-10-09", { added: "2026-09-01" }),
    pk(2, "halloumi", "misc", "2026-10-20", { added: "2026-10-01" }),
    pk(3, "Quiche", "main", "2026-10-09", { status: "deleted" }),
  ];
  assert.equal(L.rememberedKind(packs, "HALLOUMI "), "misc");
  assert.equal(L.rememberedKind(packs, "Chicken"), "main");   // starter
  assert.equal(L.rememberedKind(packs, "potatoes"), "veg");   // starter, any case
  assert.equal(L.rememberedKind(packs, "Quiche"), null);      // deleted packs don't count
  assert.equal(L.rememberedKind(packs, "Dragonfruit"), null);
});

test("boughtCount: packs ever added with that name (not deleted)", () => {
  const packs = [
    pk(1, "Chicken", "main", "2026-10-09", { status: "used" }),
    pk(2, "chicken", "main", "2026-10-12"),
    pk(3, "Chicken", "main", "2026-10-12", { status: "frozen" }),
    pk(4, "Chicken", "main", "2026-10-12", { status: "deleted" }),
  ];
  assert.equal(L.boughtCount(packs, "Chicken"), 3);
  assert.equal(L.boughtCount(packs, "Eggs"), 0);
});

test("quick fill: photo JSON with no kind uses the remembered kind", () => {
  const r = L.parseQuickFill(`[
    {"name":"Chicken","sub":"Asda chicken breasts","date":"2026-10-12","price":3.5},
    {"name":"Milk","sub":"Cravendale 2L","date":"2026-10-15","bb":true},
    {"name":"Mince","sub":"Tesco beef mince 5%","date":"2026-10-10","packs":3}
  ]`, TODAY, []);
  assert.deepEqual(r.items.map(i => [i.name, i.kind, i.date, i.dateType, i.count, i.sub, i.price, i.ok]), [
    ["Chicken", "main", "2026-10-12", "use_by", 1, "Asda chicken breasts", 3.5, true],
    ["Milk", "misc", "2026-10-15", "best_before", 1, "Cravendale 2L", null, true],
    ["Mince", "main", "2026-10-10", "use_by", 3, "Tesco beef mince 5%", null, true],
  ]);
});

test("quick fill: a new food asks for its kind, then works once picked", () => {
  const r = L.parseQuickFill(`[{"name":"Halloumi","date":"2026-10-20"}]`, TODAY, []);
  const item = r.items[0];
  assert.equal(item.ok, false);
  assert.equal(item.needsKind, true);
  assert.equal(item.problem, "Pick a kind");
  const fixed = L.quickFillRow({ ...item.raw, kind: "misc" }, []);
  assert.equal(fixed.ok, true);
  assert.equal(fixed.kind, "misc");
  assert.equal(fixed.needsKind, false);
});

test("quick fill: veg and remembered no-date foods ignore any date sent", () => {
  const packs = [pk(1, "Margarine", "misc", null)];
  const r = L.parseQuickFill(`[
    {"name":"Potatoes","date":"2026-10-30"},
    {"name":"Margarine","sub":"Flora 500g","date":"2027-01-01"},
    {"name":"Leeks"}
  ]`, TODAY, packs);
  assert.deepEqual(r.items.map(i => [i.name, i.kind, i.date, i.dateType, i.noDate, i.ok]), [
    ["Potatoes", "veg", null, null, true, true],
    ["Margarine", "misc", null, null, true, true],
    ["Leeks", "veg", null, null, true, true],
  ]);
});

test("quick fill: price reads numbers and '£3.50', ignores junk", () => {
  const r = L.parseQuickFill(`[
    {"name":"Chicken","date":"2026-10-12","price":"£3.50"},
    {"name":"Chicken","date":"2026-10-12","price":"cheap"},
    {"name":"Chicken","date":"2026-10-12","price":-2}
  ]`, TODAY);
  assert.deepEqual(r.items.map(i => i.price), [3.5, null, null]);
});

test("makePacks keeps sub and price on every pack (null when missing)", () => {
  const out = L.makePacks({ name: "Chicken", kind: "main", date: "2026-10-12", count: 2, sub: "Asda chicken breasts", price: 3.5 }, TODAY);
  assert.deepEqual(out.map(p => [p.sub, p.price]), [["Asda chicken breasts", 3.5], ["Asda chicken breasts", 3.5]]);
  const [p] = L.makePacks({ name: "Eggs", kind: "misc", date: "2026-10-20", count: 1 }, TODAY);
  assert.equal(p.sub, null);
  assert.equal(p.price, null);
});

test("CLAUDE_PROMPT asks for name, sub, date, price, bb and packs", () => {
  for (const word of ['"name"', '"sub"', '"date"', '"price"', '"bb"', '"packs"']) {
    assert.ok(L.CLAUDE_PROMPT.includes(word), word);
  }
});
