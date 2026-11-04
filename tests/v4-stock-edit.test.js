// Stock check Edit box: change the amount and fix the section (Darren 2026-11-04) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

for (const dir of ["demo", "live"]) {
  const FT = require(`../${dir}/js/logic.js`);
  const base = { id: "a1", name: "Sausages", kind: "main", status: "in_fridge", date: "2026-11-04", dateType: "use_by",
    added: "2026-11-01", left: null, frozen: null, sub: "Pork", price: 3 };

  test(`${dir} stockMove: to another fridge section only changes the kind`, () => {
    const out = FT.stockMove(base, "side", "2026-11-04");
    assert.equal(out.kind, "side");
    assert.equal(out.status, "in_fridge");
    assert.equal(out.date, "2026-11-04");
    assert.equal(out.id, "a1");
    assert.equal(base.kind, "main"); // not changed in place
  });

  test(`${dir} stockMove: to the freezer freezes it today, kind kept`, () => {
    const out = FT.stockMove(base, "freezer", "2026-11-04");
    assert.equal(out.status, "frozen");
    assert.equal(out.frozen, "2026-11-04");
    assert.equal(out.kind, "main");
  });

  test(`${dir} stockMove: out of the freezer (it was a mistake) back in the fridge, date kept`, () => {
    const frozen = { ...base, status: "frozen", frozen: "2026-10-01" };
    const out = FT.stockMove(frozen, "veg", "2026-11-04");
    assert.equal(out.status, "in_fridge");
    assert.equal(out.frozen, null);
    assert.equal(out.kind, "veg");
    assert.equal(out.date, "2026-11-04");
  });

  test(`${dir} stockMove: same section gives back the same pack; a bad section throws`, () => {
    assert.equal(FT.stockMove(base, "main", "2026-11-04"), base);
    const frozen = { ...base, status: "frozen", frozen: "2026-10-01" };
    assert.equal(FT.stockMove(frozen, "freezer", "2026-11-04"), frozen);
    assert.throws(() => FT.stockMove(base, "takeaway", "2026-11-04"));
  });

  test(`${dir} stockCopy: one more of the same, new (no id), added today`, () => {
    const out = FT.stockCopy(base, "2026-11-05");
    assert.equal(out.id, undefined);
    assert.equal(out.name, "Sausages");
    assert.equal(out.kind, "main");
    assert.equal(out.status, "in_fridge");
    assert.equal(out.date, "2026-11-04");
    assert.equal(out.dateType, "use_by");
    assert.equal(out.sub, "Pork");
    assert.equal(out.price, 3);
    assert.equal(out.added, "2026-11-05");
    assert.equal(out.left, null);
    const fz = FT.stockCopy({ ...base, status: "frozen", frozen: "2026-10-01" }, "2026-11-05");
    assert.equal(fz.status, "frozen");
    assert.equal(fz.frozen, "2026-10-01");
  });
}
