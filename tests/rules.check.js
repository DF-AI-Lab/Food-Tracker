// Security rules tests (V2 step 3), run against the Firestore emulator:
//   npm run check:rules
// Only members of a household can read or write it. Strangers see nothing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment, assertSucceeds, assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc,
  arrayUnion, arrayRemove, deleteField, Timestamp,
} = require("firebase/firestore");

let env;
const H = "home1";
const hour = 3600 * 1000;
const later = () => Timestamp.fromMillis(Date.now() + 24 * hour);
const earlier = () => Timestamp.fromMillis(Date.now() - hour);

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-food-tracker",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
});
test.after(async () => env && env.cleanup());

// Fresh data before every test: alice owns home1 (bob is not in it), invite ABCD2345 is valid, OLD23456 is expired
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "households", H), { name: "Home", members: ["alice"], names: { alice: "Alice" } });
    await setDoc(doc(db, "households", H, "packs", "p1"), { name: "Chicken" });
    await setDoc(doc(db, "users", "alice"), { householdId: H });
    await setDoc(doc(db, "invites", "ABCD2345"), { householdId: H, expires: later() });
    await setDoc(doc(db, "invites", "OLD23456"), { householdId: H, expires: earlier() });
  });
});

const as = uid => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

// ---------- households ----------

test("member can read the household and its lists", async () => {
  await assertSucceeds(getDoc(doc(as("alice"), "households", H)));
  await assertSucceeds(getDoc(doc(as("alice"), "households", H, "packs", "p1")));
  await assertSucceeds(getDocs(collection(as("alice"), "households", H, "packs")));
});

test("member can write the household's lists", async () => {
  await assertSucceeds(addDoc(collection(as("alice"), "households", H, "packs"), { name: "Milk" }));
  await assertSucceeds(updateDoc(doc(as("alice"), "households", H, "packs", "p1"), { name: "Ham" }));
  await assertSucceeds(deleteDoc(doc(as("alice"), "households", H, "packs", "p1")));
  await assertSucceeds(setDoc(doc(as("alice"), "households", H, "inbox", "i1"), { name: "Eggs" }));
});

test("stranger cannot read or write anything in the household", async () => {
  await assertFails(getDoc(doc(as("bob"), "households", H)));
  await assertFails(getDoc(doc(as("bob"), "households", H, "packs", "p1")));
  await assertFails(getDocs(collection(as("bob"), "households", H, "packs")));
  await assertFails(addDoc(collection(as("bob"), "households", H, "packs"), { name: "X" }));
  await assertFails(updateDoc(doc(as("bob"), "households", H), { name: "Mine now" }));
});

test("signed-out user sees nothing", async () => {
  await assertFails(getDoc(doc(anon(), "households", H)));
  await assertFails(getDoc(doc(anon(), "households", H, "packs", "p1")));
  await assertFails(getDoc(doc(anon(), "invites", "ABCD2345")));
  await assertFails(getDoc(doc(anon(), "users", "alice")));
});

test("nobody can list all households", async () => {
  await assertFails(getDocs(collection(as("alice"), "households")));
  await assertFails(getDocs(collection(as("bob"), "households")));
});

test("anyone signed in can create a household with only themselves in it", async () => {
  await assertSucceeds(setDoc(doc(as("bob"), "households", "home2"),
    { name: "Bob's", members: ["bob"], names: { bob: "Bob" } }));
});

test("cannot create a household that adds someone else", async () => {
  await assertFails(setDoc(doc(as("bob"), "households", "home3"),
    { name: "X", members: ["bob", "alice"], names: { bob: "Bob" } }));
  await assertFails(setDoc(doc(as("bob"), "households", "home4"),
    { name: "X", members: ["alice"], names: {} }));
});

test("member can rename the household and remove another member", async () => {
  await env.withSecurityRulesDisabled(async ctx =>
    updateDoc(doc(ctx.firestore(), "households", H), { members: ["alice", "carol"], "names.carol": "Carol" }));
  await assertSucceeds(updateDoc(doc(as("alice"), "households", H), { name: "Our home" }));
  await assertSucceeds(updateDoc(doc(as("alice"), "households", H),
    { members: arrayRemove("carol"), "names.carol": deleteField() }));
});

