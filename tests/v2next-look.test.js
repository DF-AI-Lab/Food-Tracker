// V2.5 The Look (issue #76): pure display helpers in v2-next/js/look.js — run with: npm test
// The look changes, the logic does not: these only turn existing data into words, % and colours.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const LOOK = require(path.join(__dirname, "..", "v2-next", "js", "look.js"));
const TODAY = "2026-10-10"; // Sat 10 Oct
const day = n => {
  const d = new Date(TODAY + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test("freshness line = 5-day countdown, min 5%, max 100%, out of date full", () => {
  assert.equal(LOOK.freshPct(0), 5);
  assert.equal(LOOK.freshPct(1), 20);
  assert.equal(LOOK.freshPct(2), 40);
  assert.equal(LOOK.freshPct(4), 80);
  assert.equal(LOOK.freshPct(5), 100);
  assert.equal(LOOK.freshPct(11), 100);
  assert.equal(LOOK.freshPct(-1), 100);
});

test("freshness state: 2 days or less = soon (amber), past = out", () => {
  assert.equal(LOOK.freshState(day(3), TODAY), "ok");
  assert.equal(LOOK.freshState(day(2), TODAY), "soon");
  assert.equal(LOOK.freshState(day(0), TODAY), "soon");
  assert.equal(LOOK.freshState(day(-1), TODAY), "out");
});

test("row date words: Today / 1 day / 2 days, else date · N days, past = N days out", () => {
  assert.deepEqual(LOOK.whenParts(day(0), TODAY), { main: "Today", sub: "" });
  assert.deepEqual(LOOK.whenParts(day(1), TODAY), { main: "1 day", sub: "" });
  assert.deepEqual(LOOK.whenParts(day(2), TODAY), { main: "2 days", sub: "" });
  assert.deepEqual(LOOK.whenParts(day(6), TODAY), { main: "Fri 16 Oct", sub: "6 days" });
  assert.deepEqual(LOOK.whenParts(day(-1), TODAY), { main: "1 day out", sub: "" });
  assert.deepEqual(LOOK.whenParts(day(-3), TODAY), { main: "3 days out", sub: "" });
});

test("freezer age line: full at 90 days, min 6%", () => {
  assert.equal(LOOK.freezerPct(0), 6);
  assert.equal(LOOK.freezerPct(45), 50);
  assert.equal(LOOK.freezerPct(90), 100);
  assert.equal(LOOK.freezerPct(200), 100);
});

test("freezer colour blends light blue -> dark blue over 90 days", () => {
  assert.equal(LOOK.freezerColour(0), "#bfe3ff");
  assert.equal(LOOK.freezerColour(90), "#2f6fa8");
  assert.equal(LOOK.freezerColour(500), "#2f6fa8");
  const mid = LOOK.freezerColour(45);
  assert.match(mid, /^#[0-9a-f]{6}$/);
  assert.notEqual(mid, "#bfe3ff");
  assert.notEqual(mid, "#2f6fa8");
});

test("frozen label reads 'Frozen 2 Sep · 5 wks'", () => {
  assert.equal(LOOK.frozenText("in 2 Sep · 5 wks"), "Frozen 2 Sep · 5 wks");
  assert.equal(LOOK.frozenText("Frozen 2 Sep"), "Frozen 2 Sep");
});

const pack = (id, name, d, extra = {}) => ({ id, name, kind: "main", status: "in_fridge", date: day(d), added: day(-3), ...extra });

test("eat first: the existing use-soon packs, top 3 soonest, with a time word", () => {
  const packs = [
    pack("a", "Pastry", 1),
    pack("b", "Chicken", 0),
    pack("c", "Ham", 2),
    pack("d", "Milk", -1),
    pack("e", "Mince", 5),                       // not soon
    pack("f", "Peas", 0, { status: "frozen" }),  // not in fridge
  ];
  const ef = LOOK.eatFirst(packs, TODAY);
  assert.deepEqual(ef.lines.map(l => [l.id, l.name, l.word, l.state]), [
    ["d", "Milk", "out of date", "out"],
    ["b", "Chicken", "today", "soon"],
    ["a", "Pastry", "tomorrow", "soon"],
  ]);
  assert.equal(ef.more, 1);
});

test("eat first: nothing soon = no lines (card hidden)", () => {
  const ef = LOOK.eatFirst([pack("e", "Mince", 5)], TODAY);
  assert.deepEqual(ef.lines, []);
  assert.equal(ef.more, 0);
  assert.equal(ef.sub, "");
});

test("eat first sub-line only says 'tonight's plan' when it is true", () => {
  const planned = { plannedFor: TODAY };
  assert.equal(LOOK.eatFirst([pack("a", "Chicken", 0, planned)], TODAY).sub, "On tonight's plan");
  assert.equal(LOOK.eatFirst([pack("a", "Chicken", 0, planned), pack("b", "Pastry", 1, planned)], TODAY).sub,
    "Both on tonight's plan");
  assert.equal(LOOK.eatFirst([pack("a", "Chicken", 0, planned), pack("b", "Pastry", 1)], TODAY).sub,
    "Chicken is on tonight's plan");
  assert.equal(LOOK.eatFirst([pack("a", "Chicken", 0), pack("b", "Pastry", 1, { plannedFor: day(1) })], TODAY).sub, "");
});

test("sync words without emoji", () => {
  assert.deepEqual(LOOK.syncText({ online: true, waiting: 0 }), { text: "Synced", state: "ok" });
  assert.deepEqual(LOOK.syncText({ online: true, waiting: 2 }), { text: "2 waiting", state: "wait" });
  assert.deepEqual(LOOK.syncText({ online: false, waiting: 0 }), { text: "Offline", state: "off" });
  assert.deepEqual(LOOK.syncText({ online: false, waiting: 3 }), { text: "Offline · 3 waiting", state: "off" });
});

test("bell label for screen readers", () => {
  assert.equal(LOOK.bellLabel(0), "Notifications");
  assert.equal(LOOK.bellLabel(1), "Notifications, 1 new");
  assert.equal(LOOK.bellLabel(4), "Notifications, 4 new");
});

test("initials for member and household tiles", () => {
  assert.equal(LOOK.initials("Darren Fawcett"), "DF");
  assert.equal(LOOK.initials("home ff"), "HF");
  assert.equal(LOOK.initials("Darren"), "DA");
  assert.equal(LOOK.initials("  "), "?");
});
