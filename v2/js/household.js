// V2 step 3: sign-in and household. Pure helpers plus Firestore calls.
// F (the Firestore API) and db (the database) are passed in, so this file has no imports.

const DAY = 24 * 3600 * 1000;

// No 0/O or 1/I/L, so codes are easy to read out and type
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SAME_MESSAGE = "That code is wrong or has run out";

// A random 8 character invite code
export function makeCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  }
  return code;
}

// Tidy what someone typed: capitals, no spaces or dashes
export function normaliseCode(s) {
  return String(s).toUpperCase().replace(/[\s-]/g, "");
}

// The link a household shares (or the QR code made from it)
export function inviteLink(code, base) {
  return `${base}?join=${code}`;
}

// The code from a link like ...?join=ABCD2345, or null if there is none
export function codeFromUrl(url) {
  try {
    const code = new URL(url).searchParams.get("join");
    return code ? normaliseCode(code) : null;
  } catch (e) {
    return null;
  }
}

// Make a new household with this user as its only member.
// The household is written first, so the user record never points at a missing one.
export async function createHousehold(F, db, user, name) {
  const ref = F.doc(F.collection(db, "households"));
  await F.setDoc(ref, {
    name,
    members: [user.uid],
    names: { [user.uid]: user.displayName || "Someone" },
    created: F.Timestamp.now(),
  });
  await F.setDoc(F.doc(db, "users", user.uid), { householdId: ref.id });
  return ref.id;
}

// The household this user is in, or null if they are not in one (or cannot read it)
export async function myHousehold(F, db, uid) {
  const userSnap = await F.getDoc(F.doc(db, "users", uid));
  if (!userSnap.exists()) return null;

  const id = userSnap.data().householdId;
  if (!id) return null;

  let data;
  try {
    const snap = await F.getDoc(F.doc(db, "households", id));
    if (!snap.exists()) return null;
    data = snap.data();
  } catch (e) {
    // Rules refuse the read when the user is not a member
    return null;
  }

  if (!data.members || !data.members.includes(uid)) return null;

  const names = data.names || {};
  return {
    id,
    name: data.name,
    members: data.members.map(m => ({ uid: m, name: names[m] || "Someone" })),
  };
}

// Make a code that lets someone join. It lasts 24 hours from now.
export async function createInvite(F, db, householdId, now = Date.now()) {
  const code = makeCode();
  const expires = F.Timestamp.fromMillis(now + DAY);
  await F.setDoc(F.doc(db, "invites", code), { householdId, expires });
  return { code, expires: expires.toMillis() };
}

// Join the household behind a code. Returns the household id.
export async function joinHousehold(F, db, user, code) {
  const clean = normaliseCode(code);

  let invite;
  try {
    invite = await F.getDoc(F.doc(db, "invites", clean));
  } catch (e) {
    throw new Error(SAME_MESSAGE);
  }
  if (!invite.exists() || invite.data().expires.toMillis() <= Date.now()) {
    throw new Error(SAME_MESSAGE);
  }

  const householdId = invite.data().householdId;
  try {
    await F.updateDoc(F.doc(db, "households", householdId), {
      members: F.arrayUnion(user.uid),
      [`names.${user.uid}`]: user.displayName || "Someone",
      joinedWith: clean,
    });
  } catch (e) {
    // The rules refuse this if the code is for another household or has expired
    throw new Error(SAME_MESSAGE);
  }

  await F.setDoc(F.doc(db, "users", user.uid), { householdId });
  return householdId;
}

// Remove a member from the household (any member can do this)
export async function removeMember(F, db, householdId, uid) {
  await F.updateDoc(F.doc(db, "households", householdId), {
    members: F.arrayRemove(uid),
    [`names.${uid}`]: F.deleteField(),
  });
}
