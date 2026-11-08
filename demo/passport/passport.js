// Passport — core logic (no screens here; see ui.js).
// The passport (ID, name, email + the hidden key, locked by your passcode and backup codes)
// lives in YOUR Google Drive: App data - DON'T DELETE/DF123456/passport.json   (see google.js)
// This phone keeps a copy so the lock screen works fast and offline.
// No client ID in config.js = pretend mode (this phone only, no Google).

const Passport = (() => {
  const VERSION = '0.3.3';
  const cloud = typeof PassportCloud !== 'undefined' && PassportCloud.enabled;
  const KEY = cloud ? 'passport-v2' : 'passport-demo-v2';
  const MAX_TRIES = 5;          // wrong passcodes before lock
  const LOCK_MS = cloud ? 5 * 60 * 1000 : 30 * 1000; // real: 5 min, pretend: 30s
  const ITER = 100000;          // PBKDF2 rounds (scrambling strength)

  // ---------- storage ----------
  const blank = () => ({ passports: {}, apps: {} });
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || blank(); } catch { return blank(); }
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* private mode etc. */ }
  }

  // ---------- Drive sync ----------
  // what goes to Drive: never fingerprints (they belong to one phone) or local notes
  const LOCAL_ONLY = ['fingerprints', 'dirty', 'fileId', 'folderId'];
  const forDrive = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !LOCAL_ONLY.includes(k)));

  // mark changed + try to save to Drive in the background
  function changed(db, p) {
    p.updated = Date.now(); p.dirty = cloud; save(db);
    if (cloud) sync(p.email).catch(() => {});
  }

  // save this passport to Drive. interactive = may open Google's pop-up (only from a tap)
  // one save at a time, so we never make two passport.json files
  let queue = Promise.resolve();
  async function sync(email, interactive) {
    if (!cloud) return 'off';
    const e = norm(email);
    if (!find(e)) return 'none';
    if (!PassportCloud.hasToken()) { if (!interactive) return 'later'; await PassportCloud.ensureToken(e); }
    const run = async () => {
      const p = load().passports[e];
      if (!p.dirty && p.fileId) return 'saved';
      const sent = p.updated;
      const r = await PassportCloud.push(forDrive(p), p.fileId);
      const db = load(); const now = db.passports[e];
      Object.assign(now, r);
      if (now.updated === sent) now.dirty = false; // changed again meanwhile? stay dirty
      save(db);
      return now.dirty ? run() : 'saved';
    };
    return (queue = queue.then(run, run));
  }

  // after Google sign-in: fetch the passport from Drive (null = none yet)
  async function pull(email) {
    if (!cloud) return find(email);
    const r = await PassportCloud.pull();
    const db = load(); const e = norm(email);
    if (!r) { const p = db.passports[e]; if (p) await sync(e).catch(() => {}); return p || null; }
    const remote = r.data, local = db.passports[e];
    if (remote.v !== 2) { // old test passport: make it again with the same ID
      remake[e] = { id: remote.id, fileId: r.fileId, folderId: r.folderId };
      delete db.passports[e]; save(db); return null;
    }
    let p;
    if (local && local.dirty && local.updated > (remote.updated || 0)) {
      // this phone has newer changes: keep them, but never "un-use" a backup code
      p = local;
      const used = new Set(remote.backup.filter((b) => b.used).map((b) => b.ct));
      p.backup.forEach((b) => { if (used.has(b.ct)) b.used = true; });
    } else {
      p = { ...remote, fingerprints: local?.fingerprints || {}, dirty: false };
    }
    p.email = e; p.fileId = r.fileId; p.folderId = r.folderId;
    db.passports[e] = p; save(db);
    if (p.dirty) await sync(e).catch(() => {});
    return p;
  }

  const needsSync = (email) => cloud && !!find(email)?.dirty;

  // ---------- the hidden key ----------
  // One random key per passport. It locks private stuff (Secrets, backups).
  // passport.json only holds LOCKED copies of it: one opened by the passcode, one by each backup code.
  // The plain key is never saved anywhere. It lives in memory only while unlocked with passcode/backup code.
  const enc = new TextEncoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64s = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const random = (n) => crypto.getRandomValues(new Uint8Array(n));
  const randDigits = (n) => [...random(n)].map((b) => b % 10).join('');

  async function boxKey(secret, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function lockKey(secret, mk) { // -> {salt, iv, ct}
    const salt = random(16), iv = random(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await boxKey(secret, salt), mk);
    return { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function openKey(box, secret) { // -> key bytes, or null if the secret is wrong
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64s(box.iv) },
        await boxKey(secret, unb64s(box.salt)), unb64s(box.ct)));
    } catch { return null; }
  }

  let held = null; // { email, mk } while unlocked with passcode / backup code
  const hold = (e, mk) => { held = { email: e, mk }; };
  // the hidden key, for the app to lock/unlock its private stuff. null = ask for the passcode first
  const key = (email) => (held && held.email === norm(email) ? held.mk.slice() : null);
  const forget = () => { held = null; };

  // ---------- helpers ----------
  const norm = (email) => String(email || '').trim().toLowerCase();
  const isPasscode = (c) => /^\d{6}$/.test(String(c));
  const codeDigits = (c) => String(c).replace(/\D/g, '');

  function newId(db) {
    let id;
    do { id = 'DF' + randDigits(6); } while (Object.values(db.passports).some((p) => p.id === id));
    return id;
  }

  async function makeBackupCodes(mk) {
    const codes = Array.from({ length: 10 }, () => randDigits(4) + '-' + randDigits(4));
    const stored = await Promise.all(codes.map(async (c) => ({ ...(await lockKey('backup:' + codeDigits(c), mk)), used: false })));
    return { codes, stored };
  }

  // ---------- passports ----------
  function find(email) { return load().passports[norm(email)] || null; }

  // old test passports (before the hidden key) get made again, keeping the same ID + Drive file
  const remake = {};

  async function create({ email, name, passcode }) {
    const db = load();
    const e = norm(email);
    if (db.passports[e]) throw new Error('A passport already exists for this account.');
    if (!isPasscode(passcode)) throw new Error('Passcode must be 6 numbers.');
    const mk = random(32);
    const { codes, stored } = await makeBackupCodes(mk);
    const old = remake[e] || {};
    db.passports[e] = {
      v: 2, id: old.id || newId(db), name: String(name).trim(), email: e,
      pass: await lockKey('pass:' + passcode, mk),
      backup: stored, fails: 0, lockUntil: 0, fingerprints: {},
      created: new Date().toISOString(),
      ...(old.fileId ? { fileId: old.fileId, folderId: old.folderId } : {}),
    };
    delete remake[e];
    hold(e, mk);
    changed(db, db.passports[e]);
    return { passport: db.passports[e], codes };
  }

  function lockedFor(email) {
    const p = find(email);
    return p ? Math.max(0, p.lockUntil - Date.now()) : 0;
  }

  function recordFail(db, p) {
    p.fails += 1;
    if (p.fails >= MAX_TRIES) { p.lockUntil = Date.now() + LOCK_MS; p.fails = 0; }
    changed(db, p);
    return { ok: false, triesLeft: p.lockUntil > Date.now() ? 0 : MAX_TRIES - p.fails, lockedMs: Math.max(0, p.lockUntil - Date.now()) };
  }

  // returns { ok } or { ok:false, triesLeft, lockedMs }. Right passcode also opens the hidden key.
  async function checkPasscode(email, passcode) {
    const db = load(); const e = norm(email); const p = db.passports[e];
    if (!p) return { ok: false, triesLeft: 0, lockedMs: 0 };
    if (p.lockUntil > Date.now()) return { ok: false, triesLeft: 0, lockedMs: p.lockUntil - Date.now() };
    const mk = isPasscode(passcode) ? await openKey(p.pass, 'pass:' + passcode) : null;
    if (mk) {
      hold(e, mk);
      if (p.fails) { p.fails = 0; changed(db, p); }
      return { ok: true };
    }
    return recordFail(db, p);
  }

  // a backup code works once (and opens the hidden key)
  async function useBackupCode(email, code) {
    const db = load(); const e = norm(email); const p = db.passports[e];
    if (!p) return { ok: false, triesLeft: 0, lockedMs: 0 };
    if (p.lockUntil > Date.now()) return { ok: false, triesLeft: 0, lockedMs: p.lockUntil - Date.now() };
    const clean = codeDigits(code);
    if (clean.length === 8) {
      for (const b of p.backup) {
        if (b.used) continue;
        const mk = await openKey(b, 'backup:' + clean);
        if (mk) { b.used = true; p.fails = 0; hold(e, mk); changed(db, p); return { ok: true, left: backupLeft(p) }; }
      }
    }
    return recordFail(db, p);
  }

  const backupLeft = (p) => p.backup.filter((b) => !b.used).length;

  // new passcode. With the key open (after a backup code): same key.
  // Without it (Reset with Google): a NEW key + new backup codes; old private stuff can't be opened. Returns new codes then.
  async function setPasscode(email, passcode) {
    if (!isPasscode(passcode)) throw new Error('Passcode must be 6 numbers.');
    const db = load(); const e = norm(email); const p = db.passports[e];
    let mk = key(e), codes = null;
    if (!mk) {
      mk = random(32);
      const made = await makeBackupCodes(mk);
      codes = made.codes; p.backup = made.stored; hold(e, mk);
    }
    p.pass = await lockKey('pass:' + passcode, mk);
    changed(db, p);
    return codes;
  }

  // needs the key open (passcode typed this visit). Returns null if not.
  async function newBackupCodes(email) {
    const mk = key(email); if (!mk) return null;
    const db = load(); const p = db.passports[norm(email)];
    const { codes, stored } = await makeBackupCodes(mk);
    p.backup = stored; changed(db, p);
    return codes;
  }

  // ---------- which Google account each app is signed in with ----------
  function appAccount(app) { return load().apps[app]?.email || null; }
  function setAppAccount(app, email) {
    const db = load();
    db.apps[app] = { ...(db.apps[app] || {}), email: norm(email) };
    save(db);
  }
  function signOut(app) { const db = load(); delete db.apps[app]; save(db); }
  function appPref(app, k) { return load().apps[app]?.[k]; }
  function setAppPref(app, k, v) { const db = load(); db.apps[app] = { ...(db.apps[app] || {}), [k]: v }; save(db); }

  // unlocked = this tab only, until closed or "Lock now"
  const unlockKey = (app) => 'passport-unlocked-' + app;
  function isUnlocked(app) { try { return sessionStorage.getItem(unlockKey(app)) === '1'; } catch { return false; } }
  function setUnlocked(app, on) { if (!on) forget(); try { on ? sessionStorage.setItem(unlockKey(app), '1') : sessionStorage.removeItem(unlockKey(app)); } catch {} }

  // ---------- fingerprint (passkeys / WebAuthn) ----------
  // The fingerprint never leaves the phone. Linked to this phone + this web address.
  // The phone does the check and only says "yes, it's them". It unlocks this phone's copy.
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

  async function fingerprintAvailable() {
    try {
      return !!(window.PublicKeyCredential &&
        await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch { return false; }
  }

  async function enrollFingerprint(email, app, appName) {
    const p = find(email);
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: appName },
      user: { id: enc.encode(p.id), name: p.email, displayName: p.name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
    } });
    const db = load();
    db.passports[p.email].fingerprints[app] = b64url(cred.rawId);
    save(db);
  }

  async function verifyFingerprint(email, app) {
    const id = find(email)?.fingerprints?.[app];
    if (!id) return false;
    const got = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(id) }],
      userVerification: 'required', timeout: 60000,
    } });
    return !!got;
  }

  function removeFingerprint(email, app) {
    const db = load(); const p = db.passports[norm(email)];
    if (p) { delete p.fingerprints[app]; save(db); }
  }

  // only clears this phone. Your Drive copy stays.
  function resetAll() {
    try { localStorage.removeItem(KEY); sessionStorage.clear(); } catch {}
  }

  return {
    VERSION, MAX_TRIES, cloud, key, sync, pull, needsSync, find, create, lockedFor, checkPasscode, useBackupCode, backupLeft,
    setPasscode, newBackupCodes, appAccount, setAppAccount, signOut, appPref, setAppPref,
    isUnlocked, setUnlocked, fingerprintAvailable, enrollFingerprint, verifyFingerprint,
    removeFingerprint, resetAll, isPasscode,
  };
})();
