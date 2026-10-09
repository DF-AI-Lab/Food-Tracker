(function() {
  let packs = [];
  let today = getToday();
  let lastAction = null;
  let undoTimeout = null;
  // Meal planner state
  let selDay = today;
  let selSlot = 'main';
  const NEXT_SLOT = { main: 'side', side: 'veg' };
  let pendingPlan = null; // { pack, day, slot } waiting for "Add anyway"
  let openDay = today;    // day whose card is open (null = all closed); today is open on load
  let meals = [];         // meals history, saved in DB.meals
  let askDay = null;      // past day in "What did you have?" (or cost) mode
  const pastState = {};   // past day -> 'ask' | 'use' | 'cost' | 'had'
  const hadPicked = {};   // past day -> foods picked in "had" mode
  let cleaning = false;   // guards dropExpiredPlans against re-entry
  // Shopping list state
  let shop = [];          // shopping items, saved in DB.shop
  let ratings = {};       // idea ratings: name -> 1..5, saved in DB.ratings
  let shopTab = 'main';   // "bought before" tab: main | side | veg | other
  let ideasOn = false;
  const autoBusy = new Set();
  function getToday() {
    const params = new URLSearchParams(window.location.search);
    const todayParam = params.get('today');
    if (todayParam) return todayParam;
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const date = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${date}`;
  }

  // Text put into HTML must be escaped (food names are typed by the user)
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // Time of printing: the code on the sheet and the saved record use the same stamp
  function printStamp() {
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    return { hhmm, code: FT.sheetCode(today, hhmm), printed: `${today}T${hhmm}` };
  }

  // The printable A4 fridge sheet (styled by #printSheet in css/style.css)
  function buildPrintSheet(stamp) {
    const sheet = FT.printSheet(packs, today);
    const hhmm = stamp.hhmm;
    const boxes = '<td class="bx"><span></span></td>'.repeat(3);

    const section = sec => {
      const word = sec.title.replace(/[^A-Za-z ]/g, '').trim().toLowerCase();
      const more = word.charAt(0).toUpperCase() + word.slice(1);
      const rows = sec.rows.map(r =>
        `<tr data-id="${r.id}"><td class="id">${r.no}</td><td>${esc(r.name)}</td><td class="d">${esc(r.date)}</td>${boxes}</tr>`).join('');
      return `<h2${sec.key === 'soon' ? ' class="soon"' : ''}>${esc(sec.title)}<span class="ub">U P B</span></h2>` +
        `<table>${rows}</table>` +
        (sec.more > 0 ? `<div class="more">+${sec.more} more ${esc(more)} · see app</div>` : '');
    };
    const column = secs => secs.map(section).join('');

    const blankRows = (n, cells) => Array.from({ length: n }, () => `<tr>${cells}</tr>`).join('');
    const added = blankRows(4, '<td class="id">+</td><td>&nbsp;</td><td class="d">__/__</td>');
    const need = blankRows(3, '<td class="bx"><span></span></td><td>&nbsp;</td>');
    const meals = sheet.meals.map(m =>
      `<tr><td class="dn">${esc(m.day)}</td><td>${m.text ? esc(m.text) : '&nbsp;'}</td></tr>`).join('');

    const hidden = sheet.total - sheet.shown;
    const footer = `${sheet.total} items${hidden > 0 ? ` (${hidden} more in app)` : ''} · U = Used · P = Part used · B = Binned`;

    return `<div class="ps-page">
  <i class="ps-mk ps-tl"></i><i class="ps-mk ps-tr"></i><i class="ps-mk ps-bl"></i><i class="ps-mk ps-br"></i>
  <header class="ps-head">
    <div><h1>🥶 Fridge sheet</h1><div class="ps-sub">Week ${esc(sheet.range)} · printed ${esc(FT.formatDate(today))}, ${hhmm}</div></div>
    <div class="ps-code">SHEET ${esc(stamp.code)}</div>
  </header>
  <div class="ps-key">Mark with an <b>✕</b> when gone: U = Used · P = Part used · B = Binned</div>
  <div class="ps-top"><div>${column(sheet.left)}</div><div>${column(sheet.right)}</div></div>
  <div class="ps-bottom"><div>
    <div class="ps-added"><h2>✍️ ADDED (write in)</h2><table class="blank">${added}</table></div>
    <div class="ps-need"><h2>🛒 NEED</h2><table class="blank">${need}</table></div>
  </div>
  <div class="ps-meals"><h2>🍽️ MEALS ${esc(sheet.range)}</h2><table>${meals}</table></div></div>
  <div class="ps-foot">${esc(footer)}</div>
</div>`;
  }

  // Where the boxes are on the printed page, relative to the 4 corner marks (for photo reading)
  function measureSheet(page) {
    const rectOf = el => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const corners = {
      tl: rectOf(page.querySelector('.ps-tl')),
      tr: rectOf(page.querySelector('.ps-tr')),
      bl: rectOf(page.querySelector('.ps-bl')),
      br: rectOf(page.querySelector('.ps-br'))
    };
    const rows = Array.from(page.querySelectorAll('.ps-top tr[data-id]')).map(tr => ({
      no: tr.querySelector('td.id').textContent.trim(),
      id: Number(tr.dataset.id),
      name: tr.children[1].textContent.trim(),
      boxes: Array.from(tr.querySelectorAll('td.bx span')).map(rectOf)
    }));
    return window.FT_OMR.layoutFromRects(corners, rows);
  }

  // Fill the sheet, measure it (shown off-screen at A4 size for a moment), save it, then print
  function printFridgeSheet() {
    const stamp = printStamp();
    const box = document.getElementById('printSheet');
    box.innerHTML = buildPrintSheet(stamp);
    let rows = null;
    box.classList.add('measuring');
    try {
      rows = measureSheet(box.querySelector('.ps-page'));
    } catch (e) {
      rows = null; // the sheet still prints; it just cannot be read from a photo
    } finally {
      box.classList.remove('measuring');
    }
    // Saved in the background: a failed save never stops the print
    if (rows) DB.sheets.add({ code: stamp.code, printed: stamp.printed, rows }).catch(() => {});
    window.print();
  }

  async function init() {
    // The TEST copy shows a red banner (the real copy stays hidden)
    try {
      const banner = document.getElementById('testBanner');
      fetch('/api/info').then(r => r.json()).then(i => { if (i.test) banner.hidden = false; }).catch(() => {});
    } catch (e) {
      // no banner
    }
    await DB.open();
    packs = await DB.all();
    // Remove deletes that are older than yesterday (they can no longer be undone)
    const expired = FT.expiredDeletes(packs, today);
    try {
      for (const pack of expired) await DB.remove(pack.id);
      packs = packs.filter(p => !expired.includes(p));
    } catch (e) {
      // try again next time the app starts
    }
    // Shopping list and idea ratings
    shop = await DB.shop.all();
    meals = await DB.meals.all();
    for (const r of await DB.ratings.all()) ratings[r.name] = r.rating;
    // Shop items deleted before yesterday are removed for good
    const expiredShop = FT.expiredShopDeletes(shop, today);
    try {
      for (const item of expiredShop) await DB.shop.remove(item.id);
      shop = shop.filter(i => !expiredShop.includes(i));
    } catch (e) {
      // try again next time the app starts
    }
    setupTheme();
    setupEventListeners();
    renderAll();

    // Say so once if the last reload picked up a new version
    let justUpdated = false;
    try {
      justUpdated = sessionStorage.getItem('ftUpdated') === '1';
      sessionStorage.removeItem('ftUpdated');
    } catch (e) { /* ignore */ }
    if (justUpdated) showUpdateNote();

    // Look for updates now, then every hour
    checkUpdate(false);
    setInterval(() => checkUpdate(false), 60 * 60 * 1000);
  }

  function showUpdateNote() {
    const note = document.getElementById('updNote');
    note.textContent = '✨ Updated to the latest version';
    note.hidden = false;
    setTimeout(() => { note.hidden = true; }, 6000);
  }

  // Ask the server to pull the latest app from GitHub. Reloads if it changed
  // (or always, when force is true, i.e. the 🔄 button was pressed).
  let checkingUpdate = false;
  let loadedVersion = null; // version stamp of the files this page was loaded from
  async function checkUpdate(force) {
    if (checkingUpdate) return;
    checkingUpdate = true;
    const btn = document.getElementById('refresh');
    btn.disabled = true;
    btn.classList.add('spin');
    let updated = false;
    let restart = false;
    try {
      const r = await fetch('/api/update', { method: 'POST' });
      const body = await r.json();
      updated = !!body.updated;
      restart = !!body.restart;
      // The PC also updates itself in the background: a new stamp means new files
      if (loadedVersion === null) loadedVersion = body.version;
      else if (body.version && body.version !== loadedVersion) updated = true;
    } catch (e) {
      // offline or no update support: nothing changed
    }
    if (updated) {
      try { sessionStorage.setItem('ftUpdated', '1'); } catch (e) { /* ignore */ }
    }
    if (updated || force) {
      // The server restarts itself after a server-side change, so give it a moment
      if (restart) await new Promise(done => setTimeout(done, 4000));
      location.reload();
      return;
    }
    btn.disabled = false;
    btn.classList.remove('spin');
    checkingUpdate = false;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // One button: it shows the mode a click switches to
    const btn = document.getElementById('theme');
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    btn.title = theme === 'light' ? 'Dark mode' : 'Light mode';
    btn.setAttribute('aria-label', btn.title);
  }

  function setupTheme() {
    let stored = null;
    try { stored = localStorage.getItem('theme'); } catch (e) { /* ignore */ }
    applyTheme(stored === 'light' ? 'light' : 'dark');
  }

  function setTheme(theme) {
    applyTheme(theme);
    try { localStorage.setItem('theme', theme); } catch (e) { /* ignore */ }
  }

  function setupEventListeners() {
    // Theme: one button, flips between dark and light
    document.getElementById('theme').addEventListener('click', () => {
      const now = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      setTheme(now === 'light' ? 'dark' : 'light');
    });

    // 🔄: get the latest version now
    document.getElementById('refresh').addEventListener('click', () => checkUpdate(true));

    // Print: fill the A4 fridge sheet, then open the print dialog
    document.getElementById('printF').addEventListener('click', printFridgeSheet);
    // Mic: coming soon
    document.getElementById('mic').addEventListener('click', () => {
      document.getElementById('micNote').textContent = '🎤 Voice input: coming soon';
    });

    // Tabs
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Fridge views (Shop opens the shopping list on the Add tab)
    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.view === 'shop') openShopList();
        else switchView(btn.dataset.view);
      });
    });

    // Kind selection (Add to fridge only; quick fill has its own kind buttons)
    document.querySelectorAll('.mtabs [data-kind]').forEach(btn => {
      btn.addEventListener('click', () => selectKind(btn.dataset.kind));
    });

    // Add form
    document.getElementById('ddmm').addEventListener('input', updateDatePreview);
    document.getElementById('days').addEventListener('input', updateDatePreview);
    document.getElementById('noDate').addEventListener('change', updateDatePreview);
    document.getElementById('name').addEventListener('input', () => {
      document.getElementById('days').value = '';
      document.getElementById('ddmm').value = '';
      // Typing a food we already know moves to its tab (the name stays)
      const known = FT.rememberedKind(packs, document.getElementById('name').value);
      if (known && known !== currentKind()) selectKind(known);
      applyNoDateRule();
      updateDatePreview();
      refreshUsuals();
    });

    document.getElementById('minus').addEventListener('click', () => changeCount(-1));
    document.getElementById('plus').addEventListener('click', () => changeCount(1));

    document.getElementById('addBtn').addEventListener('click', addPacks);

    // Date type: one pill, a tap flips Use by / Best before
    document.querySelectorAll('[data-dt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const other = document.querySelector(`[data-dt]:not([data-dt="${btn.dataset.dt}"])`);
        btn.classList.remove('on');
        other.classList.add('on');
        updateDatePreview();
      });
    });

    // Sheet actions
    document.getElementById('actUsed').addEventListener('click', actUsed);
    document.getElementById('actPart').addEventListener('click', actPart);
    document.getElementById('actThrown').addEventListener('click', actThrown);
    document.getElementById('actFreeze').addEventListener('click', actFreeze);
    document.getElementById('actDelete').addEventListener('click', actDelete);
    document.getElementById('actCancel').addEventListener('click', hideSheet);

    // Undo
    document.getElementById('undoBtn').addEventListener('click', async () => {
      await undo();
    });

    // Meals: slot tabs, next day
    document.querySelectorAll('#mtabs .sb').forEach(btn => {
      btn.addEventListener('click', () => { selSlot = btn.dataset.s; renderMeals(); });
    });
    document.getElementById('nextSlot').addEventListener('click', () => {
      selSlot = NEXT_SLOT[selSlot] || 'main';
      renderMeals();
    });
    document.getElementById('nextDay').addEventListener('click', () => {
      finishHad();
      const days = FT.mealDays(today);
      selDay = days[(days.indexOf(selDay) + 1) % 7];
      openDay = selDay;
      selSlot = 'main';
      pendingPlan = null;
      renderMeals();
    });

    // Add tab sub-tabs
    document.querySelectorAll('[data-sub]').forEach(btn => {
      btn.addEventListener('click', () => switchSub(btn.dataset.sub));
    });

    // Quick fill
    document.getElementById('qfPrompt').textContent = FT.CLAUDE_PROMPT;
    document.getElementById('qfCopy').addEventListener('click', copyQuickFillPrompt);
    document.getElementById('qfCheck').addEventListener('click', checkQuickFill);
    document.getElementById('qfAdd').addEventListener('click', addQuickFill);

    // Shopping list
    document.getElementById('shopForm').addEventListener('submit', addTypedShopItem);
    document.getElementById('clearAll').addEventListener('click', () => setClearAsk(true));
    document.getElementById('clrNo').addEventListener('click', () => setClearAsk(false));
    document.getElementById('clrYes').addEventListener('click', clearAllShop);
    document.getElementById('gotAll').addEventListener('click', gotAllShop);
    document.getElementById('clearGot').addEventListener('click', clearGotShop);
    document.getElementById('ideaBtn').addEventListener('click', () => {
      ideasOn = !ideasOn;
      renderIdeas();
    });
    document.querySelectorAll('#qtabs [data-q]').forEach(btn => {
      btn.addEventListener('click', () => {
        shopTab = btn.dataset.q;
        renderQuick();
        renderIdeas();
      });
    });
    // 📷 Read a sheet photo
    document.getElementById('scanBtn').addEventListener('click', openScan);
    document.getElementById('scanFile').addEventListener('change', readScanPhoto);
    document.getElementById('scanCancel').addEventListener('click', closeScan);
    document.getElementById('scanApply').addEventListener('click', applyScan);
    document.getElementById('scanRows').addEventListener('click', chooseScanMark);
    document.getElementById('scanFood').addEventListener('click', () => {
      closeScan();
      switchTab('add');
      switchSub('quick');
    });
    // Drag a .json file onto the app to load it into Quick fill
    document.body.addEventListener('dragover', e => e.preventDefault());
    document.body.addEventListener('drop', dropJsonFile);
  }

  async function dropJsonFile(e) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    const file = files.find(f => /\.json$/i.test(f.name) || /json|text/.test(f.type));
    if (!file) return;
    const text = await file.text();
    switchTab('add');
    switchSub('quick');
    document.getElementById('qfText').value = text;
    checkQuickFill();
  }

  // ---- Read a sheet photo (📷) ----
  let scanSheets = [];   // saved printed sheets, oldest first (as the server lists them)
  let scanChanges = null; // { sheet, changes: [{ no, id, name, mark, note, choice }] } while "Changes found" shows
  const CHIP_LABEL = { u: 'U', p: 'P', b: 'B', none: '–' };
  const CHIP_NAME = { u: 'Used', p: 'Part used', b: 'Binned', none: 'No change' };
  const NO_SHEET = 'No printed sheet yet. Print the fridge sheet first.';

  function scanMsg(text, err = false) {
    const el = document.getElementById('scanMsg');
    el.textContent = text;
    el.classList.toggle('err', err);
  }

  async function openScan() {
    scanChanges = null;
    document.getElementById('scanPanel').hidden = false;
    document.getElementById('scanPick').hidden = false;
    document.getElementById('scanChanges').hidden = true;
    scanMsg('');
    const sel = document.getElementById('scanSheet');
    sel.innerHTML = '';
    try {
      scanSheets = await DB.sheets.all();
    } catch (e) {
      scanSheets = [];
    }
    const newest = [...scanSheets].reverse();
    for (const sheet of newest) {
      const opt = document.createElement('option');
      opt.value = String(sheet.id);
      opt.textContent = `SHEET ${sheet.code} · printed ${FT.formatDate(String(sheet.printed).slice(0, 10))}`;
      sel.appendChild(opt);
    }
    if (!newest.length) scanMsg(NO_SHEET);
  }

  function closeScan() {
    document.getElementById('scanPanel').hidden = true;
    document.getElementById('scanFile').value = '';
    scanChanges = null;
  }

  // Photo → grayscale pixels, long side at most 1200px
  function photoToGray(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
          const width = Math.round(img.naturalWidth * scale);
          const height = Math.round(img.naturalHeight * scale);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, width, height);
          const data = ctx.getImageData(0, 0, width, height).data;
          const gray = new Uint8Array(width * height);
          for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
          }
          resolve({ gray, width, height });
        } catch (e) {
          reject(e);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('photo could not be loaded'));
      };
      img.src = url;
    });
  }

  async function readScanPhoto(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    const sheet = scanSheets.find(s => String(s.id) === document.getElementById('scanSheet').value);
    if (!sheet) {
      scanMsg(NO_SHEET);
      input.value = '';
      return;
    }
    scanMsg('Reading the photo…');
    let result = null;
    try {
      const img = await photoToGray(file);
      result = window.FT_OMR ? window.FT_OMR.readSheet(img, sheet.rows || []) : null;
    } catch (err) {
      result = null;
    }
    input.value = '';
    if (!result || !result.ok) {
      scanMsg("⚠️ Couldn't find the sheet. Take the photo flat, with all 4 black corners in.", true);
      return;
    }
    scanMsg('');
    const changes = FT.sheetChanges(sheet.rows || [], result.marks, packs);
    scanChanges = {
      sheet,
      changes: changes.map(c => ({ ...c, choice: c.mark === 'ask' ? null : c.mark }))
    };
    document.getElementById('scanPick').hidden = true;
    document.getElementById('scanChanges').hidden = false;
    renderScanChanges();
  }

  // Tap a letter on a change row: that choice wins
  function chooseScanMark(e) {
    const btn = e.target.closest('button[data-c]');
    if (!btn || !scanChanges) return;
    const no = btn.closest('.chg').dataset.no;
    const c = scanChanges.changes.find(x => x.no === no);
    if (!c) return;
    c.choice = btn.dataset.c;
    renderScanChanges();
  }

  function renderScanChanges() {
    const { changes } = scanChanges;
    document.getElementById('scanHead').textContent = `📷 Changes found · ${changes.length}`;
    const list = document.getElementById('scanRows');
    list.innerHTML = '';
    if (!changes.length) {
      const none = document.createElement('div');
      none.className = 'note';
      none.textContent = 'No marks on this photo for food still in the fridge.';
      list.appendChild(none);
    }
    for (const c of changes) {
      const row = document.createElement('div');
      const unresolved = c.mark === 'ask' && c.choice === null;
      row.className = 'chg' + (unresolved ? ' ask' : '');
      row.dataset.no = c.no;
      const chips = ['u', 'p', 'b', 'none'].map(k =>
        `<button type="button" class="${k}${c.choice === k ? ' on' : ''}" data-c="${k}" title="${CHIP_NAME[k]}" aria-label="${CHIP_NAME[k]}">${CHIP_LABEL[k]}</button>`
      ).join('');
      row.innerHTML = `<span><span class="no">${esc(c.no)}</span><b>${esc(c.name)}</b></span><span class="chips">${chips}</span>`;
      list.appendChild(row);
      if (c.note && (c.mark !== 'ask' || unresolved)) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = c.note;
        list.appendChild(note);
      }
    }
    const chosen = changes.filter(c => ['u', 'p', 'b'].includes(c.choice)).length;
    const ready = changes.every(c => !(c.mark === 'ask' && c.choice === null));
    const apply = document.getElementById('scanApply');
    apply.textContent = `✅ Apply all (${chosen})`;
    apply.disabled = !ready;
  }

  // Apply the chosen marks: Used, Part used or Binned, same as the fridge pop-up buttons
  async function applyScan() {
    if (!scanChanges) return;
    const todo = scanChanges.changes.filter(c => ['u', 'p', 'b'].includes(c.choice));
    closeScan();
    const writes = [];
    for (const c of todo) {
      const pack = packs.find(p => p.id === c.id);
      if (!pack) continue;
      if (c.choice === 'p') {
        writes.push(setPack(FT.partUse(pack, today)));
      } else if (c.choice === 'u') {
        const updated = FT.markUsed(pack, today);
        writes.push(setPack(updated), autoAddFinished(updated, 'used'));
      } else {
        const updated = FT.markThrown(pack, today);
        writes.push(setPack(updated), autoAddFinished(updated, 'thrown_away'));
      }
    }
    renderAll();
    await persistAll(writes);
  }

  function switchSub(sub) {
    document.querySelectorAll('[data-sub]').forEach(b => b.classList.remove('on'));
    document.querySelector(`[data-sub="${sub}"]`).classList.add('on');

    document.querySelectorAll('[data-sub-pane]').forEach(p => p.style.display = 'none');
    document.querySelector(`[data-sub-pane="${sub}"]`).style.display = '';

    if (sub === 'shop') renderShop();
  }

  function openShopList() {
    switchTab('add');
    switchSub('shop');
  }

  async function copyQuickFillPrompt() {
    const btn = document.getElementById('qfCopy');
    try {
      await navigator.clipboard.writeText(FT.CLAUDE_PROMPT);
      btn.textContent = 'Copied';
    } catch (e) {
      btn.textContent = 'Copy failed — select the text instead';
    }
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
  }

  let quickFillItems = [];
  let quickFillBoxes = [];
  let quickFillRowEls = [];

  const QF_KINDS = [['main', '🍖 Main'], ['side', '🥔 Side'], ['veg', '🥕 Veg'], ['misc', '🧂 Misc']];

  function clearQuickFillList() {
    quickFillItems = [];
    quickFillBoxes = [];
    quickFillRowEls = [];
    document.getElementById('qfList').innerHTML = '';
    document.getElementById('qfAdd').style.display = 'none';
  }

  function checkQuickFill() {
    const msg = document.getElementById('qfMsg');
    const listEl = document.getElementById('qfList');
    const result = FT.parseQuickFill(document.getElementById('qfText').value, today, packs);

    clearQuickFillList();
    if (result.error) {
      msg.textContent = result.error;
      return;
    }
    msg.textContent = '';

    quickFillItems = result.items;
    result.items.forEach((item, i) => {
      const rowEl = buildQuickFillRow(item, i);
      quickFillRowEls[i] = rowEl;
      listEl.appendChild(rowEl);
    });
    document.getElementById('qfAdd').style.display = '';
  }

  // One row: tick box, name, date, price; a food with no known kind gets 4 kind buttons
  function buildQuickFillRow(item, index) {
    const emojiMap = { main: '🍖', side: '🥔', veg: '🥕', misc: '🧂' };
    const row = document.createElement('label');
    row.className = 'srow qf-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = item.ok;
    box.disabled = !item.ok;
    quickFillBoxes[index] = box;
    row.appendChild(box);

    const text = document.createElement('span');
    const emoji = emojiMap[item.kind] || '📦';
    const when = document.createElement('span');
    if (item.date) {
      when.textContent = FT.formatDate(item.date);
      when.className = 'preview-' + FT.colour(item.date, today);
    } else {
      when.textContent = 'no date';
    }
    text.textContent = `${emoji} ${item.name || '(no name)'} ×${item.count} · `;
    text.appendChild(when);
    if (item.price !== null) {
      const price = document.createElement('span');
      price.className = 'qf-price';
      price.textContent = ` · £${item.price.toFixed(2)}`;
      text.appendChild(price);
    }
    if (item.toFreezer) text.append(' · 🧊');
    row.appendChild(text);

    if (!item.ok) {
      const problem = document.createElement('span');
      problem.className = 'qf-problem';
      problem.textContent = item.problem;
      row.appendChild(problem);
    }

    if (item.needsKind) {
      const group = document.createElement('div');
      group.className = 'qf-kind';
      QF_KINDS.forEach(([kind, label]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'qc';
        btn.dataset.kind = kind;
        btn.textContent = label;
        btn.addEventListener('click', e => {
          e.preventDefault();
          pickQuickFillKind(index, kind);
        });
        group.appendChild(btn);
      });
      row.appendChild(group);
    }

    return row;
  }

  // Re-check one row with the kind the user picked, and swap just that row
  function pickQuickFillKind(index, kind) {
    const item = quickFillItems[index];
    if (!item) return;
    const fixed = FT.quickFillRow({ ...item.raw, kind }, packs);
    quickFillItems[index] = fixed;
    const rowEl = buildQuickFillRow(fixed, index);
    quickFillRowEls[index].replaceWith(rowEl);
    quickFillRowEls[index] = rowEl;
  }

  async function addQuickFill() {
    const msg = document.getElementById('qfMsg');
    const chosen = quickFillItems.filter((item, i) => item.ok && quickFillBoxes[i].checked);
    if (chosen.length === 0) {
      msg.textContent = 'Tick at least one item to add';
      return;
    }

    const newPacks = chosen.flatMap(item => FT.makePacks({
      name: item.name, kind: item.kind, date: item.date, noDate: item.noDate,
      dateType: item.dateType, count: item.count, toFreezer: item.toFreezer,
      sub: item.sub, price: item.price
    }, today));

    try {
      const ids = [];
      for (const pack of newPacks) {
        const id = await DB.add(pack);
        pack.id = id;
        ids.push(id);
      }
      packs.push(...newPacks);
      lastAction = { type: 'add', ids };

      msg.textContent = `✓ added ${newPacks.length} packs`;
      showUndoBar();
      document.getElementById('qfText').value = '';
      clearQuickFillList();
      refreshUsuals();
      renderAll();
    } catch (dbErr) {
      msg.textContent = 'Error saving to database';
    }
  }

  function switchTab(tab) {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('on'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('on');

    document.querySelectorAll('[data-tab-pane]').forEach(p => p.style.display = 'none');
    document.querySelector(`[data-tab-pane="${tab}"]`).style.display = '';

    if (tab === 'fridge') {
      switchView('fridge');
    } else if (tab === 'add') {
      refreshUsuals();
    } else if (tab === 'meals') {
      renderMeals();
    }
  }

  function switchView(view) {
    document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('on'));
    document.querySelector(`[data-view="${view}"]`).classList.add('on');

    document.querySelectorAll('[data-view-pane]').forEach(p => p.style.display = 'none');
    document.querySelector(`[data-view-pane="${view}"]`).style.display = '';

    if (view === 'fridge') renderFridgeView();
    else if (view === 'freezer') renderFreezerView();
    else if (view === 'used') renderUsedView();
  }

  function currentKind() {
    return document.querySelector('.mtabs [data-kind].on')?.dataset.kind || 'main';
  }

  function selectKind(kind) {
    document.querySelectorAll('.mtabs [data-kind]').forEach(b => b.classList.remove('on'));
    document.querySelector(`.mtabs [data-kind="${kind}"]`).classList.add('on');
    // Veg starts ticked "No date"; other kinds untick, then the name decides
    document.getElementById('noDate').checked = kind === 'veg';
    applyNoDateRule();
    refreshUsuals();
    updateDatePreview();
  }

  // Ticks "No date" from the name: a food remembered with no date ticks it.
  // Veg stays ticked unless the food was last seen with a date.
  function applyNoDateRule() {
    const name = document.getElementById('name').value.trim();
    const noDate = document.getElementById('noDate');
    if (!name) {
      noDate.checked = currentKind() === 'veg';
      return;
    }
    if (currentKind() === 'veg') {
      const key = name.toLowerCase();
      const seen = packs.some(p => p.status !== 'deleted' && p.name.trim().toLowerCase() === key);
      noDate.checked = !seen || FT.rememberedNoDate(packs, name);
    } else {
      noDate.checked = FT.rememberedNoDate(packs, name);
    }
  }

  // With text in the name box: matching foods of every kind. Otherwise the usuals of this tab.
  function refreshUsuals() {
    const typed = document.getElementById('name').value.trim();
    const items = typed
      ? FT.searchFoods(packs, typed)
      : FT.usuals(packs, currentKind()).slice(0, 10).map(name => ({ name, kind: currentKind() }));
    const usuals = document.getElementById('usuals');
    usuals.innerHTML = '';
    items.forEach(({ name, kind }) => {
      const btn = document.createElement('button');
      btn.className = 'qc usual';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        document.getElementById('name').value = name;
        document.getElementById('days').value = '';
        document.getElementById('ddmm').value = '';
        if (kind !== currentKind()) selectKind(kind);
        applyNoDateRule();
        updateDatePreview();
      });
      usuals.appendChild(btn);
    });
  }

  function updateDatePreview() {
    const ddmm = document.getElementById('ddmm').value;
    const days = document.getElementById('days').value;
    const noDate = document.getElementById('noDate').checked;
    const preview = document.getElementById('datePreview');
    preview.className = 'datebox';

    if (noDate) {
      preview.textContent = 'No date · will show its age';
      return;
    }

    let date = null;
    if (ddmm) {
      date = FT.parseDDMM(ddmm, today);
    } else if (days) {
      date = FT.parseDays(days, today);
    }

    if (!date) {
      preview.textContent = ddmm.length >= 4 ? "That's not a real date, check it" : 'No date picked yet';
      if (ddmm.length >= 4) preview.className = 'datebox off';
      return;
    }

    const color = FT.colour(date, today);
    const daysLeft = FT.daysLeft(date, today);

    let text = FT.formatDate(date) + ' ' + date.slice(0, 4);
    if (daysLeft < 0) {
      text += ' · out of date, check?';
    } else if (daysLeft === 0) {
      text += ' · today';
    } else {
      text += ' · ' + daysLeft + (daysLeft === 1 ? ' day left' : ' days left');
    }

    preview.textContent = text;
    preview.className = 'datebox ' + { green: 'ok', amber: 'soon', red: 'off' }[color];
  }

  function setAddMsg(text, isError) {
    const el = document.getElementById('addMsg');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  function changeCount(delta) {
    const countEl = document.getElementById('count');
    let count = parseInt(countEl.textContent) || 1;
    count = Math.max(1, count + delta);
    countEl.textContent = count;
  }

  async function addPacks() {
    const name = document.getElementById('name').value;
    const kind = currentKind();
    const noDate = document.getElementById('noDate').checked;
    const count = parseInt(document.getElementById('count').textContent) || 1;
    const toFreezer = document.getElementById('toFreezer').checked;

    let date = null;
    if (!noDate) {
      const ddmm = document.getElementById('ddmm').value;
      const days = document.getElementById('days').value;
      if (ddmm) {
        date = FT.parseDDMM(ddmm, today);
      } else if (days) {
        date = FT.parseDays(days, today);
      }
    }

    let newPacks;
    try {
      newPacks = FT.makePacks({ name, kind, date, noDate, dateType: document.querySelector('[data-dt].on')?.dataset.dt || 'use_by', count, toFreezer }, today);
    } catch (err) {
      setAddMsg(err.message || 'Error', true);
      return;
    }

    try {
      const ids = [];
      for (const pack of newPacks) {
        pack.id = await DB.add(pack);
        ids.push(pack.id);
      }
      packs.push(...newPacks);
      lastAction = { type: 'add', ids };
    } catch (dbErr) {
      setAddMsg('Error saving to database', true);
      return;
    }

    setAddMsg(`✓ added ${count} × ${newPacks[0].name}`);
    showUndoBar();
    document.getElementById('name').value = '';
    document.getElementById('ddmm').value = '';
    document.getElementById('days').value = '';
    document.getElementById('count').textContent = '1';
    applyNoDateRule();
    updateDatePreview();
    refreshUsuals();
    renderAll();
  }

  let selectedPackId = null;

  function showSheet(packId) {
    selectedPackId = packId;
    const pack = packs.find(p => p.id === packId);
    if (!pack) return;

    document.getElementById('sheet').style.display = 'block';
    document.getElementById('sheet').querySelector('.title').textContent = pack.name;
    document.getElementById('sheet').querySelector('.subtitle').textContent = pack.date ? FT.formatDate(pack.date) : FT.ageLabel(pack.added, today);
  }

  function hideSheet() {
    document.getElementById('sheet').style.display = 'none';
    selectedPackId = null;
  }

  async function actUsed() {
    if (!selectedPackId) return;
    const pack = packs.find(p => p.id === selectedPackId);
    // Store complete copy before any changes
    const beforeState = JSON.parse(JSON.stringify(pack));
    const updated = FT.markUsed(pack, today);
    await DB.put(updated);
    Object.assign(pack, updated);
    const shopItem = await autoAddFinished(updated, 'used');
    lastAction = { type: 'update', packId: selectedPackId, before: beforeState, shopId: shopItem ? shopItem.id : null };
    hideSheet();
    showUndoBar();
    renderAll();
  }

  // Part used: some is left, so it stays in the fridge with a 3-day timer (no shopping list entry)
  async function actPart() {
    if (!selectedPackId) return;
    const pack = packs.find(p => p.id === selectedPackId);
    const beforeState = JSON.parse(JSON.stringify(pack));
    const updated = FT.partUse(pack, today);
    await DB.put(updated);
    Object.assign(pack, updated);
    lastAction = { type: 'update', packId: selectedPackId, before: beforeState };
    hideSheet();
    showUndoBar();
    renderAll();
  }

  async function actThrown() {
    if (!selectedPackId) return;
    const pack = packs.find(p => p.id === selectedPackId);
    const beforeState = JSON.parse(JSON.stringify(pack));
    const updated = FT.markThrown(pack, today);
    await DB.put(updated);
    Object.assign(pack, updated);
    const shopItem = await autoAddFinished(updated, 'thrown_away');
    lastAction = { type: 'update', packId: selectedPackId, before: beforeState, shopId: shopItem ? shopItem.id : null };
    hideSheet();
    showUndoBar();
    renderAll();
  }

  async function actFreeze() {
    if (!selectedPackId) return;
    const pack = packs.find(p => p.id === selectedPackId);
    const beforeState = JSON.parse(JSON.stringify(pack));
    const updated = FT.freeze(pack, today);
    await DB.put(updated);
    Object.assign(pack, updated);
    lastAction = { type: 'update', packId: selectedPackId, before: beforeState };
    hideSheet();
    showUndoBar();
    renderAll();
  }

  async function actDelete() {
    if (!selectedPackId) return;
    const pack = packs.find(p => p.id === selectedPackId);
    const beforeState = JSON.parse(JSON.stringify(pack));
    const updated = FT.markDeleted(pack, today);
    await DB.put(updated);
    Object.assign(pack, updated);
    lastAction = { type: 'update', packId: selectedPackId, before: beforeState };
    hideSheet();
    showUndoBar();
    renderAll();
  }

  function showUndoBar() {
    clearTimeout(undoTimeout);
    document.getElementById('undoBar').style.display = 'block';
    undoTimeout = setTimeout(() => {
      document.getElementById('undoBar').style.display = 'none';
    }, 6000);
  }

  async function undo() {
    if (!lastAction) return;

    try {
      if (lastAction.type === 'add') {
        for (const id of lastAction.ids) {
          await DB.remove(id);
        }
        packs = packs.filter(p => !lastAction.ids.includes(p.id));
      } else if (lastAction.type === 'batch') {
        for (const before of lastAction.befores) {
          const packIndex = packs.findIndex(p => p.id === before.id);
          if (packIndex === -1) continue;
          const restoredPack = JSON.parse(JSON.stringify(before));
          packs[packIndex] = restoredPack;
          await DB.put(restoredPack);
        }
      } else if (lastAction.type === 'update') {
        const packIndex = packs.findIndex(p => p.id === lastAction.packId);
        if (packIndex !== -1 && lastAction.before) {
          // Replace pack completely with restored state
          const restoredPack = JSON.parse(JSON.stringify(lastAction.before));
          packs[packIndex] = restoredPack;
          await DB.put(restoredPack);
        }
        // Undoing Used / Thrown away also takes off the item it added to the list
        if (lastAction.shopId) await removeShopItems(shop.filter(i => i.id === lastAction.shopId));
      }
    } finally {
      lastAction = null;
      document.getElementById('undoBar').style.display = 'none';
      renderAll();
    }
  }

  const STATUS_CLASS = { green: 'ok', amber: 'soon', red: 'off' };

  function packButton(pack) {
    const colour = FT.colour(pack.date, today);
    const btn = document.createElement('button');
    btn.className = 'pack ' + STATUS_CLASS[colour] + ' use-by-' + colour;
    btn.dataset.id = pack.id;
    return btn;
  }

  // A tap on any pack opens its action sheet
  function packTap(pack) {
    showSheet(pack.id);
  }

  function renderCards(el, cards) {
    el.innerHTML = '';
    cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = card.name;
      cardEl.appendChild(nameEl);
      const packsEl = document.createElement('div');
      packsEl.className = 'packs';
      card.packs.forEach(pack => {
        const btn = packButton(pack);
        const when = document.createElement('span');
        when.textContent = FT.countdown(pack.date, today);
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = pack.partUsed ? 'PART USED' : (pack.dateType === 'best_before' ? 'BB' : 'USE BY');
        if (plannedThisWeek(pack)) {
          btn.classList.add('plan');
          tag.textContent = '🍽️ ' + shortDay(pack.plannedFor);
        }
        btn.append(when, tag);
        btn.addEventListener('click', () => packTap(pack));
        packsEl.appendChild(btn);
      });
      cardEl.appendChild(packsEl);
      el.appendChild(cardEl);
    });
  }

  // Dated pack: name left, countdown right (coloured like the cards)
  function datedButton(pack) {
    const btn = packButton(pack);
    const name = document.createElement('span');
    name.textContent = pack.name + (pack.partUsed ? ' · part used' : '');
    const when = document.createElement('span');
    when.textContent = FT.countdown(pack.date, today);
    btn.append(name, when);
    btn.addEventListener('click', () => packTap(pack));
    return btn;
  }

  // Pack with no date: name left, age right (goes old after 7 days)
  function undatedButton(pack) {
    const old = FT.isOld(pack.added, today);
    const btn = document.createElement('button');
    btn.className = 'age' + (old ? ' old' : '');
    btn.dataset.id = pack.id;
    const name = document.createElement('b');
    name.textContent = pack.name;
    const age = document.createElement('span');
    age.textContent = FT.ageLabel(pack.added, today) + (old ? ' ⚠️' : '') + (pack.partUsed ? ' · part used' : '');
    btn.append(name, age);
    btn.addEventListener('click', () => packTap(pack));
    return btn;
  }

  // Use soon strip: fridge packs due within 2 days, tap opens the menu
  function renderUseSoon() {
    const soon = FT.useSoon(packs, today);
    const box = document.getElementById('useSoon');
    const list = document.getElementById('useSoonList');
    list.innerHTML = '';
    soon.forEach(pack => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (FT.colour(pack.date, today) === 'red' ? ' red' : '');
      chip.textContent = `${pack.name} · ${FT.countdown(pack.date, today)}`;
      chip.addEventListener('click', () => showSheet(pack.id));
      list.appendChild(chip);
    });
    box.hidden = soon.length === 0;
  }

  function renderFridgeView() {
    autoAddOutOfDate();
    const view = FT.fridgeView(packs, today);
    renderUseSoon();

    // Mains: cards, then undated mains
    document.getElementById('mainCount').textContent = view.mainCount;
    const mainsEl = document.getElementById('mains');
    renderCards(mainsEl, view.mains);
    view.mainsNoDate.forEach(pack => mainsEl.appendChild(undatedButton(pack)));

    // Sides: cards, then undated sides
    document.getElementById('sideCount').textContent = view.sideCount;
    const sidesEl = document.getElementById('sides');
    renderCards(sidesEl, view.sides);
    view.sidesNoDate.forEach(pack => sidesEl.appendChild(undatedButton(pack)));

    // Veg: dated ones show a countdown, undated ones show their age
    document.getElementById('vegCount').textContent = view.vegCount;
    const vegEl = document.getElementById('veg');
    vegEl.innerHTML = '';
    view.veg.forEach(pack => vegEl.appendChild(pack.date ? datedButton(pack) : undatedButton(pack)));

    // Misc: dated soonest first, then undated
    document.getElementById('miscCount').textContent = view.miscCount;
    const miscEl = document.getElementById('misc');
    miscEl.innerHTML = '';
    view.misc.forEach(pack => miscEl.appendChild(pack.date ? datedButton(pack) : undatedButton(pack)));

    // Deleted today or yesterday: red line, with Undo
    const deletedEl = document.getElementById('deletedList');
    deletedEl.innerHTML = '';
    FT.deletedList(packs, today).forEach(pack => {
      const rowEl = document.createElement('div');
      rowEl.className = 'srow gone';
      const nameEl = document.createElement('span');
      nameEl.className = 'name';
      nameEl.textContent = pack.name + (pack.date ? ' · ' + FT.formatDate(pack.date) : '');
      const tagEl = document.createElement('span');
      tagEl.className = 'gonetag';
      tagEl.textContent = 'deleted · gone tomorrow';
      const undoEl = document.createElement('button');
      undoEl.className = 'undo';
      undoEl.textContent = '↩ Undo';
      undoEl.addEventListener('click', async () => {
        const restored = { ...pack, status: 'in_fridge' };
        delete restored.del;
        await DB.put(restored);
        const i = packs.findIndex(p => p.id === pack.id);
        if (i !== -1) packs[i] = restored;
        renderAll();
      });
      rowEl.append(nameEl, tagEl, undoEl);
      deletedEl.appendChild(rowEl);
    });
  }

  function renderFreezerView() {
    const list = FT.freezerList(packs, today);
    const freezerEl = document.getElementById('freezerList');
    document.getElementById('freezerCount').textContent = list.length;
    freezerEl.innerHTML = '';
    if (!list.length) {
      freezerEl.innerHTML = '<div class="note">Freezer is empty.</div>';
    }

    list.forEach(item => {
      const rowEl = document.createElement('div');
      rowEl.className = 'srow frz' + (item.old ? ' old old3' : '');

      const emojiMap = { main: '🍖', side: '🥔', veg: '🥕', misc: '🧂' };
      const emoji = emojiMap[item.pack.kind] || '📦';

      const label = document.createElement('label');
      label.className = 'grow';
      label.style.cursor = 'default';
      label.append(`${emoji} `);
      const nameEl = document.createElement('span');
      nameEl.className = 'name';
      nameEl.textContent = item.pack.name;
      const tag = document.createElement('span');
      tag.className = 'tag label';
      tag.textContent = item.label;
      label.append(nameEl, ' ', tag);
      rowEl.appendChild(label);

      const btn = document.createElement('button');
      btn.className = 'undo defrost';
      btn.textContent = 'Defrost';
      btn.addEventListener('click', async () => {
        const updated = FT.defrost(item.pack, today);
        await DB.put(updated);
        Object.assign(item.pack, updated);
        lastAction = { type: 'update', packId: item.pack.id, before: item.pack };
        showUndoBar();
        renderAll();
      });
      rowEl.appendChild(btn);

      freezerEl.appendChild(rowEl);
    });
  }

  function renderUsedView() {
    const summary = FT.usedSummary(packs, today);
    document.getElementById('usedCount').textContent = summary.used;
    document.getElementById('wastedCount').textContent = summary.wasted;
    const takeaways = FT.takeawaySummary(meals, today);
    document.getElementById('takeawaySum').textContent =
      `🥡 Takeaways this month: ${takeaways.count} · £${takeaways.total.toFixed(2)}`;

    const listEl = document.getElementById('usedList');
    listEl.innerHTML = '';
    summary.list.forEach(pack => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      const used = pack.status === 'used';
      const name = document.createElement('span');
      name.className = 'name nm';
      name.textContent = pack.name;
      const right = document.createElement('span');
      right.append(`${FT.formatDate(pack.left || pack.date)} · `);
      const st = document.createElement('span');
      st.className = 'status st ' + (used ? 'u' : 'w');
      st.textContent = used ? 'Used' : 'Wasted';
      right.appendChild(st);
      rowEl.append(name, right);
      listEl.appendChild(rowEl);
    });
  }

  // ---- Meals: week planner ----

  const SLOT_LABEL = { main: 'Main', side: 'Side', veg: 'Veg' };

  function shortDay(iso) {
    return FT.formatDate(iso).split(' ')[0];
  }

  // Day name + date, for a card header
  function dayName(day) {
    const dn = document.createElement('span');
    dn.className = 'dn';
    dn.append(shortDay(day) + ' ');
    const date = document.createElement('small');
    date.textContent = FT.formatDate(day).split(' ').slice(1).join(' ');
    dn.appendChild(date);
    return dn;
  }

  function plannedThisWeek(pack) {
    return !!pack.plannedFor && FT.mealDays(today).includes(pack.plannedFor);
  }

  async function savePack(updated) {
    await DB.put(updated);
    const i = packs.findIndex(p => p.id === updated.id);
    if (i !== -1) packs[i] = updated;
  }

  // Change a pack in the list at once; the returned promise is the database write
  function setPack(updated) {
    packs = packs.map(p => (p.id === updated.id ? updated : p));
    return DB.put(updated);
  }

  function dropPack(pack) {
    packs = packs.filter(p => p.id !== pack.id);
    return DB.remove(pack.id);
  }

  // If a write fails, the list is reloaded from the database so the screen matches what was saved
  async function persistAll(writes) {
    try {
      await Promise.all(writes);
    } catch (e) {
      try {
        packs = await DB.all();
      } catch (err) {
        // keep what is on screen
      }
      renderMeals();
      renderAll();
    }
  }

  // Meals history: the record shows at once; the database write follows
  function saveMeal(record) {
    meals.push(record);
    return DB.meals.add(record).then(id => { record.id = id; });
  }

  // Plans more than 3 days old drop off: the list is changed at once, the database follows
  function dropExpiredPlans() {
    if (cleaning) return;
    cleaning = true;
    try {
      for (const p of FT.expiredPlans(packs, today)) {
        if (p.kind === 'takeaway') {
          packs = packs.filter(x => x.id !== p.id);
          DB.remove(p.id).catch(() => {});
        } else {
          const updated = FT.unplanPack(p);
          packs = packs.map(x => (x.id === p.id ? updated : x));
          DB.put(updated).catch(() => {});
        }
      }
    } finally {
      cleaning = false;
    }
  }

  // "Had this meal?" is asked for past days with a plan still waiting, plus askDay while it is open
  function pastDays() {
    const days = new Set(FT.pastToAsk(packs, today));
    if (askDay) days.add(askDay);
    return [...days].sort();
  }

  function inHad() {
    return !!askDay && pastState[askDay] === 'had';
  }

  // Close a "What did you have?" question early (another day was tapped): keep what was picked
  function finishHad() {
    if (!askDay) return;
    const day = askDay;
    const takeaway = pastState[day] === 'cost';
    const picked = hadPicked[day] || [];
    if (takeaway || picked.length) persistAll([saveMeal(FT.mealRecord(day, picked, { takeaway }))]);
    askDay = null;
    delete pastState[day];
    delete hadPicked[day];
  }

  // Tap a day header: open that day (closing any other), or close it if already open
  function toggleDay(day) {
    finishHad();
    if (openDay === day) {
      openDay = null;
    } else {
      openDay = day;
      selDay = day;
      selSlot = 'main';
      pendingPlan = null;
    }
    renderMeals();
  }

  function renderMeals() {
    dropExpiredPlans();
    const pane = document.querySelector('[data-tab-pane="meals"]');
    const picker = document.getElementById('picker');
    const dayListEl = document.getElementById('dayList');
    // Park the picker (hidden) before the day cards are rebuilt, so it is not destroyed
    pane.appendChild(picker);
    picker.hidden = true;
    dayListEl.innerHTML = '';

    pastDays().forEach(day => dayListEl.appendChild(pastCard(day, picker)));
    FT.mealDays(today).forEach(day => dayListEl.appendChild(dayCard(day, picker)));

    document.getElementById('nextDay').hidden = inHad();
    const nextSlot = document.getElementById('nextSlot');
    nextSlot.hidden = selSlot === 'veg';
    nextSlot.textContent = selSlot === 'main' ? 'Sides ▸' : 'Veg ▸';
    document.querySelectorAll('#mtabs .sb').forEach(t => t.classList.toggle('on', t.dataset.s === selSlot));
    document.getElementById('pickFor').textContent = 'Adding to ' + FT.formatDate(selDay);
    renderWarnBar();
    renderPickList();
    renderMealIdeas();
  }

  // ---- Meal ideas: combos eaten before, under the days ----

  // Day that a green + plans into: the open day if it is today or later, else today
  function ideaDay() {
    return openDay && openDay >= today ? openDay : today;
  }

  // Soonest free fridge pack for a food name; undated packs last
  function soonestFree(name) {
    const key = name.toLowerCase();
    const byDate = (a, b) => (!a.date) - (!b.date) || (a.date || '').localeCompare(b.date || '') || a.id - b.id;
    return packs
      .filter(p => p.status === 'in_fridge' && !p.plannedFor && p.name.toLowerCase() === key)
      .sort(byDate)[0] || null;
  }

  async function planIdea(idea) {
    const day = ideaDay();
    try {
      for (const item of idea.items) {
        const pack = soonestFree(item.name);
        if (pack) await savePack(FT.planPack(pack, day, item.slot));
      }
    } catch (e) {
      // a save failed: the screen below shows what was saved
    }
    renderMeals();
    renderAll();
  }

  // Grey +: put the missing foods on the shopping list
  async function shopIdea(idea, button) {
    for (const name of idea.missing) await autoAdd(name, 'for a meal');
    const sub = document.querySelector('#mealIdeas .sub');
    sub.textContent = 'Added to shopping list';
    setTimeout(() => { sub.textContent = 'Most had first · tap + to add to the open day'; }, 2500);
  }

  function renderMealIdeas() {
    const box = document.getElementById('mealIdeas');
    const list = box.querySelector('.il');
    const ideas = FT.mealIdeas(meals, packs);
    list.innerHTML = '';
    box.hidden = ideas.length === 0;
    for (const idea of ideas) {
      const row = document.createElement('div');
      row.className = 'idea';

      const t = document.createElement('div');
      t.className = 't';
      const b = document.createElement('b');
      b.textContent = idea.name;
      const span = document.createElement('span');
      const had = `had ${idea.count}×`;
      if (idea.missing.length) {
        span.className = 'miss';
        span.textContent = `${had} · need ${idea.missing.join(', ')}`;
      } else {
        span.textContent = `${had} · all in fridge`;
      }
      t.append(b, span);

      const plus = document.createElement('button');
      plus.className = 'plus' + (idea.missing.length ? ' off' : '');
      plus.type = 'button';
      plus.textContent = '+';
      plus.addEventListener('click', () => (idea.missing.length ? shopIdea(idea, plus) : planIdea(idea)));

      row.append(t, plus);
      list.appendChild(row);
    }
  }

  // A day in the next 7 days: header, and the picker when it is the open day
  function dayCard(day, picker) {
    const isToday = day === today;
    const isOpen = day === openDay && !inHad();
    const card = document.createElement('div');
    card.className = 'day' + (isOpen ? ' open' : '') + (isToday ? ' today' : '');

    const head = document.createElement('div');
    head.className = 'dh';
    head.setAttribute('role', 'button');
    head.setAttribute('aria-expanded', String(isOpen));
    head.tabIndex = 0;
    head.appendChild(dayName(day));
    if (isToday) {
      const tl = document.createElement('span');
      tl.className = 'tl';
      tl.textContent = 'Today';
      head.appendChild(tl);
    }

    const meals = FT.dayMeals(packs, day);
    meals.forEach(item => head.appendChild(mealChip(item, day)));
    if (meals.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = 'Tap to plan ›';
      head.appendChild(hint);
    }
    head.addEventListener('click', () => toggleDay(day));
    head.addEventListener('keydown', e => {
      if (e.target !== head) return; // chip ✕ buttons keep their own keys
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleDay(day);
      }
    });
    card.appendChild(head);

    if (isOpen) {
      const body = document.createElement('div');
      body.className = 'dbody';
      body.appendChild(picker);
      picker.hidden = false;
      card.appendChild(body);
    }
    return card;
  }

  // A past day with a plan still waiting: "Had this meal?" then how much was used, or the takeaway cost
  function pastCard(day, picker) {
    const state = pastState[day] || 'ask';
    const card = document.createElement('div');
    card.className = 'day past';

    const head = document.createElement('div');
    head.className = 'dh';
    head.appendChild(dayName(day));
    FT.dayMeals(packs, day).forEach(item => head.appendChild(mealChip(item, day)));
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'dbody past-body';
    const q = text => {
      const el = document.createElement('div');
      el.className = 'q';
      el.textContent = text;
      body.appendChild(el);
    };
    const button = (cls, label, onClick) => {
      const b = document.createElement('button');
      b.className = 'act ' + cls;
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    };
    const btns = () => {
      const row = document.createElement('div');
      row.className = 'btns';
      body.appendChild(row);
      return row;
    };

    if (state === 'ask') {
      q('Had this meal?');
      const row = btns();
      row.append(
        button('had-yes', '✅ Yes', () => answerYes(day)),
        button('had-no', '❌ No', () => answerNo(day)));
    } else if (state === 'use') {
      q('How much did you use?');
      const planned = FT.dayMeals(packs, day).filter(p => p.kind !== 'takeaway');
      planned.forEach(pack => {
        const row = document.createElement('div');
        row.className = 'use-row';
        row.dataset.id = pack.id;
        const name = document.createElement('b');
        name.textContent = pack.name;
        const seg = document.createElement('div');
        seg.className = 'seg';
        const all = document.createElement('button');
        all.type = 'button';
        all.className = 'all on';
        all.textContent = 'All used';
        const part = document.createElement('button');
        part.type = 'button';
        part.className = 'part';
        part.textContent = 'Part used';
        all.addEventListener('click', () => { all.classList.add('on'); part.classList.remove('on'); });
        part.addEventListener('click', () => { part.classList.add('on'); all.classList.remove('on'); });
        seg.append(all, part);
        row.append(name, seg);
        body.appendChild(row);
      });
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = 'Part used stays in the fridge · use within 3 days';
      body.appendChild(note);
      btns().appendChild(button('had-done', 'Done', () => {
        const rows = [...body.querySelectorAll('.use-row')].map(el => ({
          pack: planned.find(p => String(p.id) === el.dataset.id),
          part: el.querySelector('.part').classList.contains('on')
        }));
        finishUse(day, rows);
      }));
    } else if (state === 'cost') {
      q('How much was it?');
      const input = document.createElement('input');
      input.className = 'cost-in';
      input.type = 'text';
      input.inputMode = 'decimal';
      input.placeholder = '£';
      body.appendChild(input);
      const row = btns();
      row.append(
        button('cost-skip', 'Skip', () => finishCost(day, null)),
        button('cost-save', 'Save', () => finishCost(day, input.value)));
    } else if (state === 'had') {
      q('What did you have?');
      body.appendChild(picker);
      picker.hidden = false;
      const picked = (hadPicked[day] || []).length;
      btns().appendChild(button('had-skip', picked ? 'Done' : 'Skip', endHad));
    }

    card.appendChild(body);
    return card;
  }

  function mealChip(item, day) {
    const isTakeaway = item.kind === 'takeaway';
    const late = !isTakeaway && FT.outByDay(item, day) > 0;

    const chip = document.createElement('div');
    chip.className = 'chip2' + (late ? ' warn' : '');
    const label = document.createElement('span');
    const slot = document.createElement('span');
    slot.className = 'slot';
    slot.textContent = isTakeaway ? 'Main' : SLOT_LABEL[item.slot];
    label.append(slot, ' ' + (isTakeaway ? '🥡 Takeaway' : item.name) + (late ? ' ⚠️' : ''));

    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Remove ' + item.name);
    x.addEventListener('click', e => {
      e.stopPropagation();
      removeMeal(item);
    });
    chip.append(label, x);
    return chip;
  }

  function renderWarnBar() {
    const bar = document.getElementById('warnBar');
    bar.innerHTML = '';
    bar.hidden = !pendingPlan;
    if (!pendingPlan) return;

    const { pack, day, slot } = pendingPlan;
    const n = FT.outByDay(pack, day);
    const text = document.createElement('span');
    text.textContent = `⚠️ ${pack.name} will be ${n} day${n > 1 ? 's' : ''} out by ${shortDay(day)}`;

    const btns = document.createElement('div');
    btns.className = 'btns';
    const yes = document.createElement('button');
    yes.className = 'act alt';
    yes.id = 'wYes';
    yes.textContent = 'Add anyway';
    yes.addEventListener('click', () => planMeal(pack, day, slot));
    const no = document.createElement('button');
    no.className = 'act ghost';
    no.id = 'wNo';
    no.textContent = 'Cancel';
    no.addEventListener('click', () => {
      pendingPlan = null;
      renderMeals();
    });
    btns.append(yes, no);
    bar.append(text, btns);
  }

  function renderPickList() {
    const listEl = document.getElementById('pickList');
    listEl.innerHTML = '';

    if (selSlot === 'main') {
      const ta = document.createElement('button');
      ta.className = 'item ta';
      const label = document.createElement('span');
      label.textContent = '🥡 Takeaway';
      ta.appendChild(label);
      ta.addEventListener('click', addTakeaway);
      listEl.appendChild(ta);
    }

    const rows = FT.mealPick(packs, selSlot);
    rows.forEach(row => {
      const p = row.pack;
      const btn = document.createElement('button');
      btn.className = 'item ' + (p.date ? STATUS_CLASS[FT.colour(p.date, today)] : 'nd');
      const name = document.createElement('span');
      name.textContent = row.name + (row.count > 1 ? ' ×' + row.count : '');
      const when = document.createElement('span');
      when.textContent = p.date ? FT.countdown(p.date, today) : FT.daysLeft(today, p.added) + 'd old';
      btn.append(name, when);
      btn.addEventListener('click', () => choosePick(p));
      listEl.appendChild(btn);
    });

    if (rows.length === 0) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = 'Nothing left here.';
      listEl.appendChild(note);
    }
  }

  // Past card, "Yes": a takeaway goes to the cost question, anything else to how much was used
  function answerYes(day) {
    finishHad();
    const hasTakeaway = FT.dayMeals(packs, day).some(p => p.kind === 'takeaway');
    pastState[day] = hasTakeaway ? 'cost' : 'use';
    renderMeals();
  }

  // Past card, "No": the plans come off the day, and the picker asks what was eaten instead
  function answerNo(day) {
    finishHad();
    const writes = FT.dayMeals(packs, day).map(p => (p.kind === 'takeaway' ? dropPack(p) : setPack(FT.unplanPack(p))));
    askDay = day;
    pastState[day] = 'had';
    hadPicked[day] = [];
    selDay = day;
    selSlot = 'main';
    pendingPlan = null;
    renderMeals();
    renderAll();
    return persistAll(writes);
  }

  // Past card, "Done" on use: all used goes on the shopping list if needed, part used stays in the fridge
  function finishUse(day, rows) {
    const planned = rows.map(r => r.pack).filter(Boolean);
    const writes = [];
    for (const { pack, part } of rows) {
      if (!pack) continue;
      if (part) {
        writes.push(setPack(FT.partUse(pack, today)));
      } else {
        const updated = FT.markUsed(pack, today);
        writes.push(setPack(updated), autoAddFinished(updated, 'used'));
      }
    }
    delete pastState[day];
    writes.push(saveMeal(FT.mealRecord(day, planned)));
    renderMeals();
    renderAll();
    return persistAll(writes);
  }

  // Takeaway cost: the takeaway goes, any other plans on the day come off, and the meal is kept
  function finishCost(day, cost) {
    const picked = hadPicked[day] || [];
    const writes = FT.dayMeals(packs, day).map(p => (p.kind === 'takeaway' ? dropPack(p) : setPack(FT.unplanPack(p))));
    writes.push(saveMeal(FT.mealRecord(day, picked, { takeaway: true, cost })));
    delete pastState[day];
    delete hadPicked[day];
    if (askDay === day) askDay = null;
    renderMeals();
    renderAll();
    return persistAll(writes);
  }

  // "Had" mode: a food picked is eaten now (marked used), and the slot moves on as in planning
  function hadPick(pack) {
    const day = askDay;
    const slot = selSlot;
    const updated = FT.markUsed(pack, today);
    hadPicked[day] = [...(hadPicked[day] || []), { ...updated, slot }];
    renderMeals();
    renderAll();
    return persistAll([setPack(updated), autoAddFinished(updated, 'used')]);
  }

  // Done / Skip in "had" mode: keep what was picked, then back to today
  function endHad() {
    finishHad();
    selDay = today;
    openDay = today;
    selSlot = 'main';
    pendingPlan = null;
    renderMeals();
  }

  // Tap a food: warn first if it will be out of date on that day
  async function choosePick(pack) {
    if (inHad()) return hadPick(pack);
    if (FT.outByDay(pack, selDay) > 0) {
      pendingPlan = { pack, day: selDay, slot: selSlot };
      renderMeals();
      return;
    }
    await planMeal(pack, selDay, selSlot);
  }

  async function planMeal(pack, day, slot) {
    pendingPlan = null;
    try {
      await savePack(FT.planPack(pack, day, slot));
    } catch (e) {
      // not saved: leave the picker as it was
      renderMeals();
      return;
    }
    renderMeals();
    renderAll();
  }

  async function addTakeaway() {
    if (inHad()) {
      // "had" mode: a takeaway asks for its cost
      pastState[askDay] = 'cost';
      renderMeals();
      return;
    }
    const day = selDay;
    if (!FT.dayMeals(packs, day).some(p => p.kind === 'takeaway')) {
      try {
        const takeaway = FT.makeTakeaway(day);
        takeaway.id = await DB.add(takeaway);
        packs.push(takeaway);
      } catch (e) {
        renderMeals();
        return;
      }
    }
    const days = FT.mealDays(today);
    selDay = days[(days.indexOf(day) + 1) % 7];
    openDay = selDay;
    selSlot = 'main';
    pendingPlan = null;
    renderMeals();
  }

  async function removeMeal(item) {
    try {
      if (item.kind === 'takeaway') {
        await DB.remove(item.id);
        packs = packs.filter(p => p.id !== item.id);
      } else {
        await savePack(FT.unplanPack(item));
      }
    } catch (e) {
      // not removed: the list stays as it was
    }
    renderMeals();
    renderAll();
  }

  function renderAll() {
    const todayEl = document.getElementById('today');
    todayEl.textContent = '📅 Today · ';
    const dateB = document.createElement('b');
    dateB.textContent = FT.formatDate(today);
    todayEl.appendChild(dateB);
    const activeView = document.querySelector('[data-view].on')?.dataset.view;
    if (activeView === 'fridge') renderFridgeView();
    else if (activeView === 'freezer') renderFreezerView();
    else if (activeView === 'used') renderUsedView();
  }

  // ---- Shopping list ----

  const TAB_NAME = { main: 'Mains', side: 'Sides', veg: 'Veg', other: 'Other' };

  function capitalise(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Is this name on the list (to get: not got, not deleted)?
  function onShopList(name) {
    const key = name.toLowerCase();
    return shop.some(i => !i.got && !i.del && i.name.toLowerCase() === key);
  }

  async function saveShop(item) {
    try {
      await DB.shop.put(item);
    } catch (e) {
      // not saved: the list still shows the change until the next start
    }
  }

  async function addShopItem(name, auto = null) {
    const item = { name, got: false, del: null, auto, added: today };
    item.id = await DB.shop.add(item);
    shop.push(item);
    renderShop();
    return item;
  }

  // Add an item with a reason, unless it is already to get
  async function autoAdd(name, auto) {
    const key = name.toLowerCase();
    if (autoBusy.has(key) || onShopList(name)) return null;
    autoBusy.add(key);
    try {
      return await addShopItem(name, auto);
    } catch (e) {
      return null;
    } finally {
      autoBusy.delete(key);
    }
  }

  // A finished misc pack goes on the list with a reason (returns the new item or null)
  async function autoAddFinished(pack, status) {
    const auto = FT.autoOnFinish(pack, status);
    return auto ? autoAdd(auto.name, auto.auto) : null;
  }

  // Misc packs 1-2 days out of date go on the list (once each)
  async function autoAddOutOfDate() {
    for (const row of FT.autoOutOfDate(packs, shop, today)) {
      await autoAdd(row.name, row.auto);
    }
  }

  async function addTypedShopItem(e) {
    e.preventDefault();
    const input = document.getElementById('shopIn');
    const name = capitalise(input.value.trim());
    if (!name) return;
    input.value = '';
    if (!onShopList(name)) await addShopItem(name);
    renderShop();
  }

  // Bought-before chip or Ideas "+": add it, or un-get it if it is crossed out
  async function tapShopName(name) {
    if (onShopList(name)) return;
    const key = name.toLowerCase();
    const crossed = shop.find(i => !i.del && i.got && i.name.toLowerCase() === key);
    if (crossed) {
      crossed.got = false;
      await saveShop(crossed);
      renderShop();
    } else {
      await addShopItem(name);
    }
  }

  async function removeShopItems(items) {
    for (const item of items) {
      try {
        await DB.shop.remove(item.id);
      } catch (e) {
        continue; // not removed: it stays on the list
      }
      shop = shop.filter(i => i !== item);
    }
    renderShop();
  }

  function setClearAsk(asking) {
    document.getElementById('clrAsk').hidden = !asking;
    document.getElementById('clearAll').hidden = asking;
  }

  async function clearAllShop() {
    setClearAsk(false);
    await removeShopItems(shop.slice());
  }

  async function clearGotShop() {
    await removeShopItems(shop.filter(i => i.got));
  }

  async function gotAllShop() {
    for (const item of shop) {
      if (item.got || item.del) continue;
      item.got = true;
      await saveShop(item);
    }
    renderShop();
  }

  function shopRow(item) {
    const gone = !!item.del;
    const row = document.createElement('div');
    row.className = 'srow' + (gone ? ' gone' : item.got ? ' got' : '');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = item.got;
    const label = document.createElement('label');
    label.textContent = item.name;
    if (item.auto) {
      const auto = document.createElement('span');
      auto.className = 'auto';
      auto.textContent = '🤖 auto · ' + item.auto;
      label.append(' ', auto);
    }
    if (gone) {
      box.disabled = true;
    } else {
      box.id = 'sh_' + item.id;
      label.htmlFor = box.id;
      box.addEventListener('change', async () => {
        item.got = box.checked;
        await saveShop(item);
        renderShop();
      });
    }
    row.append(box, label);

    if (gone) {
      const tag = document.createElement('span');
      tag.className = 'gonetag';
      tag.textContent = FT.daysLeft(item.del, today) === 0 ? 'gone tomorrow' : 'gone today';
      row.appendChild(tag);
    }
    if (gone || item.got) {
      const undo = document.createElement('button');
      undo.className = 'undo';
      undo.textContent = '↩ Undo';
      undo.addEventListener('click', async () => {
        item.got = false;
        item.del = null;
        await saveShop(item);
        renderShop();
      });
      row.appendChild(undo);
    }
    if (!gone) {
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '🗑️';
      del.setAttribute('aria-label', 'Delete ' + item.name + ' (not counted as bought)');
      del.addEventListener('click', async () => {
        item.del = today;
        await saveShop(item);
        renderShop();
      });
      row.appendChild(del);
    }
    return row;
  }

  function renderQuick() {
    document.querySelectorAll('#qtabs [data-q]').forEach(t => t.classList.toggle('on', t.dataset.q === shopTab));
    const box = document.getElementById('qchips');
    box.innerHTML = '';
    const names = FT.boughtBefore(packs, shopTab);
    if (names.length === 0) {
      const none = document.createElement('div');
      none.className = 'note';
      none.textContent = 'Nothing bought in this tab yet.';
      box.appendChild(none);
    }
    names.forEach(name => {
      const on = onShopList(name);
      const btn = document.createElement('button');
      btn.className = 'qc' + (on ? ' on' : '');
      btn.textContent = (on ? '✓ ' : '+ ') + name;
      btn.addEventListener('click', () => tapShopName(name));
      box.appendChild(btn);
    });
  }

  function renderShop() {
    const listEl = document.getElementById('shopList');
    listEl.innerHTML = '';
    FT.shopOrder(shop, today).forEach(item => listEl.appendChild(shopRow(item)));
    const left = shop.filter(i => !i.got && !i.del).length;
    document.getElementById('shopCount').textContent = left ? left + ' to get' : 'All got ✅';
    renderQuick();
    renderIdeas();
  }

  async function rateIdea(name, k) {
    ratings[name] = k;
    try {
      await DB.ratings.put({ name, rating: k });
    } catch (e) {
      // not saved: the star still shows until the next start
    }
    renderIdeas();
  }

  function ideaRow(row) {
    const el = document.createElement('div');
    el.className = 'irow' + (row.low ? ' low' : '');

    const text = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = row.name;
    const info = document.createElement('small');
    info.textContent = 'bought ' + row.count + '× · ' + (row.low ? "bored / didn't like" : 'rated ' + row.rating);
    text.append(name, info);

    const stars = document.createElement('div');
    stars.className = 'stars';
    for (let k = 1; k <= 5; k++) {
      const star = document.createElement('button');
      star.textContent = '★';
      star.className = k <= row.rating ? 'on' : '';
      star.setAttribute('aria-label', k + ' stars');
      star.addEventListener('click', () => rateIdea(row.name, k));
      stars.appendChild(star);
    }

    const add = document.createElement('button');
    add.className = 'qc';
    add.textContent = '+';
    add.setAttribute('aria-label', 'Add ' + row.name);
    add.addEventListener('click', () => tapShopName(row.name));

    el.append(text, stars, add);
    return el;
  }

  function renderIdeas() {
    const box = document.getElementById('ideaBox');
    box.innerHTML = '';
    box.hidden = !ideasOn;
    if (!ideasOn) return;
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = '💡 ' + TAB_NAME[shopTab] + ' ideas · best rated, then most bought';
    box.appendChild(tag);
    const rows = FT.ideas(packs, ratings, shopTab);
    if (rows.length === 0) {
      const none = document.createElement('div');
      none.className = 'note';
      none.textContent = 'Nothing bought in this tab yet.';
      box.appendChild(none);
    }
    rows.forEach(row => box.appendChild(ideaRow(row)));
  }

  // Start
  window.addEventListener('DOMContentLoaded', init);
})();
