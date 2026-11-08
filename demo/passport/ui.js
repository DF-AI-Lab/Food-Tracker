// Passport — screens. Same steps on every app; the look comes from the app's theme.json.
// Usage: PassportUI.start({ app: 'wmm', theme, mount: element, onUnlocked })

const PassportUI = (() => {
  let T, APP, root, onUnlocked, onSignOut, timer;
  let autoFinger = true; // pop fingerprint up by itself once per lock (not again after a cancel or wrong passcode)
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const first = (name) => esc(String(name || '').split(' ')[0]);
  const icon = {
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    finger: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11a5 5 0 0 1 10 0v2a9 9 0 0 1-1.2 4.5"/><path d="M12 11v3a6 6 0 0 1-2 4.5"/><path d="M4.5 15A8 8 0 0 1 4 12a8 8 0 0 1 14-5.3"/><path d="M9.5 11a2.5 2.5 0 0 1 5 0v2"/></svg>',
    google: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.6z"/><path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.7a10 10 0 0 0 0 9.2z"/><path fill="#EA4335" d="M12 6c1.5 0 2.9.5 4 1.5l3-3A10 10 0 0 0 2.7 7.1l3.5 2.7C7 7.8 9.3 6 12 6z"/></svg>',
  };

  // ---------- shared pieces ----------
  function appSection(small) {
    const logo = T.logo.type === 'svg' ? T.logo.value : `<span${T.logo.value.length > 2 ? ' class="long"' : ''}>${esc(T.logo.value)}</span>`;
    return `<header class="ps-app${small ? ' small' : ''}">
      <div class="ps-tile">${logo}</div>
      <h1 class="ps-name">${esc(T.name)}</h1>
      ${small ? '' : `<p class="ps-tag">${esc(T.tagline)}</p>`}
    </header>`;
  }
  const driveLine = (p) => `<p class="ps-drive">${icon.folder} Saves to Drive: ${esc(PassportCloud.ROOT)} / ${p ? esc(p.id) : 'DF……'} / ${esc(T.drive)}</p>`;
  const err = (msg) => (msg ? `<p class="ps-err" role="alert">${msg}</p>` : '');
  const passField = (id, label) => `<label class="ps-label" for="${id}">${label}</label>
    <input class="ps-input ps-code" id="${id}" type="password" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" placeholder="••••••">`;

  function show(html) {
    clearInterval(timer);
    root.innerHTML = `<main class="ps-screen">${html}</main>`;
    const f = root.querySelector('input:not([readonly])'); if (f) f.focus();
  }
  const $ = (s) => root.querySelector(s);
  const on = (s, ev, fn) => { const el = $(s); if (el) el.addEventListener(ev, fn); };
  const busy = (btn, text) => { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = text; };

  function unlock() {
    Passport.setUnlocked(APP, true); autoFinger = true;
    const email = Passport.appAccount(APP);
    // quiet save to Drive (only if Google is still signed in), then carry on
    if (Passport.needsSync(email)) return Passport.sync(email).catch(() => {}).then(route);
    route();
  }
  const CLOUD = Passport.cloud;

  // ---------- router ----------
  function route() {
    const email = Passport.appAccount(APP);
    if (!email) return welcome();
    const p = Passport.find(email);
    if (!p) return CLOUD ? welcome() : setup(email);
    if (!Passport.isUnlocked(APP)) return login();
    return onUnlocked ? onUnlocked(p, settings) : settings();
  }

  // 1. first open
  function welcome(msg) {
    show(`${appSection()}
      <div class="ps-grow"></div>
      ${err(typeof msg === 'string' ? msg : '')}
      <button class="ps-btn ps-google" id="g">${icon.google} Continue with Google</button>
      <p class="ps-small">Pick the Google account that has your Drive.</p>
      ${CLOUD ? '<p class="ps-small">On Google\'s screen, <b>tick the Google Drive box ☑</b> so your passport can be saved.</p>' : ''}`);
    on('#g', 'click', CLOUD ? realGoogle : google);
  }

  function signInError(e) {
    const m = e.message || String(e);
    const say = m === 'no_drive' ? 'Please tick the <b>Google Drive</b> box on Google\'s screen, so your passport can be saved.'
      : /popup|access_denied/.test(m) ? 'Google sign-in was closed. Try again.'
      : 'Couldn\'t reach Google or Drive. Try again.';
    return `${say}<br><small>(${esc(m)})</small>`;
  }

  // real Google pop-up, then look for your passport in Drive
  async function realGoogle() {
    busy($('#g'), 'Opening Google…');
    try {
      const me = await PassportCloud.signIn();
      $('#g').textContent = 'Looking for your passport…';
      Passport.setAppAccount(APP, me.email);
      Passport.setUnlocked(APP, false);
      const p = await Passport.pull(me.email);
      p ? found(p) : setup(me.email, '', me.name);
    } catch (e) {
      welcome(signInError(e));
    }
  }

  // DEMO ONLY: stands in for the real Google pop-up
  function google(msg) {
    show(`${appSection(true)}
      <div class="ps-demo-note">Demo only: the real version opens Google's own sign-in.</div>
      <form id="f" class="ps-form">
        <label class="ps-label" for="em">Google email</label>
        <input class="ps-input" id="em" type="email" autocomplete="email" placeholder="you@gmail.com" required>
        ${err(typeof msg === 'string' ? msg : '')}
        <button class="ps-btn" type="submit">Continue</button>
        <button class="ps-link" type="button" id="back">Back</button>
      </form>`);
    on('#back', 'click', welcome);
    on('#f', 'submit', (e) => {
      e.preventDefault();
      const em = $('#em').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(em)) return google('Type a real email.');
      Passport.setAppAccount(APP, em);
      Passport.setUnlocked(APP, false);
      const p = Passport.find(em);
      p ? found(p) : setup(em);
    });
  }

  // 2nd app: passport found
  function found(p) {
    show(`${appSection()}
      <div class="ps-center">
        <h2 class="ps-h">Welcome back, ${first(p.name)}</h2>
        <p class="ps-sub">We found your passport. No need to sign up again.</p>
      </div>
      <div class="ps-grow"></div>
      <button class="ps-btn" id="go">Enter passcode</button>`);
    on('#go', 'click', login);
  }

  // 2. first time: name + passcode
  function setup(email, msg, name) {
    show(`${appSection(true)}
      <p class="ps-kicker">FIRST TIME ONLY</p>
      <h2 class="ps-h">Set up your passport</h2>
      <form id="f" class="ps-form">
        <label class="ps-label" for="nm">Full name</label>
        <input class="ps-input" id="nm" autocomplete="name" placeholder="Darren Fawcett" value="${esc(name || '')}" required>
        <label class="ps-label" for="em">Email (from Google)</label>
        <input class="ps-input" id="em" value="${esc(email)}" readonly>
        ${passField('pc', 'Make a 6-digit passcode')}
        ${passField('pc2', 'Type it again')}
        ${err(msg)}
        <button class="ps-btn" type="submit">Next</button>
      </form>`);
    on('#f', 'submit', async (e) => {
      e.preventDefault();
      const name = $('#nm').value.trim(), a = $('#pc').value, b = $('#pc2').value;
      if (!name) return setup(email, 'Type your name.');
      if (!Passport.isPasscode(a)) return setup(email, 'Passcode must be exactly 6 numbers.', name);
      if (a !== b) return setup(email, 'The two passcodes don\'t match.', name);
      busy(e.submitter || $('button[type=submit]'), 'Making your passport…');
      const { codes } = await Passport.create({ email, name, passcode: a });
      if (CLOUD) await Passport.sync(email).catch(() => {}); // save to Drive now (Settings shows if it didn't)
      backupCodes(codes, fingerOffer);
    });
  }

  // 3. backup codes
  function backupCodes(codes, next) {
    show(`<p class="ps-kicker">SAVE THESE</p>
      <h2 class="ps-h">Your 10 backup codes</h2>
      <p class="ps-sub">Use one if you forget your passcode. Each works once.</p>
      <div class="ps-codes">${codes.map((c) => `<code>${c}</code>`).join('')}</div>
      <div class="ps-row">
        <button class="ps-btn ps-ghost" id="cp">Copy</button>
        <button class="ps-btn ps-ghost" id="dl">Download</button>
      </div>
      <div class="ps-grow"></div>
      <button class="ps-btn" id="ok">I saved them</button>`);
    const text = 'Passport backup codes (each works once):\n' + codes.join('\n');
    on('#cp', 'click', async () => { try { await navigator.clipboard.writeText(text); $('#cp').textContent = 'Copied ✓'; } catch { $('#cp').textContent = 'Copy failed'; } });
    on('#dl', 'click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = 'passport-backup-codes.txt'; a.click();
    });
    on('#ok', 'click', next);
  }

  // 4. fingerprint offer (only if this phone can)
  async function fingerOffer() {
    const email = Passport.appAccount(APP); const p = Passport.find(email);
    if (!(await Passport.fingerprintAvailable()) || p.fingerprints[APP] || Passport.appPref(APP, 'noFinger')) return unlock();
    show(`<div class="ps-center ps-gap">
        <div class="ps-big-icon">${icon.finger}</div>
        <h2 class="ps-h">Turn on fingerprint?</h2>
        <p class="ps-sub">Open ${esc(T.name)} with a touch. Your passcode still works too.</p>
      </div>
      <div class="ps-grow"></div>
      <div id="msg"></div>
      <button class="ps-btn" id="yes">Yes, turn it on</button>
      <button class="ps-link" id="no">Not now</button>`);
    on('#no', 'click', () => { Passport.setAppPref(APP, 'noFinger', true); unlock(); });
    on('#yes', 'click', async () => {
      try { await Passport.enrollFingerprint(email, APP, T.name); unlock(); }
      catch { $('#msg').innerHTML = err('Fingerprint didn\'t work. You can try again in Settings.'); }
    });
  }

  // 5. lock screen (every time after)
  async function login(msg) {
    const email = Passport.appAccount(APP); const p = Passport.find(email);
    const canFinger = p.fingerprints[APP] && (await Passport.fingerprintAvailable());
    const lockMs = Passport.lockedFor(email);
    show(`${appSection()}
      <h2 class="ps-h ps-center">Welcome back, ${first(p.name)}</h2>
      <form id="f" class="ps-form">
        ${passField('pc', 'Your passcode')}
        <button class="ps-link ps-left" type="button" id="fg">Forgot? Use a backup code</button>
        <div id="msg">${lockMs ? '' : err(msg)}</div>
        <button class="ps-btn" type="submit" id="go">${esc(T.button)}</button>
        ${canFinger ? `<button class="ps-btn ps-ghost" type="button" id="fp">${icon.finger} Use fingerprint</button>` : ''}
      </form>
      ${driveLine(p)}
      <button class="ps-link" id="other">Use another Google account</button>`);
    on('#fg', 'click', backupLogin);
    on('#other', 'click', signOut);
    const tryFinger = async (quiet) => {
      try { if (await Passport.verifyFingerprint(email, APP)) unlock(); }
      catch { if (!quiet) $('#msg').innerHTML = err('Fingerprint didn\'t work. Use your passcode.'); }
    };
    on('#fp', 'click', () => tryFinger(false));
    on('#f', 'submit', async (e) => {
      e.preventDefault();
      const btn = $('#go'); busy(btn, 'Checking…');
      const r = await Passport.checkPasscode(email, $('#pc').value);
      if (r.ok) return unlock();
      login(r.lockedMs ? '' : `Wrong passcode. ${r.triesLeft} ${r.triesLeft === 1 ? 'try' : 'tries'} left.`);
    });
    if (lockMs) return lockCountdown();
    // fingerprint on → pop it up straight away (cancel = type passcode instead)
    if (canFinger && autoFinger && !msg) { autoFinger = false; tryFinger(true); }
  }

  function lockCountdown() {
    const email = Passport.appAccount(APP);
    const tick = () => {
      const ms = Passport.lockedFor(email);
      const go = $('#go'), pc = $('#pc');
      if (!go) return clearInterval(timer);
      if (!ms) { clearInterval(timer); go.disabled = false; go.textContent = T.button; pc.disabled = false; $('#msg').innerHTML = ''; return; }
      go.disabled = true; pc.disabled = true;
      go.textContent = `Locked: try again in ${Math.ceil(ms / 1000)}s`;
      $('#msg').innerHTML = err(`Too many wrong tries. Locked for a while to keep you safe.`);
    };
    tick(); timer = setInterval(tick, 500);
  }

  // locked out → backup code → new passcode
  function backupLogin(msg) {
    const email = Passport.appAccount(APP);
    show(`${appSection(true)}
      <h2 class="ps-h">Use a backup code</h2>
      <p class="ps-sub">Type one of your 10 codes. It will stop working after this.</p>
      <form id="f" class="ps-form">
        <label class="ps-label" for="bc">Backup code</label>
        <input class="ps-input ps-mono" id="bc" inputmode="numeric" autocomplete="off" placeholder="1234-5678">
        ${err(msg)}
        <button class="ps-btn" type="submit" id="go">Continue</button>
        <button class="ps-link" type="button" id="back">Back</button>
      </form>
      <button class="ps-link" id="rg">No codes left? Reset with Google</button>`);
    on('#back', 'click', () => login());
    // Google is the real key: prove it's your account, then make a new passcode
    on('#rg', 'click', async () => {
      if (!CLOUD) return backupLogin('Pretend mode: reset with Google works in the real version.');
      try {
        const me = await PassportCloud.signIn();
        if (me.email.toLowerCase() !== email) return backupLogin('That\'s a different Google account.');
        await Passport.pull(email);
        Passport.setUnlocked(APP, false); // no hidden key open = a new one gets made
        newPasscode(null);
      } catch (e) { backupLogin(signInError(e)); }
    });
    on('#f', 'submit', async (e) => {
      e.preventDefault(); busy($('#go'), 'Checking…');
      const r = await Passport.useBackupCode(email, $('#bc').value);
      if (r.ok) return newPasscode(r.left);
      backupLogin(r.lockedMs ? `Locked: try again in ${Math.ceil(r.lockedMs / 1000)}s.` : `That code didn't work. ${r.triesLeft} tries left.`);
    });
  }

  // left = backup codes left (after a backup code). null = Reset with Google (makes a new hidden key)
  function newPasscode(left, msg) {
    show(`<h2 class="ps-h">Make a new passcode</h2>
      <p class="ps-sub">${left === null
        ? 'You\'ll get new backup codes too. Private stuff locked with the old passcode (like Secrets) can\'t be opened any more.'
        : `${left} backup codes left.`}</p>
      <form id="f" class="ps-form">
        ${passField('pc', 'New 6-digit passcode')}
        ${passField('pc2', 'Type it again')}
        ${err(msg)}
        <button class="ps-btn" type="submit" id="go">Save</button>
      </form>`);
    on('#f', 'submit', async (e) => {
      e.preventDefault();
      const a = $('#pc').value, b = $('#pc2').value;
      if (!Passport.isPasscode(a)) return newPasscode(left, 'Passcode must be exactly 6 numbers.');
      if (a !== b) return newPasscode(left, 'The two passcodes don\'t match.');
      busy($('#go'), 'Saving…');
      const codes = await Passport.setPasscode(Passport.appAccount(APP), a);
      codes ? backupCodes(codes, unlock) : unlock();
    });
  }

  // some things need the hidden key open: after fingerprint it's still locked, so ask for the passcode
  function needKey(next, back, msg) {
    const email = Passport.appAccount(APP);
    if (Passport.key(email)) return next();
    show(`${appSection(true)}
      <h2 class="ps-h">Type your passcode</h2>
      <p class="ps-sub">This needs your passcode, not just your fingerprint.</p>
      <form id="f" class="ps-form">
        ${passField('pc', 'Your passcode')}
        ${err(msg)}
        <button class="ps-btn" type="submit" id="go">Continue</button>
        <button class="ps-link" type="button" id="back">Back</button>
      </form>`);
    on('#back', 'click', back);
    on('#f', 'submit', async (e) => {
      e.preventDefault(); busy($('#go'), 'Checking…');
      const r = await Passport.checkPasscode(email, $('#pc').value);
      if (r.ok) return next();
      needKey(next, back, r.lockedMs ? `Locked: try again in ${Math.ceil(r.lockedMs / 1000)}s.` : `Wrong passcode. ${r.triesLeft} tries left.`);
    });
  }

  // settings (where the ID lives)
  // 🚪 sign out: this app forgets the Google account on this device. The app can tidy up first (onSignOut).
  async function signOut() {
    try { if (onSignOut) await onSignOut(); } catch {}
    Passport.signOut(APP); Passport.setUnlocked(APP, false);
    if (CLOUD) PassportCloud.signOut();
    welcome();
  }

  async function settings() {
    const email = Passport.appAccount(APP); const p = Passport.find(email);
    const can = await Passport.fingerprintAvailable();
    const fp = p.fingerprints[APP];
    show(`${appSection(true)}
      <h2 class="ps-h">You're in ✓</h2>
      <p class="ps-sub">Settings</p>
      <dl class="ps-card">
        <div><dt>Your passport</dt><dd>${esc(p.id)}</dd></div>
        <div><dt>Name</dt><dd>${esc(p.name)}</dd></div>
        <div><dt>Email</dt><dd>${esc(p.email)}</dd></div>
        <div><dt>Drive folder</dt><dd>${CLOUD ? esc(PassportCloud.ROOT) + ' / ' : ''}${esc(p.id)} / ${esc(T.drive)}</dd></div>
        <div><dt>Backup codes left</dt><dd>${Passport.backupLeft(p)} of 10</dd></div>
        <div><dt>Fingerprint</dt><dd>${!can ? 'Not on this device' : fp ? 'On' : 'Off'}</dd></div>
        <div><dt>Hidden key</dt><dd>${Passport.key(email) ? 'Open ✓' : 'Locked'}</dd></div>
        <div><dt>Saved in Drive</dt><dd>${!CLOUD ? 'Pretend mode' : p.dirty ? 'Not yet' : 'Yes ✓'}</dd></div>
      </dl>
      <div id="msg"></div>
      ${CLOUD && p.dirty ? '<button class="ps-btn" id="sv">Save to Drive now</button>' : ''}
      ${can ? `<button class="ps-btn ps-ghost" id="fpt">${fp ? 'Turn fingerprint off' : 'Turn fingerprint on'}</button>` : ''}
      <button class="ps-btn ps-ghost" id="cpw">Change passcode</button>
      <button class="ps-btn ps-ghost" id="nb">Make new backup codes</button>
      ${onUnlocked ? `<button class="ps-btn" id="back">Back to ${esc(T.name)}</button>` : ''}
      <button class="ps-btn${onUnlocked ? ' ps-ghost' : ''}" id="lock">Lock now</button>
      <button class="ps-btn ps-ghost" id="out">Sign out</button>
      <p class="ps-sub ps-center">Sign out to use another Google account. Your passport stays safe in Drive.</p>`);
    on('#sv', 'click', async () => {
      busy($('#sv'), 'Saving…');
      try { await Passport.sync(email, true); settings(); }
      catch { await settings(); $('#msg').innerHTML = err('Couldn\'t save to Drive. Try again.'); }
    });
    on('#back', 'click', route);
    on('#cpw', 'click', () => needKey(() => newPasscode(Passport.backupLeft(Passport.find(email))), settings));
    on('#lock', 'click', () => { Passport.setUnlocked(APP, false); login(); });
    on('#out', 'click', signOut);
    on('#nb', 'click', () => needKey(async () => backupCodes(await Passport.newBackupCodes(email), settings), settings));
    on('#fpt', 'click', async () => {
      if (fp) { Passport.removeFingerprint(email, APP); return settings(); }
      try { await Passport.enrollFingerprint(email, APP, T.name); settings(); }
      catch { $('#msg').innerHTML = err('Fingerprint didn\'t work. Try again.'); }
    });
  }

  // ---------- start ----------
  function applyTheme(theme) {
    const r = document.documentElement.style;
    for (const [k, v] of Object.entries(theme.colors)) r.setProperty('--ps-' + k, v);
    r.setProperty('--ps-font', `'${theme.font}', system-ui, sans-serif`);
    document.documentElement.dataset.align = theme.align || 'center';
    if (theme.fontUrl) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = theme.fontUrl; document.head.appendChild(l);
    }
  }

  function start(opts) {
    APP = opts.app; T = opts.theme; root = opts.mount; onUnlocked = opts.onUnlocked; onSignOut = opts.onSignOut;
    applyTheme(T);
    route();
  }

  return { start, settings, needKey, route };
})();
