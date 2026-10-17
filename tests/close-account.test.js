// "Close my account" (Darren 2026-10-17): leave the household (food stays for the others),
// delete your users/{uid} record. Live (live/) and the V4 demo (demo/). — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function fake() {
  const store = new Map();
  const db = { tag: "db" };
  const F = {
    doc: (d, ...p) => ({ path: p.join("/") }),
    async updateDoc(ref, data) {
      const d = { ...store.get(ref.path) };
      for (const [k, v] of Object.entries(data)) {
        if (k === "members" && v && v.remove) d.members = d.members.filter(m => m !== v.remove);
        else if (k.startsWith("names.") && v === "DELETE") { d.names = { ...d.names }; delete d.names[k.slice(6)]; }
        else d[k] = v;
      }
      store.set(ref.path, d);
    },
    async deleteDoc(ref) { store.delete(ref.path); },
    arrayRemove: v => ({ remove: v }),
    deleteField: () => "DELETE",
  };
  return { F, db, store };
}

for (const dir of ["live", "demo"]) {
  const load = () => import(pathToFileURL(path.join(__dirname, "..", dir, "js", "household.js")).href);

  test(`${dir}: close account with others in the household: you leave, the household stays, your record goes`, async () => {
    const { closeAccount } = await load();
    const { F, db, store } = fake();
    store.set("households/h1", { members: ["me", "mum"], names: { me: "Darren", mum: "Mum" } });
    store.set("users/me", { householdId: "h1" });
    const out = await closeAccount(F, db, { uid: "me" }, { id: "h1", members: [{ uid: "me" }, { uid: "mum" }] });
    assert.deepEqual(store.get("households/h1").members, ["mum"]);
    assert.deepEqual(store.get("households/h1").names, { mum: "Mum" });
    assert.equal(store.has("users/me"), false);
    assert.equal(out.leftHousehold, true);
  });

  test(`${dir}: close account when you are the only one: the household is left as it is (never emptied)`, async () => {
    const { closeAccount } = await load();
    const { F, db, store } = fake();
    store.set("households/h1", { members: ["me"], names: { me: "Darren" } });
    store.set("users/me", { householdId: "h1" });
    const out = await closeAccount(F, db, { uid: "me" }, { id: "h1", members: [{ uid: "me" }] });
    assert.deepEqual(store.get("households/h1").members, ["me"]);
    assert.equal(store.has("users/me"), false);
    assert.equal(out.leftHousehold, false);
  });

  test(`${dir}: Settings has a Close my account button`, () => {
    const fs = require("node:fs");
    const html = fs.readFileSync(path.join(__dirname, "..", dir, "index.html"), "utf8");
    assert.match(html, /id="closeAccount"[^>]*>[\s\S]*?Close my account/);
    assert.match(fs.readFileSync(path.join(__dirname, "..", dir, "js", "account.js"), "utf8"), /closeAccount\(/);
  });
}
