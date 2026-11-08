// Passport — Google sign-in + Drive (the passport lives in YOUR Drive, no Firebase).
// Scope drive.file = Passport only sees files it made itself, never the rest of your Drive.
// Every app must use the SAME client ID, so they all see the same passport.json.

const PassportCloud = (() => {
  const CLIENT_ID = (window.PASSPORT_CONFIG || {}).googleClientId || '';
  const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const FOLDER = 'application/vnd.google-apps.folder';
  const TOKEN_KEY = 'passport-google-token';
  const ROOT = "App data - DON'T DELETE"; // one top folder for everything
  const enabled = !!CLIENT_ID;

  // ---------- token (kept for this tab only, about 1 hour) ----------
  function saved() {
    try { const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY)); return t && t.exp > Date.now() + 60000 ? t : null; } catch { return null; }
  }
  const hasToken = () => !!saved();

  let gsi;
  function loadGsi() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    gsi = gsi || new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = ok; s.onerror = () => fail(new Error('Could not reach Google.'));
      document.head.appendChild(s);
    });
    return gsi;
  }
  // start loading early so the pop-up opens straight from the tap
  if (enabled) loadGsi().catch(() => {});

  // opens Google's pop-up. Call it from a button tap.
  async function getToken(hint, pick) {
    await loadGsi();
    const res = await new Promise((ok, fail) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES,
        callback: (r) => (r.error ? fail(new Error(r.error)) : ok(r)),
        include_granted_scopes: true,
        error_callback: (e) => fail(new Error(e.type || 'popup_closed')),
      });
      client.requestAccessToken({ prompt: pick ? 'select_account' : '', login_hint: hint || undefined });
    });
    // Google shows a "Drive" tick box. Not ticked = Passport can't save, so say so.
    if (!google.accounts.oauth2.hasGrantedAllScopes(res, 'https://www.googleapis.com/auth/drive.file')) throw new Error('no_drive');
    const t = { token: res.access_token, exp: Date.now() + res.expires_in * 1000, email: hint || '' };
    try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch {}
    return t;
  }

  async function call(url, opts = {}) {
    const t = saved(); if (!t) throw new Error('signed_out');
    const go = () => fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t.token, ...(opts.headers || {}) } });
    let r;
    try { r = await go(); } catch { await new Promise((ok) => setTimeout(ok, 800)); r = await go(); } // one retry on a signal blip
    if (r.status === 401) { try { sessionStorage.removeItem(TOKEN_KEY); } catch {} throw new Error('signed_out'); }
    if (!r.ok) throw new Error('Drive error ' + r.status);
    return r.status === 204 ? null : r.json();
  }

  // ---------- sign in ----------
  // returns { email, name } of the Google account picked
  async function signIn() {
    await getToken('', true);
    const me = await call('https://www.googleapis.com/oauth2/v3/userinfo');
    const t = saved(); t.email = me.email;
    try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch {}
    return { email: me.email, name: me.name || '' };
  }

  // make sure we can talk to Drive (pop-up only if the hour ran out)
  async function ensureToken(email) {
    const t = saved();
    if (t && (!email || !t.email || t.email === email)) return;
    await getToken(email, false);
    const t2 = saved(); t2.email = email; sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t2));
  }

  // forget the Google sign-in on this device (Drive files stay)
  function signOut() {
    const t = saved();
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
    try { if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t.token, () => {}); } catch {}
  }

  // ---------- Drive helpers ----------
  const q = (s) => API + '?spaces=drive&fields=files(id,name,parents,modifiedTime)&orderBy=modifiedTime desc&q=' + encodeURIComponent(s);
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function findFolder(name, parent) {
    const r = await call(q(`name='${esc(name)}' and mimeType='${FOLDER}' and trashed=false` + (parent ? ` and '${parent}' in parents` : '')));
    return r.files[0]?.id || null;
  }
  async function makeFolder(name, parent) {
    const r = await call(API + '?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
    });
    return r.id;
  }
  const folder = async (name, parent) => (await findFolder(name, parent)) || makeFolder(name, parent);

  // App data - DON'T DELETE / DF123456
  const idFolder = async (passportId) => folder(passportId, await folder(ROOT));

  // ---------- the passport file: App data - DON'T DELETE/DF123456/passport.json ----------
  async function pull() {
    const r = await call(q(`name='passport.json' and trashed=false`));
    const f = r.files[0]; if (!f) return null;
    const data = await call(API + '/' + f.id + '?alt=media');
    return { data, fileId: f.id, folderId: f.parents?.[0] || null };
  }

  async function push(data, fileId) {
    const body = JSON.stringify(data, null, 2);
    if (fileId) {
      try {
        await call(UPLOAD + '/' + fileId + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
        return { fileId };
      } catch (e) { if (e.message !== 'Drive error 404') throw e; } // deleted? make it again
    }
    const folderId = await idFolder(data.id);
    const b = 'passport' + Math.random().toString(16).slice(2);
    const meta = { name: 'passport.json', mimeType: 'application/json', parents: [folderId] };
    const r = await call(UPLOAD + '?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b },
      body: `--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`,
    });
    return { fileId: r.id, folderId };
  }

  // each app's own folder: App data - DON'T DELETE/DF123456/WMM etc. Apps save their data in here.
  async function appFolder(passportId, name) { return folder(name, await idFolder(passportId)); }

  return { ROOT, enabled, hasToken, token: () => saved()?.token || '', signIn, signOut, ensureToken, pull, push, appFolder };
})();
