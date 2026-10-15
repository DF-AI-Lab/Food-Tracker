// Demo keeps its own household pointer (Darren, 2026-10-15) — run with: npm test
// One Google account can be in the live household AND the demo household at once:
// live reads users/{uid}.householdId, the demo reads users/{uid}.demoHouseholdId.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = dir => import(pathToFileURL(path.join(__dirname, "..", dir, "js", "household.js")).href);

// A tiny in-memory Firestore with the calls household.js uses
function fakeFirestore() {
  const store = new Map();
  let n = 0;
  const F = {
    collection: (db, ...p) => ({ path: p.join("/") }),
    doc: (a, ...p) => (p.length ? { path: [a.path, ...p].filter(Boolean).join("/") } : { path: `${a.path}/auto${++n}`, id: `auto${n}` }),
    async getDoc(ref) {
      const d = store.get(ref.path);
      return { exists: () => !!d, data: () => d };
    },
    async setDoc(ref, data, opts) {
      store.set(ref.path, opts && opts.merge ? { ...(store.get(ref.path) || {}), ...data } : { ...data });
    },
    async updateDoc(ref, data) {
      const d = { ...store.get(ref.path) };
      for (const [k, v] of Object.entries(data)) {
        if (k === "members") d.members = [...new Set([...(d.members || []), ...v.add])];
        else if (k.startsWith("names.")) d.names = { ...d.names, [k.slice(6)]: v };
        else d[k] = v;
      }
      store.set(ref.path, d);
    },
    arrayUnion: (...v) => ({ add: v }),
    Timestamp: { now: () => 0, fromMillis: ms => ({ toMillis: () => ms }) },
  };
  const db = { path: "" };
  // doc(db, "users", uid) style: first arg is db
  const doc = F.doc;
  F.doc = (a, ...p) => (a === db ? { path: p.join("/") } : doc(a, ...p));
  F.collection = (d, ...p) => ({ path: p.join("/") });
  return { F, db, store };
}

const me = { uid: "me", displayName: "Darren" };

test("live and demo can each be in a different household for the same person", async () => {
  const live = await load("v2");
  const demo = await load("v2-next");
  const { F, db, store } = fakeFirestore();

  const demoId = await demo.createHousehold(F, db, me, "Home test");
  // Someone else's live household, joined with an invite
  store.set("households/ff", { name: "Home FF", members: ["other"], names: { other: "DF #2" } });
  store.set("invites/ABCD2345", { householdId: "ff", expires: { toMillis: () => Date.now() + 1e6 } });
  await live.joinHousehold(F, db, me, "ABCD2345");

  assert.equal((await live.myHousehold(F, db, "me")).name, "Home FF");
  assert.equal((await demo.myHousehold(F, db, "me")).id, demoId);
  assert.equal((await demo.myHousehold(F, db, "me")).name, "Home test");
});

test("demo with no pointer of its own yet keeps the household it already had", async () => {
  const live = await load("v2");
  const demo = await load("v2-next");
  const { F, db, store } = fakeFirestore();
  // Before this change: the one shared pointer is on the demo's household
  store.set("households/test", { name: "Home test", members: ["me"], names: { me: "Darren" } });
  store.set("users/me", { householdId: "test" });

  assert.equal((await demo.myHousehold(F, db, "me")).name, "Home test");
  assert.equal(store.get("users/me").demoHouseholdId, "test", "demo saves its own pointer");

  // Now live joins another household: the demo stays put
  store.set("households/ff", { name: "Home FF", members: ["other"], names: {} });
  store.set("invites/ABCD2345", { householdId: "ff", expires: { toMillis: () => Date.now() + 1e6 } });
  await live.joinHousehold(F, db, me, "ABCD2345");
  assert.equal((await live.myHousehold(F, db, "me")).name, "Home FF");
  assert.equal((await demo.myHousehold(F, db, "me")).name, "Home test");
});

test("demo joining or making a household never moves live", async () => {
  const live = await load("v2");
  const demo = await load("v2-next");
  const { F, db, store } = fakeFirestore();
  store.set("households/ff", { name: "Home FF", members: ["me"], names: { me: "Darren" } });
  store.set("users/me", { householdId: "ff", demoHouseholdId: "x" });

  await demo.createHousehold(F, db, me, "Demo 2");
  assert.equal((await live.myHousehold(F, db, "me")).name, "Home FF");
  assert.equal((await demo.myHousehold(F, db, "me")).name, "Demo 2");
});