test("cannot remove the last member (household would be locked forever)", async () => {
  await assertFails(updateDoc(doc(as("alice"), "households", H), { members: [] }));
});

test("nobody can delete a household", async () => {
  await assertFails(deleteDoc(doc(as("alice"), "households", H)));
});

// ---------- invites and joining ----------

test("member can make and delete an invite for their household", async () => {
  await assertSucceeds(setDoc(doc(as("alice"), "invites", "NEWC2345"), { householdId: H, expires: later() }));
  await assertSucceeds(deleteDoc(doc(as("alice"), "invites", "NEWC2345")));
});

test("stranger cannot make an invite for someone else's household", async () => {
  await assertFails(setDoc(doc(as("bob"), "invites", "EVIL2345"), { householdId: H, expires: later() }));
  await assertFails(deleteDoc(doc(as("bob"), "invites", "ABCD2345")));
});

test("signed-in user can look up one invite by its code, but not list invites", async () => {
  await assertSucceeds(getDoc(doc(as("bob"), "invites", "ABCD2345")));
  await assertFails(getDocs(collection(as("bob"), "invites")));
});

const join = (uid, code, extra = {}) => updateDoc(doc(as(uid), "households", H), {
  members: arrayUnion(uid), [`names.${uid}`]: uid.toUpperCase(), joinedWith: code, ...extra,
});

test("with a valid invite code you can join (add only yourself)", async () => {
  await assertSucceeds(join("bob", "ABCD2345"));
  await assertSucceeds(getDoc(doc(as("bob"), "households", H, "packs", "p1")));
});

test("cannot join with an expired code", async () => {
  await assertFails(join("bob", "OLD23456"));
});

test("cannot join with a wrong code", async () => {
  await assertFails(join("bob", "NOPE2345"));
});

test("cannot join with a code for another household", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), "households", "home2"), { name: "Other", members: ["carol"], names: { carol: "C" } });
    await setDoc(doc(ctx.firestore(), "invites", "OTHR2345"), { householdId: "home2", expires: later() });
  });
  await assertFails(join("bob", "OTHR2345"));
});

test("joining cannot change anything else or add other people", async () => {
  await assertFails(join("bob", "ABCD2345", { name: "Hacked" }));
  await assertFails(updateDoc(doc(as("bob"), "households", H), {
    members: arrayUnion("bob", "eve"), "names.bob": "Bob", joinedWith: "ABCD2345",
  }));
  await assertFails(updateDoc(doc(as("bob"), "households", H), {
    members: ["bob"], "names.bob": "Bob", joinedWith: "ABCD2345",
  }));
  await assertFails(updateDoc(doc(as("bob"), "households", H), {
    members: arrayUnion("bob"), "names.alice": "Changed", joinedWith: "ABCD2345",
  }));
});

// ---------- users ----------

test("you can read and write only your own user record", async () => {
  await assertSucceeds(getDoc(doc(as("alice"), "users", "alice")));
  await assertSucceeds(setDoc(doc(as("bob"), "users", "bob"), { householdId: "home2" }));
  await assertFails(getDoc(doc(as("bob"), "users", "alice")));
  await assertFails(setDoc(doc(as("bob"), "users", "alice"), { householdId: "x" }));
});

test("a removed member loses access straight away", async () => {
  await assertSucceeds(join("bob", "ABCD2345"));
  await assertSucceeds(updateDoc(doc(as("alice"), "households", H),
    { members: arrayRemove("bob"), "names.bob": deleteField() }));
  await assertFails(getDoc(doc(as("bob"), "households", H)));
  await assertFails(getDoc(doc(as("bob"), "households", H, "packs", "p1")));
});

test("other top-level collections are closed", async () => {
  await assertFails(setDoc(doc(as("alice"), "secrets", "x"), { a: 1 }));
  await assertFails(getDoc(doc(as("alice"), "secrets", "x")));
});

test("sanity: the test data is there", async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    const snap = await getDoc(doc(ctx.firestore(), "households", H));
    assert.deepEqual(snap.data().members, ["alice"]);
  });
});
