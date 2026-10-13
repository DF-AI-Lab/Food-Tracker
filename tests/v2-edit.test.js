// V2 step 7a: edit a pack (name, sub, kind, date, date type, price) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const FT = require(path.join(__dirname, "..", "v2", "js", "logic.js"));

const pack = {
  id: "p1", name: "Chiken", sub: null, kind: "main", date: "2026-10-14", dateType: "use_by",
  status: "in_fridge", added: "2026-10-10", left: null, frozen: null, price: null, partUsed: false,
};

test("fixes the name and keeps everything not edited", () => {
  const out = FT.editPack(pack, { name: "  chicken " });
  assert.equal(out.name, "Chicken");
  assert.equal(out.id, "p1");
  assert.equal(out.status, "in_fridge");
  assert.equal(out.added, "2026-10-10");
  assert.equal(out.date, "2026-10-14");
  assert.notEqual(out, pack, "returns a new object");
  assert.equal(pack.name, "Chiken", "the original is untouched");
});

test("changes sub, kind, date, date type and price", () => {
  const out = FT.editPack(pack, {
    name: "Chicken", sub: " Asda breast ", kind: "side", date: "2026-10-16", dateType: "best_before", price: "3.50",
  });
  assert.equal(out.sub, "Asda breast");
  assert.equal(out.kind, "side");
  assert.equal(out.date, "2026-10-16");
  assert.equal(out.dateType, "best_before");
  assert.equal(out.price, 3.5);
});

test("price accepts £ and blanks", () => {
  assert.equal(FT.editPack(pack, { price: "£2.99" }).price, 2.99);
  assert.equal(FT.editPack(pack, { price: "" }).price, null);
  assert.equal(FT.editPack({ ...pack, price: 4 }, { price: null }).price, null);
});

test("blank sub becomes null", () => {
  assert.equal(FT.editPack({ ...pack, sub: "Asda" }, { sub: "  " }).sub, null);
});

test("removing the date is fine for veg and sides, and clears the date type", () => {
  const out = FT.editPack(pack, { kind: "veg", date: "" });
  assert.equal(out.date, null);
  assert.equal(out.dateType, null);
});

test("clear messages for bad input", () => {
  assert.throws(() => FT.editPack(pack, { name: "   " }), /Needs a name/);
  assert.throws(() => FT.editPack(pack, { kind: "pudding" }), /Kind must be main, side, veg, misc or cupboard/);
  assert.throws(() => FT.editPack(pack, { date: "2026-13-45" }), /Date must look like 2026-10-10/);
  assert.throws(() => FT.editPack(pack, { date: "" }), /Needs a date/, "mains need a date");
  assert.throws(() => FT.editPack(pack, { price: "cheap" }), /Price must be a number/);
  assert.throws(() => FT.editPack(pack, { price: "-1" }), /Price must be a number/);
});

test("a date given without a type is use by", () => {
  const out = FT.editPack({ ...pack, kind: "veg", date: null, dateType: null }, { date: "2026-10-20" });
  assert.equal(out.dateType, "use_by");
});
