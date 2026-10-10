// Sign-in gate, household and settings for V2 (step 3). Loaded after the classic scripts.
//   ?local=1          no sign-in, no Firebase: the in-memory app (checks)
//   ?emu=1&as=NAME    Firebase emulators, fake Google sign-in as NAME
import { firebaseConfig } from "./firebase-config.js";
import { myHousehold, createHousehold, joinHousehold, removeMember, createInvite, inviteLink, codeFromUrl } from "./household.js";

const CDN = "https://www.gstatic.com/firebasejs/12.19.0/";
const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

// app.js waits for this before it starts
let resolveReady;
window.FT_READY = new Promise(r => { resolveReady = r; });
// Who the running app belongs to (null until it starts)
let started = null;

if (params.get("local") === "1") {
  // Memory-only: no gate, no settings, nothing loaded from the network
  $("gate").hidden = true;
  $("settingsBtn").hidden = true;
  resolveReady();
} else {
  start().catch(e => { $("gateMsg").textContent = "Could not start: " + e.message; });
}

async function start() {
  const emu = params.get("emu") === "1";

  // Dynamic import: only fetched when not in local mode. Each namespace is the whole Firebase API.
  const [A, AU, F] = await Promise.all([
    import(CDN + "firebase-app.js"),
    import(CDN + "firebase-auth.js"),
    import(CDN + "firebase-firestore.js"),
  ]);

  const app = A.initializeApp(emu
    ? { apiKey: "fake-key", authDomain: "localhost", projectId: "demo-food-tracker" }
    : firebaseConfig);
  const auth = AU.getAuth(app);
  // Offline cache on, shared across open tabs: the app works without a signal
  const db = F.initializeFirestore(app, {
    localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
  });
  if (emu) {
    AU.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    F.connectFirestoreEmulator(db, "127.0.0.1", 8085);
  }

  // Button actions: gate errors show in #gateMsg, settings errors in an alert
  const onGate = fn => async () => {
    $("gateMsg").textContent = "";
    try { await fn(); } catch (e) { $("gateMsg").textContent = e.message; }
  };
  const onSettings = fn => async () => {
    try { await fn(); } catch (e) { alert(e.message); }
  };

  function showSignedOut() {
    // The app is running with the last person's data: start clean from the sign-in screen
    if (started) return location.reload();
    window.FT_HOUSEHOLD = null;
    $("settings").hidden = true;
    $("signIn").hidden = false;
    $("joinPart").hidden = true;
    $("gateMsg").textContent = "";
    $("gate").hidden = false;
  }

  function showJoin() {
    $("signIn").hidden = true;
    $("joinPart").hidden = false;
    $("gate").hidden = false;
  }

  // Signed in: open the app if this user is in a household, else offer make or join
  async function enter(user) {
    try {
      const h = await myHousehold(F, db, user.uid);
      if (!h) return showJoin();
      // The app is already running: a different person or household needs a clean start
      if (started) {
        if (started.uid !== user.uid || started.householdId !== h.id) return location.reload();
        return;
      }
      const { makeCloudDB } = await import("./db-firestore.js");
      window.DB = makeCloudDB(F, db, h.id, user.uid);
      started = { uid: user.uid, householdId: h.id };
      window.FT_HOUSEHOLD = h;
      $("gate").hidden = true;
      // The join code has been used: drop it from the address bar, keep other params
      const url = new URL(location.href);
      if (url.searchParams.has("join")) {
        url.searchParams.delete("join");
        history.replaceState(null, "", url);
      }
      resolveReady();
    } catch (e) {
      $("gateMsg").textContent = e.message;
    }
  }

  $("signIn").onclick = onGate(async () => {
    if (emu) {
      // Fake Google sign-in: the emulator accepts this JSON as the Google ID token
      const as = params.get("as") || "tester";
      const name = as.charAt(0).toUpperCase() + as.slice(1);
      const token = JSON.stringify({ sub: as, email: as + "@example.com", name });
      await AU.signInWithCredential(auth, AU.GoogleAuthProvider.credential(token));
      return;
    }
    try {
      await AU.signInWithPopup(auth, new AU.GoogleAuthProvider());
    } catch (e) {
      if (e.code !== "auth/popup-blocked") throw e;
      await AU.signInWithRedirect(auth, new AU.GoogleAuthProvider());
    }
  });

  $("makeHH").onclick = onGate(async () => {
    const user = auth.currentUser;
    await createHousehold(F, db, user, $("hhName").value.trim() || "Home");
    await enter(user);
  });

  $("joinBtn").onclick = onGate(async () => {
    const user = auth.currentUser;
    await joinHousehold(F, db, user, $("joinCode").value);
    await enter(user);
  });

  // Settings: re-read the household each time it opens
  async function openSettings() {
    const user = auth.currentUser;
    const h = await myHousehold(F, db, user.uid);
    if (!h) return enter(user);

    $("hhTitle").textContent = h.name;
    const list = $("members");
    list.innerHTML = "";
    for (const m of h.members) {
      const li = document.createElement("li");
      li.append(m.name);
      if (m.uid !== user.uid) { // no ❌ on yourself
        const x = document.createElement("button");
        x.className = "undo";
        x.textContent = "❌";
        x.setAttribute("aria-label", "Remove " + m.name);
        x.onclick = onSettings(async () => {
          if (!confirm(`Remove ${m.name}?`)) return;
          await removeMember(F, db, h.id, m.uid);
          await openSettings();
        });
        li.append(x);
      }
      list.append(li);
    }
    $("inviteBox").hidden = true;
    $("settings").hidden = false;
  }

  $("settingsBtn").onclick = onSettings(openSettings);
  $("settingsClose").onclick = () => { $("settings").hidden = true; };

  $("inviteBtn").onclick = onSettings(async () => {
    const { code } = await createInvite(F, db, window.FT_HOUSEHOLD.id);
    const link = inviteLink(code, location.origin + location.pathname);
    $("inviteCode").textContent = code;
    $("inviteLink").textContent = link;
    $("inviteLink").href = link;
    // QR code of the link, drawn as SVG (loaded only when an invite is made)
    const { default: qrcode } = await import("./vendor/qrcode.mjs");
    const q = qrcode(0, "M");
    q.addData(link);
    q.make();
    $("inviteQr").innerHTML = q.createSvgTag(5, 2);
    $("inviteBox").hidden = false;
  });

  $("signOut").onclick = onSettings(() => AU.signOut(auth));

  // A join link prefills the code
  $("joinCode").value = codeFromUrl(location.href) || "";

  AU.onAuthStateChanged(auth, user => (user ? enter(user) : showSignedOut()));
}
