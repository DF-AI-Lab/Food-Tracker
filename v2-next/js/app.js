(function() {
  let packs = [];
  let today = getToday();
  let lastAction = null;
  let undoTimeout = null;
  // Meal planner state
  let selDay = today;
  let selSlot = 'main';
  const NEXT_SLOT = { main: 'side', side: 'veg', veg: 'misc' };
  const NEXT_LABEL = { main: 'Next: Sides', side: 'Next: Veg', veg: 'Next: Misc' };
  let pendingPlan = null; // { pack, day, slot } waiting for "Add anyway"
  let openDay = today;    // day whose card is open (null = all closed); today is open on load
  let meals = [];         // meals history, saved in DB.meals
  let recipes = [];       // recipes, saved in DB.recipes
  let askDay = null;      // past day in "What did you have?" (or cost) mode
  let addingTonight = false; // after 5pm: tonight's card has its picker open again (+ Add)
  const pastState = {};   // past day -> 'ask' | 'use' | 'cost' | 'had'
  const hadPicked = {};   // past day -> foods picked in "had" mode
  let cleaning = false;   // guards dropExpiredPlans against re-entry
  // Shopping list state
  let shop = [];          // shopping items, saved in DB.shop
  let ratings = {};       // idea ratings: name -> 1..5, saved in DB.ratings
  let shopTab = 'main';   // "bought before" tab: main | side | veg | other
  let ideasOn = false;
  const autoBusy = new Set();
  let bellEntries = [];   // bell: what others did, from DB.activity
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
  function getHour() {
    const params = new URLSearchParams(window.location.search);
    const hourParam = params.get('hour');
    if (hourParam) return Number(hourParam);
    return new Date().getHours();
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
    const boxes = '<td class="bx"><span></span></td>'.repeat(4); // U P B N

    const section = sec => {
      const word = sec.title.replace(/[^A-Za-z ]/g, '').trim().toLowerCase();
      const more = word.charAt(0).toUpperCase() + word.slice(1);
      const rows = sec.rows.map(r =>
        `<tr data-id="${r.id}"><td class="id">${r.no}</td><td>${esc(r.name)}</td><td class="d">${esc(r.date)}</td>${boxes}</tr>`).join('');
      // The header is the table's first row, so DATE and U P B N line up with their columns
      const head = `<tr class="hd${sec.key === 'soon' ? ' soon' : ''}"><th colspan="2">${esc(sec.title)}</th>` +
        '<th class="d">DATE</th><th class="bx">U</th><th class="bx">P</th><th class="bx">B</th><th class="bx">N</th></tr>';
      const cols = '<colgroup><col class="c-id"><col><col class="c-d"><col class="c-bx"><col class="c-bx"><col class="c-bx"><col class="c-bx"></colgroup>';
      return `<table>${cols}${head}${rows}</table>` +
        (sec.more > 0 ? `<div class="more">+${sec.more} more ${esc(more)} · see app</div>` : '');
    };
    const column = secs => secs.map(section).join('');

    // The next 7 days, one box each, for writing meals in by hand
    const days = sheet.days.map(d => `<span class="day">${esc(d)}</span>`).join('');

    const hidden = sheet.total - sheet.shown;
    const footer = `${sheet.total} items${hidden > 0 ? ` (${hidden} more in app)` : ''} · U = Used · P = Part used · B = Binned · N = Need more`;

    return `<div class="ps-page">
  <i class="ps-mk ps-tl"></i><i class="ps-mk ps-tr"></i><i class="ps-mk ps-bl"></i><i class="ps-mk ps-br"></i>
  <header class="ps-head">
    <div><h1>🥶 Fridge sheet</h1><div class="ps-sub">printed ${esc(FT.formatDate(today))}, ${hhmm}</div></div>
    <div class="ps-code">SHEET ${esc(stamp.code)}</div>
  </header>
  <div class="ps-key">Mark with an ✕: U = Used · P = Part used · B = Binned · N = Need more (adds to shopping list)</div>
  <div class="ps-top"><div>${column(sheet.left)}</div><div>${column(sheet.right)}</div></div>
  <div class="ps-days">${days}</div>
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
      id: tr.dataset.id,
      name: tr.children[1].textContent.trim(),
      boxes: Array.from(tr.querySelectorAll('td.bx span')).map(rectOf)
    }));
    return window.FT_OMR.layoutFromRects(corners, rows);
  }

  // Fill the sheet, measure it (shown off-screen at A4 size for a moment), save it, then print
  async function printFridgeSheet() {
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
    // Save first. If the save fails, the photo can't be read later, so ask before printing
    if (rows) {
      try {
        await DB.sheets.add({ code: stamp.code, printed: stamp.printed, rows });
      } catch (e) {
        const printAnyway = confirm("This sheet couldn't be saved, so a photo of it can't be read later.\n\nClose the app and open it again, then print.\n\nPrint anyway?");
        if (!printAnyway) return;
      }
    }
    window.print();
  }

  async function init() {
    // V2 has no PC server: the version comes from js/version.js
    renderVersion({ version: window.FT_VERSION });
    await DB.open();
    // Sync sign on the Today line: redraw whenever online or waiting changes
    renderSync();
    if (DB.onStatus) DB.onStatus(renderSync);
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
    recipes = await DB.recipes.all();
    for (const r of await DB.ratings.all()) ratings[r.name] = r.rating;
    // Shop items deleted before yesterday are removed for good
    const expiredShop = FT.expiredShopDeletes(shop, today);
    try {
      for (const item of expiredShop) await DB.shop.remove(item.id);
      shop = shop.filter(i => !expiredShop.includes(i));
    } catch (e) {
      // try again next time the app starts
    }
    bellEntries = await DB.activity.all();
    setupTheme();
    setupEventListeners();
    renderAll();

    // Another phone changed something: reload the lists the same way init does, then redraw
    if (DB.onChange) {
      DB.onChange(async () => {
        await reloadData();
        renderAll();
      });
    }
  }

  // Read every list from the database again (after another phone or a restore changed them)
  async function reloadData() {
    packs = await DB.all();
    shop = await DB.shop.all();
    meals = await DB.meals.all();
    recipes = await DB.recipes.all();
    for (const r of await DB.ratings.all()) ratings[r.name] = r.rating;
    bellEntries = await DB.activity.all();
  }

  // Sync sign: ✅ synced · ⏳ N waiting · 📴 offline
  function renderSync() {
    const el = document.getElementById('sync');
    if (!el) return;
    const s = LOOK.syncText(DB.status());
    el.textContent = s.text;
    el.dataset.state = s.state;
  }

  // Short note under the top bar; hides itself after ms
  let noteTimer = null;
  function flashNote(text, ms) {
    const note = document.getElementById('updNote');
    clearTimeout(noteTimer);
    note.textContent = text;
    note.hidden = false;
    noteTimer = setTimeout(() => { note.hidden = true; }, ms);
  }

  // Version line at the bottom: "v<n> · <date>", or a warning when the files on disk are newer
  // than the server that is running (it needs a restart)
  function shortDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
  }

  function renderVersion(info) {
    const el = document.getElementById('ver');
    if (!el) return;
    const v = info && info.version;
    const disk = info && info.disk;
    el.classList.remove('stale');
    // No "version" field at all = a server from before version numbers, still running
    const oldServer = info && !('version' in info);
    if (!oldServer && !v) { el.textContent = 'v?'; return; }
    if (oldServer || (disk && disk.n !== v.n)) {
      el.textContent = 'New version waiting · Close the app and open it again';
      el.classList.add('stale');
      return;
    }
    el.textContent = ['v' + v.n, shortDate(v.date)].filter(Boolean).join(' · ');
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Settings → Look: Dark | Light, the one in use is pressed
    document.getElementById('themeDark').setAttribute('aria-pressed', String(theme !== 'light'));
    document.getElementById('themeLight').setAttribute('aria-pressed', String(theme === 'light'));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#94AB9C' : '#0A1210';
  }

  function setupTheme() {
    let stored = null;
    try { stored = localStorage.getItem('next.theme'); } catch (e) { /* ignore */ }
    applyTheme(stored === 'light' ? 'light' : 'dark');
  }

  function setTheme(theme) {
    applyTheme(theme);
    try { localStorage.setItem('next.theme', theme); } catch (e) { /* ignore */ }
  }

  function setupEventListeners() {
    // Look: Dark | Light (Settings)
    document.getElementById('themeDark').addEventListener('click', () => setTheme('dark'));
    document.getElementById('themeLight').addEventListener('click', () => setTheme('light'));
    document.getElementById('reloadApp').addEventListener('click', () => location.reload());
    document.getElementById('editBack').addEventListener('click', closeEditForm);

    // 🔔 What others did
    document.getElementById('bellBtn').addEventListener('click', openBell);
    document.getElementById('bellClose').addEventListener('click', closeBell);

    // 💾 Backups: the reminder, and Settings
    document.getElementById('backupYes').addEventListener('click', doBackup);
    document.getElementById('backupBtn').addEventListener('click', doBackup);
    document.getElementById('backupNo').addEventListener('click', () => {
      writeSnooze({ lastBackup: DB.lastBackup(), count: backupChanges });
      document.getElementById('backupAsk').hidden = true;
    });
    document.getElementById('restoreBtn').addEventListener('click', () => document.getElementById('restoreFile').click());
    document.getElementById('restoreFile').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (file) await restoreFrom(file);
      e.target.value = ''; // so the same file can be picked again
    });

    // Print: fill the A4 fridge sheet, then open the print dialog
    document.getElementById('printF').addEventListener('click', printFridgeSheet);
    // Mic: coming soon
    document.getElementById('mic').addEventListener('click', () => {
      document.getElementById('micNote').textContent = 'Voice input: coming soon';
    });

    // Tabs (the bottom bar's Fridge, Meals and + carry data-tab)
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    // Bottom bar: Used opens the used page (Shop is a [data-tab] above)
    document.querySelector('[data-nav="used"]').addEventListener('click', () => {
      switchTab('fridge');
      switchView('used');
    });
    setupAddBar();

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

    // Date type: Use by | Best before, the tapped one is picked
    document.querySelectorAll('[data-dt]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-dt]').forEach(b => b.classList.toggle('on', b === btn));
        updateDatePreview();
        renderAddBar();
      });
    });

    // Sheet actions
    document.getElementById('actUsed').addEventListener('click', actUsed);
    document.getElementById('actPart').addEventListener('click', actPart);
    document.getElementById('actThrown').addEventListener('click', actThrown);
    document.getElementById('actFreeze').addEventListener('click', actFreeze);
    document.getElementById('actEdit').addEventListener('click', openEditForm);
    document.getElementById('actDelete').addEventListener('click', actDelete);
    document.getElementById('actCancel').addEventListener('click', hideSheet);
    document.getElementById('editSave').addEventListener('click', saveEdit);
    document.getElementById('editCancel').addEventListener('click', closeEditForm);

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
    setupRecipes();
    document.getElementById('clearAll').addEventListener('click', () => setClearAsk(true));
    document.getElementById('clrNo').addEventListener('click', () => setClearAsk(false));
    document.getElementById('clrYes').addEventListener('click', clearAllShop);
    // Got all asks first: "Mark everything as got? Yes / No"
    document.getElementById('gotAll').addEventListener('click', () => setGotAsk(true));
    document.getElementById('gotYes').addEventListener('click', gotAllShop);
    document.getElementById('gotNo').addEventListener('click', () => setGotAsk(false));
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
  const NEED_NAME = 'Need more (adds to shopping list)';
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
      scanMsg("Couldn't find the sheet. Take the photo flat, with all 4 black corners in.", true);
      return;
    }
    scanMsg('');
    const changes = FT.sheetChanges(sheet.rows || [], result.marks, packs);
    scanChanges = {
      sheet,
      changes: changes.map(c => ({ ...c, choice: c.done || c.mark === 'ask' ? null : c.mark }))
    };
    document.getElementById('scanPick').hidden = true;
    document.getElementById('scanChanges').hidden = false;
    renderScanChanges();
  }

  // Tap a letter on a change row: that choice wins. Tap N: toggles need more.
  function chooseScanMark(e) {
    const btn = e.target.closest('button[data-c], button[data-n]');
    if (!btn || !scanChanges) return;
    const no = btn.closest('.chg').dataset.no;
    const c = scanChanges.changes.find(x => x.no === no);
    if (!c) return;
    if (btn.dataset.n !== undefined) c.need = !c.need;
    else c.choice = btn.dataset.c;
    renderScanChanges();
  }

  function renderScanChanges() {
    const { changes } = scanChanges;
    const real = changes.filter(c => !c.done); // "already done" rows are shown but not counted
    document.getElementById('scanHead').textContent = `Changes found · ${real.length}`;
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
      if (c.done) {
        row.className = 'chg done';
        row.dataset.no = c.no;
        row.innerHTML = `<span><span class="no">${esc(c.no)}</span><b>${esc(c.name)}</b></span><span class="note">already done</span>`;
        list.appendChild(row);
        continue;
      }
      const unresolved = c.mark === 'ask' && c.choice === null;
      row.className = 'chg' + (unresolved ? ' ask' : '');
      row.dataset.no = c.no;
      const chips = ['u', 'p', 'b', 'none'].map(k =>
        `<button type="button" class="${k}${c.choice === k ? ' on' : ''}" data-c="${k}" title="${CHIP_NAME[k]}" aria-label="${CHIP_NAME[k]}">${CHIP_LABEL[k]}</button>`
      ).join('');
      const need = `<button type="button" class="n${c.need ? ' on' : ''}" data-n title="${NEED_NAME}" aria-label="${NEED_NAME}">N</button>`;
      row.innerHTML = `<span><span class="no">${esc(c.no)}</span><b>${esc(c.name)}</b></span><span class="chips">${chips}${need}</span>`;
      list.appendChild(row);
      if (c.note && (c.mark !== 'ask' || unresolved)) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = c.note;
        list.appendChild(note);
      }
    }
    const chosen = real.filter(c => ['u', 'p', 'b'].includes(c.choice) || c.need).length;
    const ready = real.every(c => !(c.mark === 'ask' && c.choice === null));
    const apply = document.getElementById('scanApply');
    apply.textContent = `Apply all (${chosen})`;
    apply.disabled = !ready;
  }

  // Apply the chosen marks: Used, Part used or Binned, same as the fridge pop-up buttons
  async function applyScan() {
    if (!scanChanges) return;
    const todo = scanChanges.changes.filter(c => !c.done && (['u', 'p', 'b'].includes(c.choice) || c.need));
    closeScan();
    const writes = [];
    for (const c of todo) {
      const pack = packs.find(p => p.id === c.id);
      if (pack && c.choice === 'p') {
        writes.push(setPack(FT.partUse(pack, today)));
      } else if (pack && c.choice === 'u') {
        const updated = FT.markUsed(pack, today);
        writes.push(setPack(updated), autoAddFinished(updated, 'used'));
      } else if (pack && c.choice === 'b') {
        const updated = FT.markThrown(pack, today);
        writes.push(setPack(updated), autoAddFinished(updated, 'thrown_away'));
      }
      // autoAdd skips foods already on the list, so U + N adds once
      if (c.need) writes.push(autoAdd(c.name, 'need more'));
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
    updateNav();
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
    setTimeout(() => { btn.innerHTML = ICON('copy', 16) + '<span>Copy message</span>'; }, 2000);
  }

  let quickFillItems = [];
  let quickFillBoxes = [];
  let quickFillRowEls = [];

  const QF_KINDS = [['main', 'Main'], ['side', 'Side'], ['veg', 'Veg'], ['misc', 'Misc']];

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
    const kindName = { main: 'Main', side: 'Side', veg: 'Veg', misc: 'Misc' };
    const row = document.createElement('label');
    row.className = 'srow qf-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = item.ok;
    box.disabled = !item.ok;
    quickFillBoxes[index] = box;
    row.appendChild(box);

    const text = document.createElement('span');
    const kindTag = kindName[item.kind] || 'Food';
    const when = document.createElement('span');
    if (item.date) {
      when.textContent = FT.formatDate(item.date);
      when.className = 'preview-' + FT.colour(item.date, today);
    } else {
      when.textContent = 'no date';
    }
    text.textContent = `${item.name || '(no name)'} ×${item.count} · `;
    text.appendChild(when);
    if (item.price !== null) {
      const price = document.createElement('span');
      price.className = 'qf-price';
      price.textContent = ` · £${item.price.toFixed(2)}`;
      text.appendChild(price);
    }
    if (item.toFreezer) text.append(' · Freezer');
    const kindEl = document.createElement('small');
    kindEl.className = 'qf-kindtag';
    kindEl.textContent = kindTag;
    text.prepend(kindEl);
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
    // Shop is a sub-view of Add: the bottom bar's Shop opens it
    if (tab === 'shop') return openShopList();
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
    updateNav();
  }

  function switchView(view) {
    document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('on'));
    document.querySelector(`[data-view="${view}"]`).classList.add('on');

    document.querySelectorAll('[data-view-pane]').forEach(p => p.style.display = 'none');
    document.querySelector(`[data-view-pane="${view}"]`).style.display = '';

    if (view === 'fridge' || view === 'misc') renderFridgeView();
    else if (view === 'freezer') renderFreezerView();
    else if (view === 'used') renderUsedView();
    updateNav();
  }

  // ---- V2.5 look: which page is showing → bottom bar, top tabs, page title ----
  function currentPage() {
    const tab = document.querySelector('[data-tab].on')?.dataset.tab || 'fridge';
    if (tab === 'add') return document.querySelector('[data-sub].on')?.dataset.sub === 'shop' ? 'shop' : 'add';
    if (tab === 'meals') return 'meals';
    const view = document.querySelector('[data-view].on')?.dataset.view || 'fridge';
    return view === 'used' ? 'used' : view; // fridge | freezer | misc | used
  }

  const PAGE_TITLE = { fridge: 'Fridge', freezer: 'Freezer', misc: 'Misc', used: 'Used', meals: 'Meals', add: 'Add food', shop: 'Shopping' };
  const NAV_FOR = { fridge: 'fridge', freezer: 'fridge', misc: 'fridge', used: 'used', meals: 'meals', add: 'add', shop: 'shop' };

  function updateNav() {
    const page = currentPage();
    document.querySelectorAll('[data-nav]').forEach(b => {
      const on = b.dataset.nav === NAV_FOR[page];
      b.classList.toggle('cur', on); // not 'on': Fridge / Meals / + use 'on' for the open tab
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.body.dataset.page = page;
    document.getElementById('fridgeTabs').hidden = page === 'used';
    document.getElementById('subTabs').hidden = page === 'shop';
    document.getElementById('pageTitle').textContent = PAGE_TITLE[page];
    renderPageCount();
    renderAddBar();
  }

  // Small line beside / above the title: item counts, the week, the month
  function renderPageCount() {
    const page = currentPage();
    const count = document.getElementById('pageCount');
    const kicker = document.getElementById('pageKicker');
    const view = FT.fridgeView(packs, today);
    const items = n => n === 1 ? '1 item' : n + ' items';
    let right = '', above = '';
    if (page === 'fridge') right = items(view.mainCount + view.sideCount + view.vegCount);
    else if (page === 'misc') right = items(view.miscCount);
    else if (page === 'freezer') right = items(FT.freezerList(packs, today).length);
    else if (page === 'used') above = new Date(today + 'T00:00:00Z').toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }) + ' so far';
    else if (page === 'meals') {
      const days = FT.mealDays(today);
      above = FT.formatDate(days[0]).replace(/ \w+$/, '') + ' – ' + FT.formatDate(days[days.length - 1]).replace(/^\w+ /, '');
    } else if (page === 'shop') {
      const left = shop.filter(i => !i.got && !i.del).length;
      const got = shop.filter(i => i.got && !i.del).length;
      above = `${left} to buy · ${got} got`;
    }
    count.textContent = right;
    kicker.textContent = above;
    kicker.hidden = !above;
  }

  // Top tabs: Fridge · N | Freezer · N | Misc · N
  function renderTabCounts() {
    const view = FT.fridgeView(packs, today);
    document.getElementById('tabFridgeN').textContent = view.mainCount + view.sideCount + view.vegCount;
    document.getElementById('tabMiscN').textContent = view.miscCount;
    document.getElementById('tabFreezerN').textContent = FT.freezerList(packs, today).length;
  }

  // ---- Add bar: pinned on top of the keyboard, or above the bottom bar ----
  function addSpec() {
    const noDate = document.getElementById('noDate').checked;
    let date = null;
    if (!noDate) {
      const ddmm = document.getElementById('ddmm').value;
      const days = document.getElementById('days').value;
      if (ddmm) date = FT.parseDDMM(ddmm, today);
      else if (days) date = FT.parseDays(days, today);
    }
    const count = parseInt(document.getElementById('count').textContent) || 1;
    return { name: document.getElementById('name').value.trim(), noDate, date, count,
      toFreezer: document.getElementById('toFreezer').checked };
  }

  function renderAddBar() {
    const bar = document.getElementById('addBar');
    if (!bar) return;
    const spec = addSpec();
    const show = currentPage() === 'add' && document.querySelector('[data-sub].on')?.dataset.sub === 'fridge' && !!spec.name;
    bar.hidden = !show;
    document.body.classList.toggle('has-addbar', show);
    if (!show) return;
    const name = spec.name.charAt(0).toUpperCase() + spec.name.slice(1);
    document.getElementById('abName').textContent = name;
    const when = spec.noDate ? 'No date' : spec.date ? FT.formatDate(spec.date) : 'No date yet';
    const where = spec.toFreezer ? 'Freezer' : 'Fridge';
    document.getElementById('abSum').textContent = `${when} · ${spec.count} pack${spec.count === 1 ? '' : 's'} · ${where}`;
    const frz = document.getElementById('barFreezer');
    frz.setAttribute('aria-pressed', String(spec.toFreezer));
    frz.setAttribute('aria-label', spec.toFreezer ? 'Send to fridge instead' : 'Send to freezer instead');
    document.getElementById('addBtn').setAttribute('aria-label', `Add ${name} to ${where.toLowerCase()}`);
  }

  // The keyboard takes the bottom of the screen: lift the bar by that much and hide the bottom bar
  function placeAddBar() {
    const vv = window.visualViewport;
    const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    const open = kb > 80;
    document.body.classList.toggle('kb-open', open);
    document.documentElement.style.setProperty('--kb', open ? kb + 'px' : '0px');
  }

  function setupAddBar() {
    ['name', 'ddmm', 'days'].forEach(id => document.getElementById(id).addEventListener('input', renderAddBar));
    ['noDate', 'toFreezer'].forEach(id => document.getElementById(id).addEventListener('change', renderAddBar));
    ['minus', 'plus'].forEach(id => document.getElementById(id).addEventListener('click', renderAddBar));
    document.getElementById('barFreezer').addEventListener('click', () => {
      const box = document.getElementById('toFreezer');
      box.checked = !box.checked;
      renderAddBar();
    });
    // Enter on the keyboard does the same as Add
    ['name', 'ddmm', 'days'].forEach(id => document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter' && document.getElementById('name').value.trim()) {
        e.preventDefault();
        addPacks();
      }
    }));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', placeAddBar);
      window.visualViewport.addEventListener('scroll', placeAddBar);
    }
    placeAddBar();
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
        renderAddBar();
      });
      btn.classList.toggle('on', !!typed && name.toLowerCase() === typed.toLowerCase());
      usuals.appendChild(btn);
    });
  }

  function updateDatePreview() {
    const ddmm = document.getElementById('ddmm').value;
    const days = document.getElementById('days').value;
    const noDate = document.getElementById('noDate').checked;
    const preview = document.getElementById('datePreview');
    preview.className = 'datebox';
    renderAddBar();

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
    renderAddBar();
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

  // ✏️ Edit (step 7a): fill the form from the pack, then Save or Cancel
  let editingPackId = null;

  function editMsg(text) {
    document.getElementById('editMsg').textContent = text;
  }

  function openEditForm() {
    if (!selectedPackId) return;
    const pack = packs.find(p => p.id === selectedPackId);
    if (!pack) return;
    const id = selectedPackId;
    hideSheet();
    editingPackId = id;
    document.getElementById('editName').value = pack.name || '';
    document.getElementById('editSub').value = pack.sub || '';
    document.getElementById('editKind').value = pack.kind;
    document.getElementById('editDate').value = pack.date || '';
    document.getElementById('editDateType').value = pack.dateType || 'use_by';
    document.getElementById('editPrice').value = pack.price == null ? '' : String(pack.price);
    editMsg('');
    document.getElementById('editForm').hidden = false;
  }

  function closeEditForm() {
    document.getElementById('editForm').hidden = true;
    editingPackId = null;
    editMsg('');
  }

  async function saveEdit() {
    const pack = packs.find(p => p.id === editingPackId);
    if (!pack) { closeEditForm(); return; }
    let updated;
    try {
      updated = FT.editPack(pack, {
        name: document.getElementById('editName').value,
        sub: document.getElementById('editSub').value,
        kind: document.getElementById('editKind').value,
        date: document.getElementById('editDate').value,
        dateType: document.getElementById('editDateType').value,
        price: document.getElementById('editPrice').value,
      });
    } catch (err) {
      editMsg(err.message);
      return;
    }
    const beforeState = JSON.parse(JSON.stringify(pack));
    await DB.put(updated);
    Object.assign(pack, updated);
    lastAction = { type: 'update', packId: pack.id, before: beforeState };
    closeEditForm();
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

    // Undo only your own last tap: refuse if another phone changed these since
    const ids = lastAction.type === 'add' ? lastAction.ids
      : lastAction.type === 'batch' ? lastAction.befores.map(b => b.id)
      : [lastAction.packId];
    const current = {};
    for (const id of ids) {
      const pack = await DB.get(id);
      if (pack !== undefined) current[id] = pack;
    }
    if (FT.undoBlocked(ids, current, DB.uid)) {
      flashNote(FT.UNDO_BLOCKED_MSG, 4000);
      lastAction = null;
      document.getElementById('undoBar').style.display = 'none';
      return;
    }

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

  // One pack = one row: name (+ planned icon), date and days left, and a thin freshness line
  function packButton(pack) {
    const colour = FT.colour(pack.date, today);
    const btn = document.createElement('button');
    btn.className = 'pack row ' + STATUS_CLASS[colour] + ' use-by-' + colour;
    btn.dataset.id = pack.id;
    return btn;
  }

  // A tap on any pack opens its action sheet
  function packTap(pack) {
    showSheet(pack.id);
  }

  function rowTop(name, pack, rightEl) {
    const top = document.createElement('span');
    top.className = 'rtop';
    const nameEl = document.createElement('span');
    nameEl.className = 'rname';
    nameEl.textContent = name;
    if (pack.partUsed) {
      const part = document.createElement('small');
      part.className = 'part';
      part.textContent = 'part used';
      nameEl.append(' ', part);
    }
    if (plannedThisWeek(pack)) {
      const plan = document.createElement('span');
      plan.className = 'plan';
      plan.title = 'Planned for ' + shortDay(pack.plannedFor);
      plan.setAttribute('role', 'img');
      plan.setAttribute('aria-label', 'Planned for ' + shortDay(pack.plannedFor));
      plan.innerHTML = ICON('meals', 13, 2);
      nameEl.append(plan);
    }
    top.append(nameEl, rightEl);
    return top;
  }

  // Dated pack row: "Fri 16 Oct · 6 days" or "Today" / "1 day", line fills over a 5-day countdown
  function datedRow(pack, name) {
    const btn = packButton(pack);
    const state = LOOK.freshState(pack.date, today);
    btn.classList.add('st-' + state);
    const parts = LOOK.whenParts(pack.date, today);
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = parts.main;
    if (parts.sub) {
      const sub = document.createElement('span');
      sub.className = 'dim';
      sub.textContent = ' · ' + parts.sub;
      when.appendChild(sub);
    }
    if (pack.dateType === 'best_before') btn.title = 'Best before';
    const line = document.createElement('span');
    line.className = 'line';
    const fill = document.createElement('b');
    fill.style.width = LOOK.freshPct(FT.daysLeft(pack.date, today)) + '%';
    line.appendChild(fill);
    btn.append(rowTop(name, pack, when), line);
    btn.addEventListener('click', () => packTap(pack));
    return btn;
  }

  function renderCards(el, cards) {
    el.innerHTML = '';
    cards.forEach(card => card.packs.forEach(pack => el.appendChild(datedRow(pack, card.name))));
  }

  function datedButton(pack) {
    return datedRow(pack, pack.name);
  }

  // Pack with no date: name left, age right (amber after 7 days), no line
  function undatedButton(pack) {
    const old = FT.isOld(pack.added, today);
    const btn = document.createElement('button');
    btn.className = 'age row nodate' + (old ? ' old' : '');
    btn.dataset.id = pack.id;
    const age = document.createElement('span');
    age.className = 'when';
    age.textContent = FT.ageLabel(pack.added, today);
    btn.append(rowTop(pack.name, pack, age));
    btn.addEventListener('click', () => packTap(pack));
    return btn;
  }

  // Eat first: the use-soon packs (2 days or less), top 3, one per line; tap opens the menu
  function renderUseSoon() {
    const ef = LOOK.eatFirst(packs, today);
    const box = document.getElementById('useSoon');
    const list = document.getElementById('useSoonList');
    list.innerHTML = '';
    ef.lines.forEach(line => {
      const b = document.createElement('button');
      b.className = 'eatline ' + line.state;
      b.dataset.id = line.id;
      b.append(line.name + ' ');
      const w = document.createElement('em');
      w.textContent = line.word;
      b.appendChild(w);
      b.addEventListener('click', () => showSheet(line.id));
      list.appendChild(b);
    });
    const sub = document.getElementById('useSoonSub');
    const more = ef.more ? `+${ef.more} more soon` : '';
    sub.textContent = [ef.sub, more].filter(Boolean).join(' · ');
    sub.hidden = !sub.textContent;
    box.hidden = ef.lines.length === 0;
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

    // Empty boxes fold away; a whole empty page says how to fill it
    [['mains', view.mainCount], ['sides', view.sideCount], ['veg', view.vegCount], ['misc', view.miscCount]]
      .forEach(([id, n]) => { document.getElementById(id).closest('.fbox').hidden = n === 0; });
    document.getElementById('emptyFridge').hidden = view.mainCount + view.sideCount + view.vegCount > 0;
    document.getElementById('emptyMisc').hidden = view.miscCount > 0;
    renderTabCounts();

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
      tagEl.textContent = 'Deleted · gone tomorrow';
      const undoEl = document.createElement('button');
      undoEl.className = 'undo';
      undoEl.textContent = 'Undo';
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

  // Freezer: oldest first, each row has a blue line for how long it has been frozen (full at 3 months)
  function renderFreezerView() {
    const list = FT.freezerList(packs, today);
    const freezerEl = document.getElementById('freezerList');
    document.getElementById('freezerCount').textContent = list.length;
    freezerEl.innerHTML = '';
    freezerEl.classList.toggle('is-empty', !list.length);
    if (!list.length) {
      freezerEl.innerHTML = '<div class="empty">Freezer is empty.</div>';
    }

    list.forEach(item => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row frz' + (item.old ? ' old' : '');
      const days = FT.daysLeft(today, item.pack.frozen);

      const top = document.createElement('span');
      top.className = 'rtop';
      const nameEl = document.createElement('span');
      nameEl.className = 'rname name';
      nameEl.textContent = item.pack.name;
      const label = LOOK.frozenText(item.label);
      const when = document.createElement('span');
      when.className = 'when label';
      const cut = label.lastIndexOf(' · ');
      when.textContent = cut > 0 ? label.slice(0, cut) : label;
      if (cut > 0) {
        const age = document.createElement('span');
        age.className = 'dim';
        age.textContent = label.slice(cut);
        when.appendChild(age);
      }
      top.append(nameEl, when);

      const btn = document.createElement('button');
      btn.className = 'undo defrost';
      btn.textContent = 'Defrost';
      btn.setAttribute('aria-label', 'Defrost ' + item.pack.name);
      btn.addEventListener('click', async () => {
        const updated = FT.defrost(item.pack, today);
        await DB.put(updated);
        Object.assign(item.pack, updated);
        lastAction = { type: 'update', packId: item.pack.id, before: item.pack };
        showUndoBar();
        renderAll();
      });

      const line = document.createElement('span');
      line.className = 'line frz';
      const fill = document.createElement('b');
      fill.style.width = LOOK.freezerPct(days) + '%';
      fill.style.background = LOOK.freezerColour(days);
      line.appendChild(fill);

      const main = document.createElement('div');
      main.className = 'grow';
      main.append(top, line);
      rowEl.append(main, btn);
      freezerEl.appendChild(rowEl);
    });
    renderTabCounts();
  }

  // Used: this month's used / wasted tiles, takeaways, then the list grouped by day
  function renderUsedView() {
    const summary = FT.usedSummary(packs, today);
    document.getElementById('usedCount').textContent = summary.used;
    document.getElementById('wastedCount').textContent = summary.wasted;
    const total = summary.used + summary.wasted;
    document.getElementById('usedBar').style.width = (total ? Math.round(summary.used / total * 100) : 0) + '%';
    document.getElementById('wastedBar').style.width = (total ? Math.round(summary.wasted / total * 100) : 0) + '%';

    const takeaways = FT.takeawaySummary(meals, today);
    const tk = document.getElementById('takeawaySum');
    tk.innerHTML = `<span class="tkicon">${ICON('takeaway', 18)}</span><span class="grow"><b>Takeaways</b><small></small></span><span class="mono"></span>`;
    tk.querySelector('small').textContent = `${takeaways.count} this month`;
    tk.querySelector('.mono').textContent = `£${takeaways.total.toFixed(2)}`;

    const KIND = { main: 'Main', side: 'Side', veg: 'Veg', misc: 'Misc' };
    const listEl = document.getElementById('usedList');
    listEl.innerHTML = '';
    if (!summary.list.length) {
      listEl.innerHTML = '<div class="empty">Nothing used or wasted yet this month.</div>';
      return;
    }
    const groups = [];
    summary.list.forEach(pack => {
      const day = pack.left || pack.date;
      let g = groups[groups.length - 1];
      if (!g || g.day !== day) groups.push(g = { day, packs: [] });
      g.packs.push(pack);
    });
    groups.forEach(g => {
      const section = document.createElement('div');
      section.className = 'section';
      const head = document.createElement('h2');
      head.className = 'sec';
      head.textContent = g.day ? FT.formatDate(g.day) + ' ' : '';
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = '· ' + g.packs.length;
      head.appendChild(n);
      const card = document.createElement('div');
      card.className = 'rows card';
      g.packs.forEach(pack => {
        const used = pack.status === 'used';
        const rowEl = document.createElement('div');
        rowEl.className = 'row urow';
        const icon = document.createElement('span');
        icon.className = 'uicon ' + (used ? 'u' : 'w');
        icon.innerHTML = ICON(used ? 'check' : 'close', 12, 3);
        const text = document.createElement('span');
        text.className = 'grow';
        const name = document.createElement('span');
        name.className = 'name nm';
        name.textContent = pack.name;
        const kind = document.createElement('small');
        kind.textContent = KIND[pack.kind] || '';
        text.append(name, kind);
        const st = document.createElement('span');
        st.className = 'status st ' + (used ? 'u' : 'w');
        st.textContent = used ? 'Used' : 'Wasted';
        rowEl.append(icon, text, st);
        card.appendChild(rowEl);
      });
      section.append(head, card);
      listEl.appendChild(section);
    });
  }

  // ---- Meals: week planner ----

  const SLOT_LABEL = { main: 'Main', side: 'Side', veg: 'Veg', misc: 'Misc' };

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
    const days = new Set(FT.pastToAsk(packs, today, getHour()));
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
    addingTonight = false;
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

    const asked = pastDays();
    asked.forEach(day => dayListEl.appendChild(pastCard(day, picker)));
    FT.mealDays(today).filter(day => !asked.includes(day)).forEach(day => dayListEl.appendChild(dayCard(day, picker)));

    document.getElementById('nextDay').hidden = inHad() || (addingTonight && asked.includes(today));
    const nextSlot = document.getElementById('nextSlot');
    nextSlot.hidden = selSlot === 'misc' || selSlot === 'meal';
    nextSlot.textContent = NEXT_LABEL[selSlot] || 'Next: Sides';
    document.querySelectorAll('#mtabs .sb').forEach(t => t.classList.toggle('on', t.dataset.s === selSlot));
    document.getElementById('pickFor').textContent = 'Adding to ' + FT.formatDate(selDay);
    renderWarnBar();
    renderPickList();
    renderRecipes();
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
    const byDate = (a, b) => (!a.date) - (!b.date) || (a.date || '').localeCompare(b.date || '') || String(a.id).localeCompare(String(b.id));
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
      const had = `Had ${idea.count}×`;
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
      plus.innerHTML = ICON('add', 18, 2.2);
      plus.setAttribute('aria-label', idea.missing.length ? 'Put ' + idea.missing.join(', ') + ' on the shopping list' : 'Plan ' + idea.name);
      plus.addEventListener('click', () => (idea.missing.length ? shopIdea(idea, plus) : planIdea(idea)));

      row.append(t, plus);
      list.appendChild(row);
    }
  }

  // ---- Recipes (V3): a name, fresh foods checked against the fridge, other things ----

  let openRecipeId = null;   // the recipe whose ingredients are showing (one at a time)
  let editingRecipeId = null; // the recipe the form is editing (null = a new one)
  let recipeDraft = { fresh: [], other: [] };

  function setupRecipes() {
    document.getElementById('newRecipe').addEventListener('click', () => openRecipeForm(null));
    document.getElementById('recipeCancel').addEventListener('click', closeRecipeForm);
    document.getElementById('recipeSave').addEventListener('click', saveRecipe);
    document.getElementById('freshAdd').addEventListener('click', addDraftFresh);
    document.getElementById('freshIn').addEventListener('input', showFreshSuggest);
    document.getElementById('freshIn').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addDraftFresh(); }
    });
    document.getElementById('otherAdd').addEventListener('click', addDraftOther);
    document.getElementById('recipeShopAdd').addEventListener('click', addRecipeShop);
    document.getElementById('recipeShopSkip').addEventListener('click', () => {
      document.getElementById('recipeShop').hidden = true;
    });
  }

  function recipeFormMsg(text) {
    const el = document.getElementById('recipeMsg');
    el.textContent = text;
    el.hidden = !text;
  }

  // Open the form for a new recipe (r = null) or to edit one
  function openRecipeForm(r, freshNames = []) {
    editingRecipeId = r ? r.id : null;
    recipeDraft = r
      ? { fresh: [...r.fresh], other: r.other.map(o => ({ ...o })) }
      : { fresh: [], other: [] };
    if (!r) {
      // A new recipe may start with foods (from a planned day): unique names, first spelling kept
      for (const n of freshNames) {
        const t = String(n ?? '').trim();
        if (t && !recipeDraft.fresh.some(f => f.toLowerCase() === t.toLowerCase())) recipeDraft.fresh.push(t);
      }
    }
    document.getElementById('recipeName').value = r ? r.name : '';
    document.getElementById('freshIn').value = '';
    document.getElementById('otherName').value = '';
    document.getElementById('otherQty').value = '';
    clearFreshSuggest();
    recipeFormMsg('');
    document.getElementById('recipeForm').hidden = false;
    renderDraft();
    document.getElementById('recipeName').focus();
  }

  function closeRecipeForm() {
    editingRecipeId = null;
    recipeDraft = { fresh: [], other: [] };
    clearFreshSuggest();
    document.getElementById('recipeForm').hidden = true;
  }

  // "Meal?" on a planned day: a new recipe starting with that day's planned foods (not takeaways)
  function openMealRecipe(day) {
    const names = FT.dayMeals(packs, day).filter(p => p.kind !== 'takeaway').map(p => p.name);
    openRecipeForm(null, names);
    document.getElementById('recipeForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function addFreshName(name) {
    const input = document.getElementById('freshIn');
    input.value = '';
    clearFreshSuggest();
    if (name && !recipeDraft.fresh.some(f => f.toLowerCase() === name.toLowerCase())) recipeDraft.fresh.push(name);
    renderDraft();
    input.focus();
  }

  function addDraftFresh() {
    addFreshName(document.getElementById('freshIn').value.trim());
  }

  // Tap chips under the fresh food box while typing (foods already in the recipe are left out)
  function showFreshSuggest() {
    const box = document.getElementById('freshSuggest');
    const value = document.getElementById('freshIn').value;
    box.replaceChildren();
    if (!value.trim()) return;
    FT.suggestFoods(packs, value, recipeDraft.fresh).forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sug qc';
      b.textContent = '+ ' + s.name;
      b.addEventListener('click', () => addFreshName(s.name));
      box.appendChild(b);
    });
  }

  function clearFreshSuggest() {
    document.getElementById('freshSuggest').replaceChildren();
  }

  function addDraftOther() {
    const nameIn = document.getElementById('otherName');
    const qtyIn = document.getElementById('otherQty');
    const name = nameIn.value.trim();
    if (name) recipeDraft.other.push({ name, qty: qtyIn.value.trim() || null });
    nameIn.value = '';
    qtyIn.value = '';
    renderDraft();
    nameIn.focus();
  }

  // Draw the fresh chips and other rows from recipeDraft (names as typed; text set with textContent)
  function renderDraft() {
    const form = document.getElementById('recipeForm');
    const freshBox = form.querySelector('.fresh-list');
    const otherBox = form.querySelector('.other-list');
    freshBox.replaceChildren();
    recipeDraft.fresh.forEach((name, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip2 fresh-item';
      const inner = document.createElement('span');
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = name;
      inner.appendChild(nm);
      const rm = document.createElement('button');
      rm.className = 'x rm';
      rm.type = 'button';
      rm.textContent = '×';
      rm.setAttribute('aria-label', 'Remove ' + name);
      rm.addEventListener('click', () => { recipeDraft.fresh.splice(i, 1); renderDraft(); });
      chip.append(inner, rm);
      freshBox.appendChild(chip);
    });
    otherBox.replaceChildren();
    recipeDraft.other.forEach((o, i) => {
      const row = document.createElement('div');
      row.className = 'other-item';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = o.name;
      const qty = document.createElement('span');
      qty.className = 'qty';
      qty.textContent = o.qty || '';
      const rm = document.createElement('button');
      rm.className = 'rm';
      rm.type = 'button';
      rm.textContent = '×';
      rm.setAttribute('aria-label', 'Remove ' + o.name);
      rm.addEventListener('click', () => { recipeDraft.other.splice(i, 1); renderDraft(); });
      row.append(nm, qty, rm);
      otherBox.appendChild(row);
    });
  }

  async function saveRecipe() {
    const r = FT.makeRecipe({
      id: editingRecipeId,
      name: document.getElementById('recipeName').value,
      fresh: recipeDraft.fresh,
      other: recipeDraft.other
    });
    if (!r) {
      recipeFormMsg('Give the recipe a name, and at least one food or thing.');
      return;
    }
    try {
      if (r.id !== undefined) {
        await DB.recipes.put(r);
        recipes = recipes.map(x => (x.id === r.id ? r : x));
      } else {
        r.id = await DB.recipes.add(r);
        recipes.push(r);
      }
    } catch (e) {
      recipeFormMsg("Couldn't save the recipe. Try again.");
      return;
    }
    closeRecipeForm();
    openRecipeId = null;
    renderRecipes();
  }

  // "a, b and c" for a list of names
  function listNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  // "today", a weekday within the week ("Sun"), or the full date
  function plannedWhen(day) {
    if (day === today) return 'today';
    const days = Math.round((Date.parse(day) - Date.parse(today)) / 864e5);
    return days <= 6 ? shortDay(day) : FT.formatDate(day);
  }

  // What a recipe needs for the day: fridge foods found, missing names, out-of-date names
  function recipeCheckNow(r) {
    return FT.recipeCheck(r, packs, ideaDay());
  }

  function renderRecipes() {
    const card = document.querySelector('#recipes .rl');
    card.replaceChildren();
    const sorted = [...recipes].sort((a, b) => a.name.localeCompare(b.name));
    if (!sorted.length) {
      const empty = document.createElement('p');
      empty.className = 'rl-empty';
      empty.textContent = 'No recipes yet. Tap New recipe to add one.';
      card.appendChild(empty);
      return;
    }
    const day = ideaDay();
    for (const r of sorted) {
      const check = recipeCheckNow(r);
      const open = openRecipeId === r.id;
      const row = document.createElement('div');
      row.className = 'recipe';

      const head = document.createElement('div');
      head.className = 'recipe-head';
      const name = document.createElement('button');
      name.className = 'recipe-name';
      name.type = 'button';
      name.textContent = r.name;
      name.setAttribute('aria-expanded', String(open));
      name.addEventListener('click', () => {
        openRecipeId = openRecipeId === r.id ? null : r.id;
        renderRecipes();
      });
      const sub = document.createElement('span');
      sub.className = 'recipe-sub';
      const plannedDay = FT.recipePlannedDay(r, packs, today);
      if (plannedDay) {
        sub.textContent = 'Planned ' + plannedWhen(plannedDay);
      } else if (check.missing.length) {
        sub.classList.add('miss');
        sub.textContent = 'Need ' + listNames(check.missing);
      } else {
        sub.textContent = 'All in fridge';
      }
      head.append(name, sub);
      row.appendChild(head);

      if (open) {
        const body = document.createElement('div');
        body.className = 'recipe-body';
        for (const h of check.have) {
          const line = document.createElement('div');
          line.className = 'ing have' + (h.out > 0 ? ' out' : '');
          const b = document.createElement('b');
          b.textContent = h.name;
          const span = document.createElement('span');
          span.textContent = h.out > 0
            ? `${h.out} day${h.out === 1 ? '' : 's'} out of date by then`
            : 'in fridge';
          line.append(b, span);
          body.appendChild(line);
        }
        for (const food of check.missing) {
          const line = document.createElement('div');
          line.className = 'ing missing';
          const b = document.createElement('b');
          b.textContent = food;
          const span = document.createElement('span');
          span.textContent = 'need';
          line.append(b, span);
          body.appendChild(line);
        }
        for (const o of check.other) {
          const line = document.createElement('div');
          line.className = 'ing other';
          const b = document.createElement('b');
          b.textContent = o.name;
          const span = document.createElement('span');
          span.textContent = o.qty || '';
          line.append(b, span);
          body.appendChild(line);
        }

        const acts = document.createElement('div');
        acts.className = 'recipe-acts';
        const plan = document.createElement('button');
        plan.className = 'act recipe-plan';
        plan.type = 'button';
        plan.textContent = 'Plan for ' + FT.formatDate(day);
        plan.addEventListener('click', () => planRecipeNow(r));
        const edit = document.createElement('button');
        edit.className = 'act ghost recipe-edit';
        edit.type = 'button';
        edit.textContent = 'Edit';
        edit.addEventListener('click', () => openRecipeForm(r));
        const del = document.createElement('button');
        del.className = 'act ghost recipe-del';
        del.type = 'button';
        del.textContent = 'Delete';
        del.addEventListener('click', () => deleteRecipe(r));
        acts.append(plan, edit, del);
        body.appendChild(acts);
        row.appendChild(body);
      }
      card.appendChild(row);
    }
  }

  // Plan what is in the fridge for the day; then offer the missing foods for the shopping list
  async function planRecipeNow(r, day = ideaDay()) {
    const check = FT.recipeCheck(r, packs, day);
    const planned = FT.planRecipe(r, packs, day);
    try {
      for (const p of planned) await savePack(p);
    } catch (e) {
      // a save failed: the screen below shows what was saved
    }
    openRecipeId = null;
    renderMeals();
    renderAll();
    showRecipeShop(r, check);
  }

  // Missing fresh foods first, then cupboard things (with their amount), each ticked
  function showRecipeShop(r, check) {
    const panel = document.getElementById('recipeShop');
    const list = panel.querySelector('.rs-list');
    const warn = document.getElementById('recipeWarn');
    const names = FT.recipeShopNames(r, check);
    list.replaceChildren();
    names.forEach((name, i) => {
      if (i === check.missing.length && i > 0) {
        const lab = document.createElement('div');
        lab.className = 'rs-lab';
        lab.textContent = 'Check the cupboard';
        list.appendChild(lab);
      }
      const label = document.createElement('label');
      label.className = 'rs-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.value = name;
      const text = document.createElement('span');
      text.textContent = name;
      label.append(box, text);
      list.appendChild(label);
    });
    warn.textContent = check.outNames.length
      ? 'Out of date by then: ' + listNames(check.outNames)
      : '';
    warn.hidden = !check.outNames.length;
    panel.hidden = names.length === 0;
  }

  // Ticked names go on the shopping list (not those already to get)
  async function addRecipeShop() {
    const ticked = [...document.querySelectorAll('#recipeShop .rs-row input:checked')].map(b => b.value);
    for (const name of FT.recipeShopList(ticked, shop)) await autoAdd(name, 'for a meal');
    document.getElementById('recipeShop').hidden = true;
  }

  async function deleteRecipe(r) {
    if (!confirm('Delete ' + r.name + '?')) return;
    try {
      await DB.recipes.remove(r.id);
    } catch (e) {
      alert("Couldn't delete the recipe.");
      return;
    }
    recipes = recipes.filter(x => x.id !== r.id);
    if (openRecipeId === r.id) openRecipeId = null;
    renderRecipes();
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
    const mealBlocks = appendDayChips(head, day);
    if (meals.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.innerHTML = ICON('add', 14, 2.2) + 'Plan';
      head.appendChild(hint);
    }
    if (meals.some(p => p.kind !== 'takeaway')) {
      const meal = document.createElement('button');
      meal.type = 'button';
      meal.className = 'day-meal';
      meal.textContent = 'Meal?';
      meal.addEventListener('click', e => { e.stopPropagation(); openMealRecipe(day); });
      head.appendChild(meal);
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
    mealBlocks.forEach(b => card.appendChild(b));

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
    const mealBlocks = appendDayChips(head, day);
    card.appendChild(head);
    mealBlocks.forEach(b => card.appendChild(b));

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
      // One quiet line: "Used?" / "Had the takeaway?" with small Yes / No
      card.classList.add('asking');
      const row = document.createElement('div');
      row.className = 'askrow';
      const text = document.createElement('span');
      text.className = 'q-sm';
      text.textContent = LOOK.askText(FT.dayMeals(packs, day));
      const yes = button('had-yes mini', 'Yes', () => { addingTonight = false; answerYes(day); });
      const no = button('had-no mini', 'No', () => { addingTonight = false; answerNo(day); });
      row.append(text);
      if (FT.dayMeals(packs, day).some(p => p.kind !== 'takeaway')) {
        row.append(button('mini day-meal', 'Meal?', () => openMealRecipe(day)));
      }
      // Tonight (after 5pm) can still take more food: + Add opens the picker for today
      if (day === today) {
        const add = button('had-add mini', '', () => {
          addingTonight = !addingTonight;
          openDay = null; // only one picker: close any other open day
          selDay = today;
          selSlot = 'main';
          pendingPlan = null;
          renderMeals();
        });
        add.innerHTML = ICON(addingTonight ? 'close' : 'add', 14, 2.2) + (addingTonight ? 'Done' : 'Add');
        add.setAttribute('aria-expanded', String(addingTonight));
        row.append(add);
      }
      row.append(yes, no);
      body.appendChild(row);
      if (day === today && addingTonight) {
        body.appendChild(picker);
        picker.hidden = false;
      }
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

  // Planned foods on a day as chips: one meal chip per recipe, single foods as before.
  // Returns the meal foods blocks, to go under the card head.
  function appendDayChips(head, day) {
    const blocks = [];
    for (const g of FT.dayGroups(packs, day)) {
      if (g.type === 'meal') {
        const m = mealGroup(g, day);
        head.appendChild(m.chip);
        blocks.push(m.ings);
      } else {
        head.appendChild(mealChip(g.pack, day));
      }
    }
    return blocks;
  }

  // Meal cards open here, by day + recipe; kept across re-renders
  const openMeals = new Set();

  // A recipe's planned foods as one chip (tap: its foods drop down; ✕: the whole meal comes off)
  function mealGroup(g, day) {
    const key = day + '|' + g.mealId;
    const late = g.packs.some(p => FT.outByDay(p, day) > 0);

    const chip = document.createElement('div');
    chip.className = 'chip2 meal-chip' + (late ? ' warn' : '');
    chip.setAttribute('role', 'button');
    chip.tabIndex = 0;
    const label = document.createElement('span');
    const tag = document.createElement('span');
    tag.className = 'meal-tag';
    tag.textContent = 'MEAL';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = g.name;
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '▾';
    label.append(tag, nm, caret);
    if (late) label.title = 'Out of date by then';

    const x = document.createElement('button');
    x.className = 'x meal-x';
    x.type = 'button';
    x.innerHTML = ICON('close', 12, 2.4);
    x.setAttribute('aria-label', 'Remove ' + g.name);
    x.addEventListener('click', e => {
      e.stopPropagation();
      removeMealGroup(g, day);
    });
    chip.append(label, x);

    const ings = document.createElement('div');
    ings.className = 'meal-ings';
    for (const p of g.packs) {
      const row = document.createElement('div');
      row.className = 'meal-ing' + (FT.outByDay(p, day) > 0 ? ' warn' : '');
      const b = document.createElement('b');
      b.textContent = p.name;
      const when = document.createElement('span');
      when.textContent = p.date ? LOOK.whenText(p.date, today) : FT.ageLabel(p.added, today);
      row.append(b, when);
      ings.appendChild(row);
    }

    const isOpen = openMeals.has(key);
    ings.hidden = !isOpen;
    chip.setAttribute('aria-expanded', String(isOpen));
    const toggle = () => {
      const open = !openMeals.has(key);
      if (open) openMeals.add(key); else openMeals.delete(key);
      ings.hidden = !open;
      chip.setAttribute('aria-expanded', String(open));
    };
    chip.addEventListener('click', e => {
      e.stopPropagation();
      toggle();
    });
    chip.addEventListener('keydown', e => {
      if (e.target !== chip) return; // the ✕ keeps its own keys
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    });
    return { chip, ings };
  }

  // Take every food of a planned recipe off its day
  async function removeMealGroup(g, day) {
    try {
      for (const p of g.packs) await savePack(FT.unplanPack(p));
    } catch (e) {
      // some foods not removed: the day shows what is left
    }
    // An emptied day closes its picker (tap Plan to open it again)
    if (openDay === day && FT.dayMeals(packs, day).length === 0) openDay = null;
    renderMeals();
    renderAll();
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
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = isTakeaway ? 'Takeaway' : item.name;
    label.append(slot, nm);
    if (late) label.title = 'Out of date by then';

    const x = document.createElement('button');
    x.className = 'x';
    x.innerHTML = ICON('close', 12, 2.4);
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
    text.textContent = `${pack.name} will be ${n} day${n > 1 ? 's' : ''} out by ${shortDay(day)}`;

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

    if (selSlot === 'meal') {
      renderRecipePick(listEl);
      return;
    }

    if (selSlot === 'main') {
      const ta = document.createElement('button');
      ta.className = 'item ta';
      const label = document.createElement('span');
      label.innerHTML = ICON('takeaway', 16) + '<span>Takeaway</span>';
      ta.appendChild(label);
      ta.addEventListener('click', addTakeaway);
      listEl.appendChild(ta);
    }

    const rows = FT.mealPick(packs, selSlot);
    rows.forEach(row => {
      const p = row.pack;
      const btn = document.createElement('button');
      btn.className = 'item ' + (p.date ? 'st-' + LOOK.freshState(p.date, today) : 'nd');
      const name = document.createElement('span');
      name.textContent = row.name + (row.count > 1 ? ' ×' + row.count : '');
      const when = document.createElement('span');
      when.textContent = p.date ? LOOK.whenText(p.date, today) : FT.ageLabel(p.added, today);
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

  // Meals tab: one row per recipe; tap to plan it for the open day
  function renderRecipePick(listEl) {
    const sorted = [...recipes].sort((a, b) => a.name.localeCompare(b.name));
    for (const r of sorted) {
      const check = FT.recipeCheck(r, packs, selDay);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item' + (check.missing.length ? ' st-soon' : '');
      const name = document.createElement('span');
      name.textContent = r.name;
      const right = document.createElement('span');
      right.textContent = check.missing.length ? 'Need ' + listNames(check.missing) : 'All in fridge';
      btn.append(name, right);
      btn.addEventListener('click', () => planRecipeNow(r, selDay));
      listEl.appendChild(btn);
    }
    if (!sorted.length) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = 'No recipes yet. Tap New recipe on this page to add one.';
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
    // Planning tonight after 5pm turns today's card into "Used?": keep its picker open until Done
    if (day === today) addingTonight = true;
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

  // Top line: today's date (needs no stored data, so it shows before the database loads)
  function renderTopDate() {
    const todayEl = document.getElementById('today');
    todayEl.textContent = 'Today · ' + FT.formatDate(today);
  }

  function renderAll() {
    renderTopDate();
    const activeView = document.querySelector('[data-view].on')?.dataset.view;
    if (activeView === 'fridge' || activeView === 'misc') renderFridgeView();
    else if (activeView === 'freezer') renderFreezerView();
    else if (activeView === 'used') renderUsedView();
    if (packs) renderTabCounts();
    renderPageCount();
    renderBell();
    refreshBackup();
  }

  // ---- 🔔 What others did ----

  // uid -> name, from the household's members (names are not kept on their own)
  function bellNames() {
    const members = (window.FT_HOUSEHOLD && window.FT_HOUSEHOLD.members) || [];
    return Object.fromEntries(members.map(m => [m.uid, m.name]));
  }

  // "Seen up to" (ms), kept per phone. First time here: now.
  function bellSeenAt() {
    try {
      const stored = localStorage.getItem('next.bellSeen');
      if (stored) return Number(stored);
      const now = Date.now();
      localStorage.setItem('next.bellSeen', String(now));
      return now;
    } catch (e) { return Date.now(); }
  }

  // Everything in the list counts as seen once it is on screen
  function markBellSeen() {
    const feed = FT.activityFeed(bellEntries, DB.uid);
    const newest = feed.length ? feed[0].at : 0;
    try { localStorage.setItem('next.bellSeen', String(Math.max(Date.now(), newest))); } catch (e) { /* ignore */ }
  }

  function renderBellList() {
    const names = bellNames();
    const now = Date.now();
    const rows = FT.activityFeed(bellEntries, DB.uid).map(g =>
      `<li><span>${esc(FT.activityText(g, names[g.by]))}</span> <span class="when">${esc(FT.timeAgo(g.at, now))}</span></li>`);
    document.getElementById('bellList').innerHTML = rows.length ? rows.join('') : '<li class="none">Nothing yet</li>';
  }

  // The badge on 🔔: lines from others since the list was last open
  function renderBell() {
    const bell = document.getElementById('bell');
    const open = !bell.hidden;
    if (open) markBellSeen();
    const count = FT.unreadCount(bellEntries, DB.uid, bellSeenAt());
    const badge = document.getElementById('bellCount');
    badge.textContent = String(count);
    badge.hidden = count === 0;
    document.getElementById('bellBtn').setAttribute('aria-label', LOOK.bellLabel(count));
    // Alone in a household with nothing from anyone else: no bell to tap (local mode always has one)
    const members = window.FT_HOUSEHOLD ? window.FT_HOUSEHOLD.members.length : 2;
    const alone = members < 2 && FT.activityFeed(bellEntries, DB.uid).length === 0;
    document.getElementById('bellBtn').hidden = alone;
    if (open) renderBellList();
  }

  function openBell() {
    document.getElementById('bell').hidden = false;
    renderBell();
  }

  function closeBell() {
    document.getElementById('bell').hidden = true;
    renderBell();
  }

  // ---- 💾 Backups ----

  // Changes since the last backup, as last counted (the reminder shows this number)
  let backupChanges = 0;

  // The "No" to the reminder, kept per phone: { lastBackup, count } (try/catch: storage can be blocked)
  function readSnooze() {
    try { return JSON.parse(localStorage.getItem('next.backupSnooze')) || null; } catch (e) { return null; }
  }

  function writeSnooze(snooze) {
    try { localStorage.setItem('next.backupSnooze', JSON.stringify(snooze)); } catch (e) { /* ignore */ }
  }

  function clearSnooze() {
    try { localStorage.removeItem('next.backupSnooze'); } catch (e) { /* ignore */ }
  }

  // Settings: "Last backup: Sun 11 Oct" or "Never backed up"
  function renderBackupNote() {
    const note = document.getElementById('backupNote');
    if (note) note.textContent = FT.lastBackupLabel(DB.lastBackup());
  }

  // Show "Back up now?" once enough changes have built up since the last backup
  async function renderBackupAsk() {
    const last = DB.lastBackup();
    backupChanges = FT.changesSinceBackup(await DB.activity.all(), last);
    const due = FT.backupDue(backupChanges, readSnooze(), last);
    document.getElementById('backupAskText').textContent = `${backupChanges} changes since your last backup. Back up now?`;
    document.getElementById('backupAsk').hidden = !due;
  }

  // Redraw the reminder and the Settings line (called from renderAll, so after every change)
  async function refreshBackup() {
    renderBackupNote();
    try {
      await renderBackupAsk();
    } catch (e) {
      // try again after the next change
    }
  }

  // Make the backup file: share it when the phone can, else download it
  async function doBackup() {
    try {
      const data = {
        packs: await DB.all(),
        shop: await DB.shop.all(),
        meals: await DB.meals.all(),
        sheets: await DB.sheets.all(),
        ratings: await DB.ratings.all(),
        recipes: await DB.recipes.all(),
      };
      const backup = FT.backupFile(data, today, new Date().toISOString());
      // Android's Share menu won't take .json files, so a phone shares the same text as .txt
      const shareFile = new File([backup.text], backup.name.replace(/\.json$/, '.txt'), { type: 'text/plain' });
      let shared = false;
      if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
        try {
          await navigator.share({ files: [shareFile] });
          shared = true;
        } catch (e) {
          // Cancelled: not backed up. Any other problem: download it instead (below)
          if (e.name === 'AbortError') return;
        }
      }
      if (!shared) {
        const file = new File([backup.text], backup.name, { type: 'application/json' });
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = backup.name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      DB.setLastBackup(Date.now());
      clearSnooze();
      await refreshBackup();
    } catch (e) {
      alert("Couldn't make the backup.");
    }
  }

  // Restore from a backup file: ask first, then replace everything and redraw
  async function restoreFrom(file) {
    try {
      const r = FT.readBackup(await file.text());
      if (!r.ok) {
        alert(r.reason);
        return;
      }
      const made = Date.parse(r.data.made);
      const when = Number.isNaN(made) ? 'an unknown day' : FT.dayLabel(made);
      if (!confirm(`Replace everything with the backup from ${when}?\n\nAnything added or changed since then will be lost.`)) return;

      const current = {
        packs: await DB.all(),
        shop: await DB.shop.all(),
        meals: await DB.meals.all(),
        sheets: await DB.sheets.all(),
        ratings: await DB.ratings.all(),
        recipes: await DB.recipes.all(),
      };
      const plan = FT.restorePlan(current, r.data);
      const stores = { packs: DB, shop: DB.shop, meals: DB.meals, sheets: DB.sheets, ratings: DB.ratings, recipes: DB.recipes };
      for (const list of Object.keys(plan)) {
        for (const item of plan[list].put) await stores[list].put(item);
        for (const id of plan[list].remove) await stores[list].remove(id);
      }

      await reloadData();
      DB.setLastBackup(Date.now());
      clearSnooze();
      renderMeals();
      renderShop();
      renderAll();
    } catch (e) {
      alert("Couldn't restore the backup.");
    }
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

  function setGotAsk(asking) {
    document.getElementById('gotAsk').hidden = !asking;
    document.querySelector('.btns.sbot').hidden = asking;
  }

  async function gotAllShop() {
    setGotAsk(false);
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
      auto.textContent = 'Auto · ' + item.auto;
      if (/ran out|binned|out of date/i.test(item.auto)) auto.classList.add('red');
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
      undo.textContent = 'Undo';
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
      del.innerHTML = ICON('trash', 17);
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
      btn.innerHTML = ICON(on ? 'check' : 'add', 12, 2.6);
      btn.append(name);
      btn.addEventListener('click', () => tapShopName(name));
      box.appendChild(btn);
    });
  }

  function renderShop() {
    const listEl = document.getElementById('shopList');
    listEl.innerHTML = '';
    // Two sections: To buy, then Got (ticked, and deleted ones still showing Undo)
    const order = FT.shopOrder(shop, today);
    const section = (title, items, cls) => {
      if (!items.length) return;
      const head = document.createElement('h2');
      head.className = 'sec ' + cls;
      head.textContent = title + ' ';
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = '· ' + items.length;
      head.appendChild(n);
      const card = document.createElement('div');
      card.className = 'rows card';
      items.forEach(item => card.appendChild(shopRow(item)));
      const wrap = document.createElement('div');
      wrap.className = 'section';
      wrap.append(head, card);
      listEl.appendChild(wrap);
    };
    section('To buy', order.filter(i => !i.got && !i.del), 'tobuy');
    section('Got', order.filter(i => i.got || i.del), 'got');
    const left = shop.filter(i => !i.got && !i.del).length;
    document.getElementById('shopCount').textContent = left ? left + ' to get' : 'All got';
    renderPageCount();
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
      star.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
      star.className = k <= row.rating ? 'on' : '';
      star.setAttribute('aria-label', k + ' stars');
      star.addEventListener('click', () => rateIdea(row.name, k));
      stars.appendChild(star);
    }

    const add = document.createElement('button');
    add.className = 'qc';
    add.innerHTML = ICON('add', 14, 2.4);
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
    tag.textContent = TAB_NAME[shopTab] + ' ideas · best rated, then most bought';
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
  renderTopDate();
  window.addEventListener('DOMContentLoaded', () => (window.FT_READY || Promise.resolve()).then(init));
})();
