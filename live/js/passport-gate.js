// Passport ID gate for the live app (classic script, loaded after passport/*.js).
// Behaviour copied from TaskNotes' passport-lock.js; live uses Passport app name "ft".
// Passport's Google sign-in also signs into Firebase (account.js calls credential()). Data stays in Firebase.
(function (window) {
  'use strict';
  const APP = 'ft', LOCKED = 'ft-locked';
  const GT = 'passport-google-token', GT_KEEP = 'ft-google-token';
  const html = document.documentElement;
  // passport/*.js declare top-level consts (not window properties), so look up both ways
  /* global Passport, PassportUI, PassportCloud */
  const P = () => (typeof Passport !== 'undefined' ? Passport : window.Passport);
  const UI = () => (typeof PassportUI !== 'undefined' ? PassportUI : window.PassportUI);
  const Cloud = () => (typeof PassportCloud !== 'undefined' ? PassportCloud : window.PassportCloud);
  const $ = id => document.getElementById(id);
  let api = null, resolveFirst = null, first = new Promise(r => { resolveFirst = r; });
  let started = false;

  // "locked" = only after Lock now or Sign out. Otherwise the app opens straight in.
  const stay = on => { try { on ? window.localStorage.removeItem(LOCKED) : window.localStorage.setItem(LOCKED, '1'); } catch (e) {} };
  const staying = () => { try { return window.localStorage.getItem(LOCKED) !== '1'; } catch (e) { return true; } };

  // Keep Google's 1-hour sign-in across closing the app (Passport keeps it for this tab only)
  function keepGoogle() {
    try { const t = window.sessionStorage.getItem(GT); if (t) window.localStorage.setItem(GT_KEEP, t); } catch (e) {}
  }
  try {
    const t = JSON.parse(window.localStorage.getItem(GT_KEEP) || 'null');
    if (t && t.exp > Date.now() + 60000 && !window.sessionStorage.getItem(GT)) window.sessionStorage.setItem(GT, JSON.stringify(t));
  } catch (e) {}
  try {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') keepGoogle(); });
    window.addEventListener('pagehide', keepGoogle);
    setInterval(keepGoogle, 30000);
  } catch (e) {}

  const email = () => P().appAccount(APP) || '';
  const me = () => P().find(email());

  function start() {
    if (started) return first;
    started = true;
    html.classList.add('lockon'); // Passport screen over the app until it unlocks
    // Signed in before and not locked since: open straight in, no passcode
    try { if (staying() && P().find(email())) P().setUnlocked(APP, true); } catch (e) {}
    // Passport's own "Lock now" button counts too
    const mount = $('passport');
    if (mount) mount.addEventListener('click', e => { if (e.target.closest && e.target.closest('#lock')) stay(false); }, true);
    fetch('passport/theme.json').then(r => r.json()).then(theme => {
      UI().start({
        app: APP, theme, mount,
        onUnlocked: p => {
          html.classList.remove('lockon');
          stay(true);
          resolveFirst(p);
          // later unlocks (after Lock now) just hide the screen; account.js already entered the app
        },
        onSignOut: async () => {
          stay(false);
          try { window.localStorage.removeItem(GT_KEEP); } catch (e) {}
          if (api.onSignOut) await api.onSignOut();
        },
      });
    }).catch(e => console.warn('Passport did not start', e));
    return first;
  }

  api = {
    APP,
    onSignOut: null, // account.js sets this
    needsFirebaseSignIn(firebaseEmail, passportEmail) {
      if (!passportEmail) return false;
      return !firebaseEmail || String(firebaseEmail).toLowerCase() !== String(passportEmail).toLowerCase();
    },
    credential(AU) {
      const c = Cloud();
      const t = c && c.token && c.token();
      return t ? AU.GoogleAuthProvider.credential(null, t) : null;
    },
    start,
    id() { try { const p = me(); return p ? p.id : ''; } catch (e) { return ''; } },
    settings() {
      html.classList.add('lockon');
      start().then(() => UI().settings());
    },
    signOut() {
      stay(false);
      try { window.sessionStorage.removeItem(GT); window.localStorage.removeItem(GT_KEEP); } catch (e) {}
      try { P().signOut(APP); P().setUnlocked(APP, false); } catch (e) {}
      try { const c = Cloud(); if (c && c.signOut) c.signOut(); } catch (e) {}
    },
  };
  window.FT_PASSPORT = api;
})(window);
