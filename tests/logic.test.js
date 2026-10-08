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

test("parseQuickFill: veg means a side, freezer flag kept", () => {
  const r = L.parseQuickFill('[{"name":"Peas","kind":"veg","date":null},{"name":"Mince","kind":"main","date":"2026-10-09","freezer":true}]', TODAY);
  assert.equal(r.items[0].kind, "side");
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
  assert.match(r.items[1].problem, /main, side or misc/i);
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

// ---------- meal planner ----------

const fp = (id, name, kind, date, extra = {}) => ({ id, name, kind, date, dateType: date ? "use_by" : null,
  status: "in_fridge", added: "2026-10-03", left: null, frozen: null, ...extra });

test("weekDays gives Mon..Sun of today's week", () => {
  assert.deepEqual(L.weekDays(TODAY), ["2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09","2026-10-10","2026-10-11"]);
  assert.equal(L.weekDays("2026-10-11")[0], "2026-10-05"); // Sunday belongs to the week starting Monday
});

test("mealPick: one row per food, soonest unplanned pack, with count; veg = undated sides", () => {
  const packs = [fp(1,"Sausages","main","2026-10-10"), fp(2,"Sausages","main","2026-10-08"),
    fp(3,"Chicken","main","2026-10-12"), fp(4,"Gammon","main","2026-10-06", { plannedFor: "2026-10-08", slot: "main" }),
    fp(5,"Coleslaw","side","2026-10-09"), fp(6,"Peas","side",null, { added: "2026-10-01" }),
    fp(7,"Milk","misc","2026-10-09"), fp(8,"Bacon","main","2026-10-09", { status: "frozen" })];
  const mains = L.mealPick(packs, "main");
  assert.deepEqual(mains.map(r => [r.name, r.pack.id, r.count]), [["Sausages", 2, 2], ["Chicken", 3, 1]]);
  assert.deepEqual(L.mealPick(packs, "side").map(r => r.name), ["Coleslaw"]);
  assert.deepEqual(L.mealPick(packs, "veg").map(r => r.name), ["Peas"]);
});

test("planPack / unplanPack set and clear the day and slot", () => {
  const p = fp(1, "Sausages", "main", "2026-10-10");
  const q = L.planPack(p, "2026-10-09", "main");
  assert.equal(q.plannedFor, "2026-10-09"); assert.equal(q.slot, "main"); assert.equal(p.plannedFor, undefined);
  const r = L.unplanPack(q);
  assert.equal(r.plannedFor, null); assert.equal(r.slot, null);
});

test("outByDay: how many days out of date a pack is on a planned day (0 if fine)", () => {
  assert.equal(L.outByDay(fp(1,"Salmon","main","2026-10-06"), "2026-10-09"), 3);
  assert.equal(L.outByDay(fp(1,"Salmon","main","2026-10-09"), "2026-10-09"), 0);
  assert.equal(L.outByDay(fp(1,"Peas","side",null), "2026-10-09"), 0);
});

test("dayMeals lists a day's plan as main, side, veg; takeaway counts as the main", () => {
  const packs = [fp(1,"Peas","side",null, { plannedFor: "2026-10-09", slot: "veg" }),
    fp(2,"Coleslaw","side","2026-10-10", { plannedFor: "2026-10-09", slot: "side" }),
    fp(3,"Chicken","main","2026-10-12", { plannedFor: "2026-10-09", slot: "main" }),
    fp(4,"Ham","main","2026-10-12", { plannedFor: "2026-10-09", slot: "main", status: "used" }),
    L.makeTakeaway("2026-10-10")];
  assert.deepEqual(L.dayMeals(packs, "2026-10-09").map(p => p.name), ["Chicken", "Coleslaw", "Peas"]);
  const sat = L.dayMeals(packs, "2026-10-10");
  assert.equal(sat.length, 1); assert.equal(sat[0].kind, "takeaway"); assert.equal(sat[0].slot, "main");
});

test("takeaway records never show up as food", () => {
  const packs = [L.makeTakeaway("2026-10-10")];
  const v = L.fridgeView(packs, TODAY);
  assert.equal(v.mainCount + v.sideCount, 0);
  assert.equal(L.mealPick(packs, "main").length, 0);
  assert.ok(!L.usuals(packs, "main").some(n => /takeaway/i.test(n)));
  assert.equal(L.usedSummary(packs, TODAY).list.length, 0);
});

// ---------- shopping list ----------

const si = (id, name, extra = {}) => ({ id, name, got: false, del: null, auto: null, added: "2026-10-07", ...extra });

test("shopOrder: to-get first (newest first), then got, then deleted from today/yesterday; older deletes hidden", () => {
  const items = [si(1, "Milk", { added: "2026-10-05" }), si(2, "Eggs", { got: true }), si(3, "Bread", { added: "2026-10-07" }),
    si(4, "Cola", { del: "2026-10-07" }), si(5, "Crisps", { del: "2026-10-05" })];
  assert.deepEqual(L.shopOrder(items, TODAY).map(i => i.name), ["Bread", "Milk", "Eggs", "Cola"]);
  assert.deepEqual(L.expiredShopDeletes(items, TODAY).map(i => i.id), [5]);
});

test("timesBought counts packs of that name (not deleted, not takeaway)", () => {
  const packs = [fp(1,"Milk","misc","2026-10-01",{status:"used"}), fp(2,"Milk","misc","2026-10-09"),
    fp(3,"Milk","misc","2026-10-09",{status:"deleted"}), L.makeTakeaway("2026-10-08")];
  assert.equal(L.timesBought(packs, "Milk"), 2);
});

test("boughtBefore: names by tab, most bought first (veg = undated sides, other = misc)", () => {
  const packs = [fp(1,"Chicken","main","2026-10-01"), fp(2,"Sausages","main","2026-10-01"), fp(3,"Sausages","main","2026-10-02"),
    fp(4,"Peas","side",null), fp(5,"Chips","side","2026-10-20"), fp(6,"Milk","misc","2026-10-09")];
  assert.deepEqual(L.boughtBefore(packs, "main"), ["Sausages", "Chicken"]);
  assert.deepEqual(L.boughtBefore(packs, "side"), ["Chips"]);
  assert.deepEqual(L.boughtBefore(packs, "veg"), ["Peas"]);
  assert.deepEqual(L.boughtBefore(packs, "other"), ["Milk"]);
});

test("ideas: best rated first, then most bought; unrated counts as 3; low = 1-2 stars", () => {
  const packs = [fp(1,"Sausages","main","2026-10-01"), fp(2,"Sausages","main","2026-10-01"), fp(3,"Chicken","main","2026-10-01"),
    fp(4,"Mince","main","2026-10-01"), fp(5,"Mince","main","2026-10-01"), fp(6,"Mince","main","2026-10-01")];
  const rows = L.ideas(packs, { Chicken: 5, Mince: 1 }, "main");
  assert.deepEqual(rows.map(r => [r.name, r.count, r.rating, r.low]),
    [["Chicken", 1, 5, false], ["Sausages", 2, 3, false], ["Mince", 3, 1, true]]);
});

test("autoOnFinish: misc used or thrown away goes on the list with a reason; others don't", () => {
  assert.deepEqual(L.autoOnFinish(fp(1,"Milk","misc","2026-10-09"), "used"), { name: "Milk", auto: "used up" });
  assert.deepEqual(L.autoOnFinish(fp(1,"Milk","misc","2026-10-09"), "thrown_away"), { name: "Milk", auto: "thrown away" });
  assert.equal(L.autoOnFinish(fp(1,"Ham","main","2026-10-09"), "used"), null);
});

test("autoOutOfDate: misc packs 1-2 days out, not already on the list", () => {
  const packs = [fp(1,"Eggs","misc","2026-10-06"), fp(2,"Cheese","misc","2026-10-05"), fp(3,"Butter","misc","2026-10-04"),
    fp(4,"Yoghurt","misc","2026-10-06"), fp(5,"Ham","main","2026-10-06")];
  const items = [si(1, "Yoghurt")];
  assert.deepEqual(L.autoOutOfDate(packs, items, TODAY), [{ name: "Eggs", auto: "1 day out" }, { name: "Cheese", auto: "2 days out" }]);
});
