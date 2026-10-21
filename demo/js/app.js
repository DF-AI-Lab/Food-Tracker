(function() {
  let packs = [];
  let today = getToday();
  let lastAction = null;
  let undoTimeout = null;
  // Meal planner state
  let selDay = today;
  let selSlot = 'main';
  const NEXT_SLOT = { meal: 'main', main: 'side', side: 'veg', veg: 'misc' };
  const NEXT_LABEL = { meal: 'Next: Mains', main: 'Next: Sides', side: 'Next: Veg', veg: 'Next: Other' };
  let pendingPlan = null; // { pack, day, slot } waiting for "Add anyway"
  let openDay = today;    // day whose card is open (null = all closed); today is open on load
  let meals = [];         // meals history, saved in DB.meals
  let recipes = [];       // meals (V3), saved in DB.recipes, always through FT.normMeal
  let mealPlans = [];     // meal plans: one per meal on a day, saved in DB.mealPlans
  let feedback = [];      // ideas & feedback (Settings), saved in DB.feedback
  let byDateOn = false;   // Fridge: the By date list shows instead of the sections
  let stockOpen = false;  // Fridge: the Stock check panel is open
  let stockKey = 'main';  // Stock check: the section chosen
  let stockOk = new Set(); // Stock check: packs ticked "Still there" (this check only)
  // A "sitting" is a day's meal: its key is the day (tea) or day|dinner (FT.sitKey)
  let askDay = null;      // sitting in "What did you have?" (or cost) mode
  let addingDay = null;  // an asking sitting whose picker is open (+ Add); tonight after 5pm too
  let askOpen = null;    // the asking sitting whose card is open (tap its top to open or close)
  const pastState = {};   // sitting -> 'ask' | 'use' | 'cost' | 'had'
  const hadPicked = {};   // sitting -> foods picked in "had" mode
  let selMeal = 'tea';    // which meal the picker adds to: 'dinner' | 'tea'
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
    recipes = (await DB.recipes.all()).map(FT.normMeal);
    mealPlans = await DB.mealPlans.all();
    feedback = await DB.feedback.all();
    for (const r of await DB.ratings.all()) ratings[r.name] = r.rating;
    // Shop items deleted before yesterday are removed for good
    const expiredShop = FT.expiredShopDeletes(shop, today);
    try {
      for (const item of expiredShop) await DB.shop.remove(item.id);
      shop = shop.filter(i => !expiredShop.includes(i));
    } catch (e) {
      // try again next time the app starts
    }
    await foldShop();
    bellEntries = await DB.activity.all();
    // Meal plans from days long gone drop off; the rest are brought up to date with the fridge
    dropExpiredMealPlans();
    syncPlans();
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
    recipes = (await DB.recipes.all()).map(FT.normMeal);
    mealPlans = await DB.mealPlans.all();
    feedback = await DB.feedback.all();
    for (const r of await DB.ratings.all()) ratings[r.name] = r.rating;
    await foldShop();
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
    el.textContent = (v.prefix || 'v') + (v.label || v.n);
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
    try { stored = localStorage.getItem('v4demo.theme'); } catch (e) { /* ignore */ }
    applyTheme(stored === 'light' ? 'light' : 'dark');
  }

  function setTheme(theme) {
    applyTheme(theme);
    try { localStorage.setItem('v4demo.theme', theme); } catch (e) { /* ignore */ }
  }

  function setupEventListeners() {
    // Look: Dark | Light (Settings)
    document.getElementById('themeDark').addEventListener('click', () => setTheme('dark'));
    document.getElementById('themeLight').addEventListener('click', () => setTheme('light'));
    document.getElementById('reloadApp').addEventListener('click', () => location.reload());
    // Ideas & feedback (Settings)
    document.getElementById('fbIdea').addEventListener('click', () => saveFeedback('idea'));
    document.getElementById('fbProblem').addEventListener('click', () => saveFeedback('problem'));
    document.getElementById('fbCopy').addEventListener('click', copyFeedback);
    document.getElementById('editBack').addEventListener('click', closeEditForm);

    // 🔔 What others did
    document.getElementById('bellBtn').addEventListener('click', openBell);
    document.getElementById('bellClose').addEventListener('click', closeBell);

    // 💾 Backups: the reminder, and Settings
    document.getElementById('backupYes').addEventListener('click', doBackup);
    document.getElementById('useSoonMore').addEventListener('click', () => { eatAll = !eatAll; renderUseSoon(); });
    // App icon top left: home (the Fridge page), closing Settings if it is open
    document.getElementById('homeBtn').addEventListener('click', () => {
      document.getElementById('settings').hidden = true;
      switchTab('fridge');
    });
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
    // Fridge: By date list, and the Stock check panel
    document.getElementById('byDateBtn').addEventListener('click', () => { byDateOn = !byDateOn; renderByDate(); });
    document.getElementById('stockBtn').addEventListener('click', openStock);
    document.getElementById('stockDone').addEventListener('click', () => { stockOpen = false; renderStock(); });
    // Mic: coming soon
    document.getElementById('mic').addEventListener('click', () => {
      document.getElementById('micNote').textContent = 'Voice input: coming soon';
    });

    // Tabs (the bottom bar's Fridge, Meals and + carry data-tab)
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        // + while Add is already on Quick fill: open the camera for the next photo
        const onQuick = document.querySelector('[data-tab].on')?.dataset.tab === 'add'
          && document.querySelector('[data-sub].on')?.dataset.sub === 'quick';
        if (btn.dataset.tab === 'add' && onQuick) return document.getElementById('qfCamera').click();
        switchTab(btn.dataset.tab);
      });
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
    document.getElementById('barCancel').addEventListener('click', cancelAdd);

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
      selSlot = defaultSlot();
      selMeal = 'tea';
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
    document.getElementById('qfTake').addEventListener('click', () => document.getElementById('qfCamera').click());
    document.getElementById('qfSelect').addEventListener('click', () => document.getElementById('qfPick').click());
    document.getElementById('qfCamera').addEventListener('change', e => addPhotos(e.target.files, e.target));
    document.getElementById('qfPick').addEventListener('change', e => addPhotos(e.target.files, e.target));
    document.getElementById('qfShopTick').addEventListener('click', tickOffShopping);

    // Search: every key redraws the results; ✕ clears the box and the fridge page comes back
    document.getElementById('fridgeSearch').addEventListener('input', renderSearch);
    document.getElementById('searchClear').addEventListener('click', () => {
      document.getElementById('fridgeSearch').value = '';
      renderSearch();
    });

    // Shopping list
    document.getElementById('shopForm').addEventListener('submit', addTypedShopItem);
    setupMeals();
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

  const QF_KINDS = [['main', 'Main'], ['side', 'Side'], ['veg', 'Veg'], ['misc', 'Other'], ['cupboard', 'Cupboard']];

  function clearQuickFillList() {
    quickFillItems = [];
    quickFillBoxes = [];
    quickFillRowEls = [];
    document.getElementById('qfList').innerHTML = '';
    document.getElementById('qfAdd').style.display = 'none';
  }

  // Photos go straight to Claude. A photo taken while a scan runs waits in the queue; the gauge
  // counts done / total for the whole round, and the round resets when the queue empties.
  let scanQueue = [];
  let scanRound = null;   // { done, total, started } while photos are queued or being read
  let scanBusy = false;
  let photoSeq = 0;
  let qfShopMatches = []; // [{ item, box }] on the shopping list after Add ticked

  function addPhotos(files, input) {
    const list = Array.from(files || []);
    input.value = '';
    if (list.length === 0) return;
    document.getElementById('qfDone').hidden = true;
    scanRound = scanRound || { done: 0, total: 0, started: Date.now() };
    scanRound.total += list.length;
    document.getElementById('qfReadText').textContent = FT_PHOTOS.readingText(scanRound.total);
    scanQueue.push(...list);
    if (!scanBusy) runScanQueue();
  }

  async function runScanQueue() {
    scanBusy = true;
    try {
      while (scanQueue.length) await scanPhotos(scanQueue.splice(0));
    } finally {
      scanBusy = false;
      scanRound = null;
      document.getElementById('qfGauge').hidden = true;
    }
  }

  // Quick fill steps: 1 photo, 2 Claude reads, 3 check and add
  function setQfStep(step) {
    [1, 2, 3].forEach(n => {
      document.getElementById('qfStep' + n).className = n < step ? 'done' : n === step ? 'on' : '';
    });
  }

  function resetQfSteps() {
    setQfStep(1);
    document.getElementById('qfStep2Sub').textContent = 'Starts as soon as a photo is in';
    document.getElementById('qfStep2Sub').hidden = false;
    document.getElementById('qfStep3Sub').hidden = false;
  }

  // Photos -> Worker -> rows added to the end of the list (the list is not cleared)
  async function scanPhotos(list) {
    const round = scanRound;
    const gauge = document.getElementById('qfGauge');
    const msg = document.getElementById('qfMsg');
    msg.textContent = '';
    setQfStep(2);
    document.getElementById('qfStep2Sub').hidden = true;
    gauge.hidden = false;
    document.getElementById('qfReadText').textContent = FT_PHOTOS.readingText(round.total);

    const photos = [];
    for (const file of list) {
      try {
        photos.push({ id: 'p' + photoSeq++, jpeg: await FT_PHOTOS.shrink(file) });
      } catch (e) { /* a photo that will not open is skipped */ }
    }

    const names = [...new Set(packs.map(p => p.name.trim()))];
    const out = await FT_PHOTOS.scanAll(photos, {
      fetch: (u, i) => fetch(u, i), getToken: window.FT_TOKEN, household: window.FT_HOUSEHOLD?.id, names, today,
    });
    round.done += list.length;

    if (out.results.length > 0) {
      appendQuickFill(JSON.stringify(FT_PHOTOS.toQuickFill(out.results)));
      setQfStep(3);
      document.getElementById('qfStep2Sub').textContent = `${round.done} photos read`;
      document.getElementById('qfStep2Sub').hidden = false;
      document.getElementById('qfStep3Sub').hidden = true;
    }
    if (out.error) msg.textContent = out.error;
    else if (photos.length === 0) msg.textContent = "Couldn't read those photos — try others";
  }

  // The paste box builds a fresh list
  function checkQuickFill() {
    clearQuickFillList();
    appendQuickFill(document.getElementById('qfText').value, true);
  }

  // Rows go on the end of the list. A photo scan appends and marks its new rows NEW (older rows
  // lose the tag); the paste box (fresh) does not.
  function appendQuickFill(text, fresh = false) {
    const msg = document.getElementById('qfMsg');
    const listEl = document.getElementById('qfList');
    const result = FT.parseQuickFill(text, today, packs);
    if (!fresh) listEl.querySelectorAll('.qf-new').forEach(tag => tag.remove());
    if (result.error) {
      msg.textContent = result.error;
      return;
    }
    msg.textContent = '';
    const start = quickFillItems.length;
    result.items.forEach((item, j) => {
      const i = start + j;
      quickFillItems[i] = item;
      const rowEl = buildQuickFillRow(item, i, !fresh);
      quickFillRowEls[i] = rowEl;
      listEl.appendChild(rowEl);
    });
    document.getElementById('qfAdd').style.display = '';
  }

  // One row: tick box, name, date, price; a food with no known kind gets 4 kind buttons
  function buildQuickFillRow(item, index, isNew = false) {
    const row = document.createElement('label');
    row.className = 'srow qf-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = item.ok;
    box.disabled = !item.ok;
    quickFillBoxes[index] = box;
    row.appendChild(box);

    const kindEl = document.createElement('small');
    kindEl.className = 'qf-kindtag';
    kindEl.textContent = FT.kindLabel(item.kind) || 'Food';
    row.appendChild(kindEl);

    const text = document.createElement('span');
    text.className = 'qf-name';
    text.textContent = `${item.name || '(no name)'} ×${item.count}`;
    if (item.price !== null) {
      const price = document.createElement('span');
      price.className = 'qf-price';
      price.textContent = ` · £${item.price.toFixed(2)}`;
      text.appendChild(price);
    }
    if (item.toFreezer) text.append(' · Freezer');
    if (isNew) {
      const tag = document.createElement('span');
      tag.className = 'qf-new';
      tag.textContent = 'NEW';
      text.appendChild(tag);
    }
    row.appendChild(text);

    const when = document.createElement('span');
    when.className = 'qf-date';
    if (item.date) {
      when.textContent = FT.formatDate(item.date);
      when.classList.add('preview-' + FT.colour(item.date, today));
    } else {
      when.textContent = 'no date';
    }
    when.addEventListener('click', e => {
      e.preventDefault(); // inside the label: don't tick the box
      openQfDate(index, row);
    });
    row.appendChild(when);

    if (item.check === true) {
      const check = document.createElement('span');
      check.className = 'qf-check';
      check.textContent = 'CHECK';
      row.appendChild(check);
    }

    if (!item.ok) {
      const problem = document.createElement('span');
      problem.className = 'qf-problem';
      problem.textContent = item.problem === 'Needs a date' ? 'No date found' : item.problem;
      row.appendChild(problem);
    }

    if (item.problem === 'Needs a date') {
      const group = document.createElement('div');
      group.className = 'qf-kind';
      const addDate = document.createElement('button');
      addDate.type = 'button';
      addDate.className = 'qc';
      addDate.innerHTML = ICON('meals', 14, 2) + 'Add date';
      addDate.addEventListener('click', e => {
        e.preventDefault();
        openQfDate(index, row);
      });
      const noDate = document.createElement('button');
      noDate.type = 'button';
      noDate.className = 'qc';
      noDate.textContent = 'No date';
      noDate.addEventListener('click', e => {
        e.preventDefault();
        setQfDate(index, null);
      });
      group.append(addDate, noDate);
      row.appendChild(group);
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

    attachQfSwipe(row, index);
    return row;
  }

  // Swipe a row sideways to remove it (Pointer Events, so touch and mouse both work). Only a
  // sideways move starts a drag, so up and down scrolling still works (touch-action: pan-y in CSS).
  // Past 80px either way the row goes; under that it snaps back.
  function attachQfSwipe(row, index) {
    let startX = 0, startY = 0, mode = 'idle', dragged = false;
    row.addEventListener('pointerdown', e => {
      startX = e.clientX;
      startY = e.clientY;
      mode = 'pending';
      dragged = false;
    });
    row.addEventListener('pointermove', e => {
      if (mode === 'idle') return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (mode === 'pending') {
        if (Math.abs(dy) > Math.abs(dx)) { mode = 'idle'; return; } // up and down: a scroll
        if (Math.abs(dx) < 6) return;
        mode = 'drag';
        dragged = true;
        try { row.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no pointer to capture */ }
      }
      row.style.transition = 'none';
      row.style.transform = `translateX(${dx}px)`;
    });
    const end = e => {
      if (mode !== 'drag') { mode = 'idle'; return; }
      const dx = e.clientX - startX;
      mode = 'idle';
      if (Math.abs(dx) > 80) return removeQfRow(index, row);
      row.style.transition = 'transform .15s ease';
      row.style.transform = '';
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', () => {
      if (mode !== 'drag') return;
      mode = 'idle';
      row.style.transition = 'transform .15s ease';
      row.style.transform = '';
    });
    // A real drag ends with a click on the label (mouse): don't let it tick or untick the box
    row.addEventListener('click', e => {
      if (!dragged) return;
      dragged = false;
      e.preventDefault();
    });
  }

  // Take a swiped row off the list for good: it is marked so it is never added
  function removeQfRow(index, row) {
    const item = quickFillItems[index];
    if (item) quickFillItems[index] = { ...item, ok: false, removed: true };
    if (quickFillBoxes[index]) quickFillBoxes[index].checked = false;
    const next = row.nextElementSibling;
    if (next && (next.classList.contains('qf-quickdate') || next.classList.contains('qf-datein'))) next.remove();
    row.remove();
    if (!document.querySelector('#qfList .qf-row')) document.getElementById('qfAdd').style.display = 'none';
  }

  // Re-check one row with the kind the user picked, and swap just that row
  function pickQuickFillKind(index, kind) {
    const item = quickFillItems[index];
    if (!item) return;
    swapQuickFillRow(index, FT.quickFillRow({ ...item.raw, kind }, packs));
  }

  // Redraw one row after a change: it keeps its tick (a row that was not OK is ticked once fixed) and NEW tag
  function swapQuickFillRow(index, item) {
    const old = quickFillRowEls[index];
    const wasTicked = quickFillBoxes[index].checked;
    const wasOk = quickFillItems[index].ok;
    quickFillItems[index] = item;
    const rowEl = buildQuickFillRow(item, index, !!old.querySelector('.qf-new'));
    quickFillBoxes[index].checked = item.ok && (wasTicked || !wasOk);
    const next = old.nextElementSibling;
    if (next && (next.classList.contains('qf-datein') || next.classList.contains('qf-quickdate'))) next.remove();
    old.replaceWith(rowEl);
    quickFillRowEls[index] = rowEl;
  }

  // Tap a date (or Add date): a row of quick day buttons opens just under the row. It sits beside
  // the row, not inside it, because the row is a <label> and the label swallows taps on the native
  // calendar. Tapping the date again closes it.
  function openQfDate(index, rowEl) {
    const next = rowEl.nextElementSibling;
    if (next && (next.classList.contains('qf-quickdate') || next.classList.contains('qf-datein'))) {
      next.remove();
      return;
    }
    const box = document.createElement('div');
    box.className = 'qf-quickdate';
    [1, 2, 3, 5, 7].forEach(n => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qc';
      btn.textContent = '+' + n;
      btn.addEventListener('click', e => {
        e.preventDefault();
        setQfDate(index, FT.addDays(today, n));
      });
      box.appendChild(btn);
    });
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'qc';
    pick.textContent = 'Pick date';
    pick.addEventListener('click', e => {
      e.preventDefault();
      openQfDatePicker(index, box);
    });
    box.appendChild(pick);
    rowEl.after(box);
  }

  // Pick date: the box turns into a native date input. Each of change / input / blur saves the
  // value if it is a real date (the latest one wins); a value already saved, or a removed input,
  // is ignored.
  function openQfDatePicker(index, box) {
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'qf-datein';
    input.value = (quickFillItems[index] && quickFillItems[index].date) || '';
    const commit = () => {
      if (!input.isConnected || !/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return;
      setQfDate(index, input.value);
    };
    input.addEventListener('change', commit);
    input.addEventListener('input', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('click', e => e.stopPropagation());
    box.replaceWith(input);
    try { input.showPicker(); } catch (e) { input.focus(); }
  }

  // Give a row its date, or null for "no date": re-check it (CHECK kept), tick it, and
  // tell the Worker when the row came from a photo so the fix is saved
  function setQfDate(index, date) {
    const item = quickFillItems[index];
    if (!item) return;
    swapQuickFillRow(index, FT.quickFillRow({ ...item.raw, kind: item.kind, date, dateMissing: date === null, check: item.check }, packs));
    const fix = FT_PHOTOS.fixFor(item.raw, date);
    if (fix) FT_PHOTOS.sendFix(fix, { fetch: (u, i) => fetch(u, i), getToken: window.FT_TOKEN, household: window.FT_HOUSEHOLD.id });
  }

  async function addQuickFill() {
    const msg = document.getElementById('qfMsg');
    const chosen = quickFillItems.filter((item, i) => item.ok && quickFillBoxes[i].checked);
    if (chosen.length === 0) {
      msg.textContent = 'Tick at least one item to add';
      return;
    }

    const newPacks = chosen.flatMap(item => FT.makePacks({
      name: FT.tidyName(item.name), kind: item.kind, date: item.date, noDate: item.noDate, dateMissing: item.dateMissing,
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
      syncPlans();

      msg.textContent = '';
      showUndoBar();
      document.getElementById('qfText').value = '';
      clearQuickFillList();
      resetQfSteps();
      showQfDone(chosen.length, FT.shopMatches(shop, chosen.map(item => FT.tidyName(item.name))));
      refreshUsuals();
      renderAll();
    } catch (dbErr) {
      msg.textContent = 'Error saving to database';
    }
  }

  // After Add ticked: how many went in, and the shopping items they may have bought (ticked by default)
  function showQfDone(n, onList) {
    document.getElementById('qfDoneText').innerHTML = ICON('check', 16, 2.6) + `${n} item${n === 1 ? '' : 's'} added`;
    const listEl = document.getElementById('qfShopList');
    listEl.innerHTML = '';
    qfShopMatches = onList.map(item => {
      const label = document.createElement('label');
      label.className = 'qf-shop-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      const name = document.createElement('span');
      name.textContent = item.name;
      label.append(box, name);
      listEl.appendChild(label);
      return { item, box };
    });
    document.getElementById('qfShopWrap').hidden = onList.length === 0;
    document.getElementById('qfDone').hidden = false;
  }

  // Tick off the ticked shopping items (got = true), then hide that part
  async function tickOffShopping() {
    const ticked = qfShopMatches.filter(m => m.box.checked).map(m => m.item);
    qfShopMatches = [];
    for (const item of ticked) {
      item.got = true;
      await saveShop(item);
    }
    renderShop();
    document.getElementById('qfShopWrap').hidden = true;
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
      // The Add tab opens "Quick fill" (the Shop sub-view is opened by openShopList, after this)
      switchSub('quick');
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

    if (view === 'fridge' || view === 'cupboard') renderFridgeView(); // one render covers both pages
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
    return view === 'used' ? 'used' : view; // fridge | freezer | cupboard | used
  }

  const PAGE_TITLE = { fridge: 'Fridge', freezer: 'Freezer', cupboard: 'Cupboard', used: 'Used', meals: 'Meals', add: 'Add food', shop: 'Shopping' };
  const NAV_FOR = { fridge: 'fridge', freezer: 'fridge', cupboard: 'fridge', used: 'used', meals: 'meals', add: 'add', shop: 'shop' };

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
    syncSearch();
  }

  // ---- Search: fridge, freezer and cupboard (the bar shows on those pages only) ----
  const SEARCH_PAGES = ['fridge', 'freezer', 'cupboard'];

  // Leaving those pages clears the search; the bar shows only on them
  function syncSearch() {
    const on = SEARCH_PAGES.includes(currentPage());
    const input = document.getElementById('fridgeSearch');
    if (!on) input.value = '';
    document.getElementById('fridgeSearchWrap').hidden = !on;
    renderSearch();
  }

  // With text in the box, the results card replaces the fridge page; with none, the page is back
  function renderSearch() {
    const input = document.getElementById('fridgeSearch');
    const text = input.value;
    const active = text.trim() !== '';
    document.getElementById('searchClear').hidden = text === '';
    document.querySelector('[data-tab-pane="fridge"]').hidden = active;
    const box = document.getElementById('searchResults');
    box.hidden = !active;
    if (!active || !packs) return;
    box.innerHTML = '';
    const hits = FT.searchPacks(packs, text);
    if (hits.length === 0) {
      const none = document.createElement('div');
      none.className = 'srch-none';
      none.textContent = 'Nothing found';
      box.appendChild(none);
      return;
    }
    for (const { pack, place } of hits) box.appendChild(searchRow(pack, place));
  }

  // One result: name, a place tag, and the date on the right (tap opens the pack)
  function searchRow(pack, place) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row srch';
    const name = document.createElement('span');
    name.className = 'rname';
    name.textContent = pack.name;
    const tag = document.createElement('span');
    tag.className = 'where';
    tag.textContent = place.toUpperCase();
    name.appendChild(tag);
    const when = document.createElement('span');
    when.className = 'when';
    if (place === 'Freezer' && pack.frozen) {
      const age = FT.freezeAge(pack.frozen, today);
      when.textContent = age === 'today' ? 'Frozen today' : age + ' frozen';
    } else if (pack.date) {
      when.textContent = LOOK.whenText(pack.date, today);
    } else if (pack.added) {
      when.textContent = FT.ageLabel(pack.added, today);
    }
    row.append(name, when);
    row.addEventListener('click', () => showSheet(pack.id));
    return row;
  }

  // Small line beside / above the title: item counts, the week, the month
  function renderPageCount() {
    const page = currentPage();
    const count = document.getElementById('pageCount');
    const kicker = document.getElementById('pageKicker');
    const view = FT.fridgeView(packs, today);
    const items = n => n === 1 ? '1 item' : n + ' items';
    let right = '', above = '';
    if (page === 'fridge') right = items(view.mainCount + view.sideCount + view.vegCount + view.miscCount);
    else if (page === 'cupboard') right = items(view.cupboardCount);
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

  // Top tabs: Fridge · N | Freezer · N | Cupboard · N (the fridge count includes Other; cupboard is not in the fridge)
  function renderTabCounts() {
    const view = FT.fridgeView(packs, today);
    document.getElementById('tabFridgeN').textContent = view.mainCount + view.sideCount + view.vegCount + view.miscCount;
    document.getElementById('tabCupboardN').textContent = view.cupboardCount;
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

  // Add one item on a phone (touch screen): 3 steps, Food, Date, Add (mock docs/mockups/add-steps-mock.html)
  const STEPS_ON = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let addStep = 1;
  function onFridgeAdd() {
    return currentPage() === 'add' && document.querySelector('[data-sub].on')?.dataset.sub === 'fridge';
  }
  // On a phone's steps the header and title row go, so the steps sit at the top. The Quick fill / One item tabs
  // stay only on step 1 while the name is empty and nothing is being typed.
  function syncStepTop() {
    const stepped = STEPS_ON && onFridgeAdd();
    const typed = document.getElementById('name').value.trim();
    const tabs = stepped && addStep === 1 && !typed && !document.body.classList.contains('typing');
    document.body.classList.toggle('add-steps-top', stepped);
    document.body.classList.toggle('add-steps-tabs', !!tabs);
  }
  // Moves the Next button into the row of the field it continues, and the "No date" pill into the date header
  function placeStepParts(pane, addSteps) {
    const next = document.getElementById('stepNext');
    const noDate = document.getElementById('noDate').closest('label');
    const quick = document.getElementById('quick');
    if (!addSteps) {
      pane.insertBefore(next, pane.querySelector('.st-3'));
      if (quick && noDate && noDate.parentNode !== quick) quick.prepend(noDate);
      return;
    }
    if (addStep === 1) pane.querySelector('.st-1 .sform').appendChild(next);
    else if (addStep === 2) pane.querySelector('.st-2 .sform.date-line').appendChild(next);
    else pane.insertBefore(next, pane.querySelector('.st-3'));
    pane.querySelector('.st-2 .rowhead').appendChild(noDate);
  }
  function renderSteps() {
    const bar = document.getElementById('addSteps');
    const pane = document.querySelector('[data-sub-pane="fridge"] .pane.af');
    const next = document.getElementById('stepNext');
    if (!bar || !pane || !next) return;
    const typed = document.getElementById('name').value.trim();
    if (!typed) addStep = 1;
    if (!STEPS_ON || !onFridgeAdd()) {
      bar.hidden = true;
      next.hidden = true;
      pane.classList.remove('stepped', 'step-1', 'step-2', 'step-3');
      if (STEPS_ON) placeStepParts(pane, false);
      syncStepTop();
      return;
    }
    pane.classList.add('stepped');
    pane.classList.toggle('step-1', addStep === 1);
    pane.classList.toggle('step-2', addStep === 2);
    pane.classList.toggle('step-3', addStep === 3);
    bar.hidden = false;
    bar.dataset.step = String(addStep);
    bar.querySelectorAll('.st-dots b').forEach(b => b.classList.toggle('on', Number(b.dataset.s) === addStep));
    document.getElementById('stepBack').hidden = addStep <= 1;
    document.getElementById('stepName').textContent = addStep > 1 ? typed : '';
    next.hidden = addStep === 3;
    next.textContent = 'Next →';
    next.disabled = addStep === 1 && !typed;
    placeStepParts(pane, true);
    syncStepTop();
  }

  // Next: the step button, and the keyboard's Next / Enter key on the typing boxes
  function nextStep() {
    if (addStep === 1 && !document.getElementById('name').value.trim()) return;
    addStep = Math.min(3, addStep + 1);
    renderSteps();
    renderAddBar();
    if (addStep === 2) document.getElementById('ddmm').focus();
    if (addStep === 3 && document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function renderAddBar() {
    renderSteps();
    const bar = document.getElementById('addBar');
    if (!bar) return;
    const spec = addSpec();
    const show = onFridgeAdd() && !!spec.name && (!STEPS_ON || addStep === 3);
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
    // Where the visible screen starts (the phone may scroll the page up for the keyboard)
    document.documentElement.style.setProperty('--vvtop', (vv ? Math.max(0, vv.offsetTop) : 0) + 'px');
  }

  // Typing on a phone: hide the bottom icons while a text box has focus, so they do not sit over
  // the keyboard. Checkboxes, date inputs and buttons do not count.
  const TYPING_TYPES = ['text', 'search', 'email', 'number', 'tel', 'url', 'password'];
  function isTextTarget(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return TYPING_TYPES.includes(type);
  }
  function refreshTyping() {
    const typing = isTextTarget(document.activeElement) && window.matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('typing', typing);
    syncStepTop();
  }
  document.addEventListener('focusin', e => {
    if (isTextTarget(e.target) && window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('typing');
    syncStepTop();
    // Phone add steps: keep the steps at the very top when the keyboard opens
    if (STEPS_ON && onFridgeAdd() && isTextTarget(e.target)) {
      window.scrollTo(0, 0);
      setTimeout(() => window.scrollTo(0, 0), 250);
    }
  });
  document.addEventListener('focusout', () => {
    // Short wait, then re-check: moving from one text box to another does not flash the icons back
    setTimeout(refreshTyping, 150);
  });

  function setupAddBar() {
    document.getElementById('stepNext').addEventListener('click', nextStep);
    if (STEPS_ON) ['name', 'ddmm', 'days'].forEach(id => { document.getElementById(id).enterKeyHint = 'next'; });
    document.getElementById('stepBack').addEventListener('click', () => {
      addStep = Math.max(1, addStep - 1);
      renderSteps();
      renderAddBar();
    });
    document.getElementById('stepCancel').addEventListener('click', () => {
      cancelAdd();
      addStep = 1;
      renderSteps();
    });
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
      if (e.key === 'Enter' && STEPS_ON && onFridgeAdd() && addStep < 3) {
        e.preventDefault();
        nextStep();
        return;
      }
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
    const name = FT.tidyName(document.getElementById('name').value);
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
    syncPlans();

    setAddMsg(`✓ added ${count} × ${newPacks[0].name}`);
    showUndoBar();
    document.getElementById('name').value = '';
    document.getElementById('ddmm').value = '';
    document.getElementById('days').value = '';
    document.getElementById('count').textContent = '1';
    addStep = 1;
    applyNoDateRule();
    updateDatePreview();
    refreshUsuals();
    renderAll();
    renderAddBar();
  }

  // ✕ on the Add bar: clear what was typed, close the bar and the keyboard, add nothing
  function cancelAdd() {
    document.getElementById('name').value = '';
    document.getElementById('ddmm').value = '';
    document.getElementById('days').value = '';
    document.getElementById('count').textContent = '1';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    addStep = 1;
    applyNoDateRule();
    updateDatePreview();
    refreshUsuals();
    renderAddBar();
  }

  let selectedPackId = null;

  function showSheet(packId) {
    selectedPackId = packId;
    const pack = packs.find(p => p.id === packId);
    if (!pack) return;

    document.getElementById('sheet').style.display = 'block';
    document.getElementById('sheet').querySelector('.title').textContent = pack.name;
    document.getElementById('sheet').querySelector('.subtitle').textContent = FT.sheetLine(pack, today);
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
      if (updated.date) updated.dateMissing = false;
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
    hideSheet();
    await deletePack(pack);
    showUndoBar();
  }

  // Mark a pack deleted (it stays on the Deleted line for an hour, with Undo). Used by the sheet and Stock check's Gone
  async function deletePack(pack) {
    const beforeState = JSON.parse(JSON.stringify(pack));
    const updated = FT.markDeleted(pack, today);
    await DB.put(updated);
    Object.assign(pack, updated);
    lastAction = { type: 'update', packId: pack.id, before: beforeState };
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
    const top = rowTop(pack.name, pack, age);
    btn.append(top);
    if (pack.dateMissing) {
      // Chosen as "no date": amber tag after the name, amber line filling over 7 days
      const tag = document.createElement('span');
      tag.className = 'nd-tag';
      tag.textContent = 'NO DATE';
      top.querySelector('.rname').appendChild(tag);
      const line = document.createElement('span');
      line.className = 'line';
      const fill = document.createElement('b');
      fill.style.width = Math.min(100, FT.daysLeft(today, pack.added) / 7 * 100) + '%';
      line.appendChild(fill);
      btn.append(line);
      btn.classList.add('dm');
    }
    btn.addEventListener('click', () => packTap(pack));
    return btn;
  }

  // Eat first: the use-soon packs (2 days or less), top 3, one per line; tap opens the menu
  let eatAll = false; // Eat first card opened up to show every soon item

  function renderUseSoon() {
    const ef = LOOK.eatFirst(packs, today, eatAll);
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
    sub.textContent = ef.sub;
    sub.hidden = !sub.textContent;
    // "+2 more soon" opens the full list; "Show less" closes it again
    const moreBtn = document.getElementById('useSoonMore');
    moreBtn.textContent = eatAll ? 'Show less' : `+${ef.more} more soon`;
    moreBtn.hidden = ef.more === 0;
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

    // Other (the misc kind): dated soonest first, then undated
    document.getElementById('miscCount').textContent = view.miscCount;
    const miscEl = document.getElementById('misc');
    miscEl.innerHTML = '';
    view.misc.forEach(pack => miscEl.appendChild(pack.date ? datedButton(pack) : undatedButton(pack)));

    // Cupboard: same rows, soonest first, undated after
    const cupboardEl = document.getElementById('cupboardList');
    cupboardEl.innerHTML = '';
    view.cupboard.forEach(pack => cupboardEl.appendChild(pack.date ? datedButton(pack) : undatedButton(pack)));

    // Empty boxes fold away; a whole empty page says how to fill it
    [['mains', view.mainCount], ['sides', view.sideCount], ['veg', view.vegCount], ['misc', view.miscCount]]
      .forEach(([id, n]) => { document.getElementById(id).closest('.fbox').hidden = n === 0; });
    document.getElementById('emptyFridge').hidden = view.mainCount + view.sideCount + view.vegCount + view.miscCount > 0;
    document.getElementById('emptyCupboard').hidden = view.cupboardCount > 0;
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
      tagEl.textContent = 'Deleted · gone in ' + FT.shopGoneIn(pack) + ' min';
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
    renderByDate();
    renderStock();
  }

  // By date: every fridge food in one list, soonest first (shows instead of the sections)
  function renderByDate() {
    document.getElementById('fridgeView').hidden = byDateOn;
    document.getElementById('byDateList').hidden = !byDateOn;
    document.getElementById('byDateBtn').classList.toggle('acc', byDateOn);
    if (!byDateOn) return;
    const listEl = document.getElementById('byDateList');
    listEl.innerHTML = '';
    const rows = FT.byDateList(packs);
    if (!rows.length) {
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = 'Nothing in the fridge yet.';
      listEl.appendChild(note);
      return;
    }
    for (const { pack, section, dateLabel } of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'meal-row bd-row';
      const name = document.createElement('span');
      name.className = 'mr-name';
      name.textContent = pack.name;
      const sub = document.createElement('span');
      sub.className = 'meal-sub';
      sub.textContent = `${section} · ${dateLabel}`;
      btn.append(name, sub);
      btn.addEventListener('click', () => showSheet(pack.id));
      listEl.appendChild(btn);
    }
  }

  // Stock check: pick a section, then "Still there" ticks the food for this check only, "Gone" deletes it (with Undo)
  function openStock() {
    stockOpen = true;
    stockKey = 'main';
    stockOk = new Set();
    renderStock();
  }

  function renderStock() {
    document.getElementById('stockPanel').hidden = !stockOpen;
    if (!stockOpen) return;
    const sections = FT.stockSections(packs);
    const chipsEl = document.getElementById('stockChips');
    chipsEl.innerHTML = '';
    for (const s of sections) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sb' + (s.key === stockKey ? ' on' : '');
      chip.dataset.stock = s.key;
      chip.textContent = `${s.label} · ${s.items.length}`;
      chip.addEventListener('click', () => { stockKey = s.key; renderStock(); });
      chipsEl.appendChild(chip);
    }

    const listEl = document.getElementById('stockList');
    listEl.innerHTML = '';
    const items = sections.find(s => s.key === stockKey).items;
    if (!items.length) {
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = 'Nothing in this section.';
      listEl.appendChild(note);
    }
    for (const pack of items) {
      const row = document.createElement('div');
      row.className = 'stock-row' + (stockOk.has(pack.id) ? ' ok' : '');
      const text = document.createElement('div');
      text.className = 'sr-text';
      const name = document.createElement('span');
      name.className = 'sr-name';
      name.textContent = pack.name;
      const date = document.createElement('span');
      date.className = 'sr-date';
      date.textContent = FT.packDateLabel(pack);
      text.append(name, date);

      const there = document.createElement('button');
      there.type = 'button';
      there.className = 'act ghost stock-there';
      there.textContent = 'Still there';
      there.addEventListener('click', () => { stockOk.add(pack.id); row.classList.add('ok'); });

      const gone = document.createElement('button');
      gone.type = 'button';
      gone.className = 'act alt stock-gone';
      gone.textContent = 'Gone';
      gone.addEventListener('click', async () => {
        row.remove();
        await deletePack(pack);
      });

      row.append(text, there, gone);
      listEl.appendChild(row);
    }
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
        syncPlans();
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

    const KIND = { main: 'Main', side: 'Side', veg: 'Veg', misc: 'Other', cupboard: 'Cupboard' };
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

  const SLOT_LABEL = { main: 'Main', side: 'Side', veg: 'Veg', misc: 'Other' };

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

  // Sitting keys to ask about: past sittings and today's once due, dinner before tea, plus askDay
  function pastDays() {
    const keys = new Set(FT.mealsToAsk(packs, today, getHour()).map(s => FT.sitKey(s.day, s.mealTime)));
    if (askDay) keys.add(askDay);
    return [...keys].sort((a, b) => {
      const x = FT.sitOf(a);
      const y = FT.sitOf(b);
      if (x.day !== y.day) return x.day < y.day ? -1 : 1;
      return x.mealTime === y.mealTime ? 0 : x.mealTime === 'dinner' ? -1 : 1;
    });
  }

  function inHad() {
    return !!askDay && pastState[askDay] === 'had';
  }

  // Close a "What did you have?" question early (another day was tapped): keep what was picked
  function finishHad() {
    if (!askDay) return;
    const key = askDay;
    const { day, mealTime } = FT.sitOf(key);
    const takeaway = pastState[key] === 'cost';
    const picked = hadPicked[key] || [];
    if (takeaway || picked.length) persistAll([saveMeal(FT.mealRecord(day, picked, { takeaway, mealTime }))]);
    askDay = null;
    delete pastState[key];
    delete hadPicked[key];
  }

  // Tap a day header: open that day (closing any other), or close it if already open
  function toggleDay(day) {
    finishHad();
    addingDay = null;
    askOpen = null;
    if (openDay === day) {
      openDay = null;
    } else {
      openDay = day;
      selDay = day;
      selSlot = defaultSlot();
      selMeal = 'tea';
      pendingPlan = null;
    }
    renderMeals();
  }

  function renderMeals() {
    dropExpiredPlans();
    dropExpiredMealPlans();
    const pane = document.querySelector('[data-tab-pane="meals"]');
    const picker = document.getElementById('picker');
    const dayListEl = document.getElementById('dayList');
    // Park the picker (hidden) before the day cards are rebuilt, so it is not destroyed
    pane.appendChild(picker);
    picker.hidden = true;
    dayListEl.innerHTML = '';

    const asked = pastDays();
    // One asking card per day, its waiting meals in it (asked is sorted: dinner before tea)
    const askDays = new Map();
    for (const key of asked) {
      const { day } = FT.sitOf(key);
      askDays.set(day, [...(askDays.get(day) || []), key]);
    }
    for (const [day, keys] of askDays) dayListEl.appendChild(askCard(day, keys, picker));
    FT.mealDays(today).filter(day => !asked.includes(day)).forEach(day => dayListEl.appendChild(dayCard(day, picker)));

    document.getElementById('nextDay').hidden = inHad() || (addingDay && asked.includes(addingDay));
    const nextSlot = document.getElementById('nextSlot');
    nextSlot.hidden = selSlot === 'misc';
    nextSlot.textContent = NEXT_LABEL[selSlot] || 'Next: Sides';
    document.querySelectorAll('#mtabs .sb').forEach(t => t.classList.toggle('on', t.dataset.s === selSlot));
    document.getElementById('pickFor').textContent = 'Adding to ' + FT.formatDate(selDay) + (selMeal === 'dinner' ? ' · Dinner' : ' · Tea');
    renderWarnBar();
    renderPickList();
    renderMyMeals();
  }

  // ---- Meals (V3): a meal is a name, fresh foods (checked against the fridge) and other items ----

  let mealFormId = null;          // the meal the form is editing (null = a new one)
  let mealDraft = { fresh: [], other: [] };
  const openPlans = new Set();    // meal chips open on their day (plan ids)

  // The picker opens on the Meals tab when there is a meal to plan, else on Mains
  function defaultSlot() {
    return recipes.length ? 'meal' : 'main';
  }

  function mealById(id) {
    return recipes.find(m => String(m.id) === String(id)) || null;
  }

  // "A", "A and B", "A, B and C"
  function joinWords(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  // Take a meal plan off its day: its foods go back in the fridge and the plan goes. The lists
  // change at once; the returned array holds the database writes.
  function dropPlan(plan) {
    const writes = packs
      .filter(p => String(p.mealPlanId) === String(plan.id) && p.status === 'in_fridge')
      .map(p => setPack(FT.unplanPack(p)));
    mealPlans = mealPlans.filter(pl => String(pl.id) !== String(plan.id));
    openPlans.delete(plan.id);
    writes.push(DB.mealPlans.remove(plan.id));
    return writes;
  }

  // A sitting finished: its meal plans come off (the other meal of the day stays)
  function dropPlansOn(day, mealTime) {
    return mealPlans.filter(pl => pl.day === day && FT.mealTimeOf(pl) === mealTime).flatMap(dropPlan);
  }

  // Meal plans more than 3 days old drop off, with their foods
  function dropExpiredMealPlans() {
    const expired = FT.expiredMealPlans(mealPlans, today);
    if (expired.length) persistAll(expired.flatMap(dropPlan));
  }

  // Keep every meal plan from today on in step with its meal and the fridge. A plan whose meal
  // is gone comes off. Call after a pack joins the fridge, a meal is saved, or a food is skipped.
  function syncPlans() {
    const writes = [];
    for (const plan of [...mealPlans]) {
      const meal = mealById(plan.mealId);
      if (!meal) {
        writes.push(...dropPlan(plan));
        continue;
      }
      if (plan.day < today) continue;
      const r = FT.syncMealPlan(plan, meal, packs, today);
      r.unplan.forEach(p => writes.push(setPack(p)));
      r.plan.forEach(p => writes.push(setPack(p)));
    }
    return persistAll(writes);
  }

  // Skip a food for this meal only, or put it back
  function toggleSkip(plan, name) {
    const key = name.trim().toLowerCase();
    const skip = plan.skip || [];
    const off = skip.some(s => String(s).trim().toLowerCase() === key);
    const updated = {
      ...plan,
      skip: off ? skip.filter(s => String(s).trim().toLowerCase() !== key) : [...skip, name]
    };
    mealPlans = mealPlans.map(pl => (String(pl.id) === String(plan.id) ? updated : pl));
    const saved = persistAll([DB.mealPlans.put(updated)]);
    syncPlans();
    renderMeals();
    renderAll();
    return saved;
  }

  // Plan a meal on a day: one plan, and its foods from the fridge. Missing foods and other items
  // are offered for the shopping list.
  async function planMealFor(day, meal) {
    const plan = { day, mealId: meal.id, skip: [] };
    if (selMeal === 'dinner') plan.mealTime = 'dinner';
    try {
      plan.id = await DB.mealPlans.add(plan);
    } catch (e) {
      renderMeals();
      return;
    }
    mealPlans.push(plan);
    // Planning tonight after 5pm keeps today's picker open, as with a single food
    if (day === today) addingDay = FT.sitKey(day, selMeal);
    await persistAll(FT.planMeal(meal, packs, day, plan.id, [], selMeal).map(p => setPack(p)));
    renderMeals();
    renderAll();
    const view = FT.mealPlanView(plan, meal, packs);
    if (FT.mealShopNames(view).length) showMealShop(meal, day, view);
  }

  // "What did you have?": the meal's foods are eaten now, marked used as picking each one would
  function hadMeal(meal) {
    const { day, mealTime } = FT.sitOf(askDay);
    return Promise.all(FT.planMeal(meal, packs, day, null, [], mealTime).map(p => hadPick(p)));
  }

  // The shopping offer after a meal is planned: missing foods ticked, then the cupboard items
  function showMealShop(meal, day, view) {
    document.getElementById('mealShopTitle').textContent = `${meal.name} on ${shortDay(day)}: add to shopping list?`;
    const list = document.getElementById('mealShopList');
    list.textContent = '';
    const addRow = name => {
      const row = document.createElement('label');
      row.className = 'rs-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = name;
      box.checked = true;
      const text = document.createElement('span');
      text.textContent = name;
      row.append(box, text);
      list.appendChild(row);
    };
    view.missing.forEach(addRow);
    if (view.other.length) {
      const label = document.createElement('p');
      label.className = 'tag cupboard-lbl';
      label.textContent = 'Check the cupboard';
      list.appendChild(label);
      FT.mealShopNames({ missing: [], other: view.other }).forEach(addRow);
    }
    const box = document.getElementById('mealShop');
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Add the ticked names to the shopping list (ones already on it are left out)
  async function addMealShop() {
    const ticked = [...document.querySelectorAll('#mealShopList input:checked')].map(b => b.value);
    document.getElementById('mealShop').hidden = true;
    for (const name of FT.recipeShopList(ticked, shop)) await autoAdd(name, 'for a meal');
  }

  // Take a meal off its day (its chip's ✕)
  async function removeMealPlan(plan) {
    const writes = dropPlan(plan);
    if (openDay === plan.day && FT.dayMeals(packs, plan.day).length === 0) openDay = null;
    renderMeals();
    renderAll();
    await persistAll(writes);
  }

  // ---- My meals: the list at the bottom of the Meals page, and the meal form ----

  // Plan status words for a meal (My meals rows and the picker)
  function mealStatusText(meal) {
    const st = FT.mealStatus(meal, mealPlans, packs, today);
    if (st.planned.length) return { text: 'Planned ' + joinWords(st.planned.map(shortDay)), miss: false };
    if (st.need.length) return { text: 'Need ' + joinWords(st.need), miss: true };
    return { text: 'All in fridge', miss: false };
  }

  function renderMyMeals() {
    renderFancyMeals();
    const list = document.querySelector('#myMeals .ml');
    list.textContent = '';
    const sorted = [...recipes].sort((a, b) => a.name.localeCompare(b.name));
    if (!sorted.length) {
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = 'No meals yet. Tap New meal.';
      list.appendChild(note);
      return;
    }
    for (const m of sorted) {
      const st = mealStatusText(m);
      const line = document.createElement('div');
      line.className = 'meal-line';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'meal-row';
      const name = document.createElement('span');
      name.className = 'mr-name';
      name.textContent = m.name;
      const sub = document.createElement('span');
      sub.className = 'meal-sub' + (st.miss ? ' miss' : '');
      sub.textContent = st.text;
      btn.append(name, sub);
      btn.addEventListener('click', () => openMealForm(m));
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'meal-fancy';
      star.textContent = m.fancy ? '★' : '☆';
      star.setAttribute('aria-pressed', m.fancy ? 'true' : 'false');
      star.setAttribute('aria-label', (m.fancy ? 'Unfancy ' : 'Fancy ') + m.name);
      star.addEventListener('click', () => toggleFancy(m));
      line.append(star, btn); // star first, so the Undo bar (bottom right) never covers it
      list.appendChild(line);
    }
  }

  // Meals I fancy: starred meals, A to Z, above My meals (hidden when there are none)
  function renderFancyMeals() {
    const box = document.getElementById('fancyMeals');
    const listEl = document.getElementById('fancyList');
    listEl.innerHTML = '';
    const fancy = FT.fancyMeals(recipes);
    box.hidden = fancy.length === 0;
    for (const m of fancy) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'meal-row';
      const name = document.createElement('span');
      name.className = 'mr-name';
      name.textContent = m.name;
      btn.append(name);
      btn.addEventListener('click', () => openMealForm(m));
      listEl.appendChild(btn);
    }
  }

  // Star or unstar a meal. Starring puts the meal's missing foods on the shopping list.
  async function toggleFancy(meal) {
    const next = { ...meal, fancy: !meal.fancy };
    recipes = recipes.map(m => (String(m.id) === String(meal.id) ? next : m));
    renderMeals();
    await DB.recipes.put(next);
    if (next.fancy) {
      const need = FT.mealStatus(next, mealPlans, packs, today).need;
      for (const name of FT.recipeShopList(need, shop)) await autoAdd(name, 'for a meal');
      renderAll();
    }
  }

  function setupMeals() {
    document.getElementById('newMeal').addEventListener('click', () => openMealForm(null));
    document.getElementById('mealSave').addEventListener('click', saveMealForm);
    document.getElementById('mealCancel').addEventListener('click', closeMealForm);
    document.getElementById('mealDelete').addEventListener('click', () => {
      document.getElementById('mealDelConfirm').hidden = false;
    });
    document.getElementById('mealDelKeep').addEventListener('click', () => {
      document.getElementById('mealDelConfirm').hidden = true;
    });
    document.getElementById('mealDelYes').addEventListener('click', deleteMeal);
    document.getElementById('freshIn').addEventListener('input', showFreshSuggest);
    document.getElementById('freshIn').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = document.querySelector('#freshSuggest .sug');
      if (first) first.click();
    });
    document.getElementById('otherAdd').addEventListener('click', addOtherItem);
    document.getElementById('mealShopAdd').addEventListener('click', addMealShop);
    document.getElementById('mealShopSkip').addEventListener('click', () => {
      document.getElementById('mealShop').hidden = true;
    });
  }

  function setMealErr(text) {
    const el = document.getElementById('mealErr');
    el.textContent = text;
    el.hidden = !text;
  }

  // Open the form for a new meal (meal = null, starting with freshNames) or to edit one
  function openMealForm(meal, freshNames = []) {
    mealFormId = meal ? meal.id : null;
    mealDraft = { fresh: [], other: [] };
    if (meal) {
      mealDraft.fresh = meal.fresh.map(f => ({ ...f, qty: f.qty || 1 }));
      mealDraft.other = meal.other.map(o => ({ ...o }));
    } else {
      freshNames.forEach(n => draftAddFresh(n));
    }
    document.getElementById('mealFormTitle').textContent = meal ? 'Edit meal' : 'New meal';
    document.getElementById('mealName').value = meal ? meal.name : '';
    document.getElementById('mealDelete').hidden = !meal;
    document.getElementById('mealDelConfirm').hidden = true;
    document.getElementById('freshIn').value = '';
    document.getElementById('freshSuggest').textContent = '';
    document.getElementById('otherName').value = '';
    document.getElementById('otherQty').value = '';
    setMealErr('');
    renderMealDraft();
    const form = document.getElementById('mealForm');
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeMealForm() {
    mealFormId = null;
    mealDraft = { fresh: [], other: [] };
    document.getElementById('mealForm').hidden = true;
    document.getElementById('freshSuggest').textContent = '';
  }

  // Add a fresh food to the draft (tidied, no repeats in any case). False if not added.
  function draftAddFresh(name) {
    const n = FT.tidyName(name);
    if (!n || mealDraft.fresh.some(f => f.name.toLowerCase() === n.toLowerCase())) return false;
    mealDraft.fresh.push({ name: n, some: false, qty: 1 });
    return true;
  }

  // Draw the draft's fresh foods and other items (names set with textContent)
  function renderMealDraft() {
    const form = document.getElementById('mealForm');
    const freshList = form.querySelector('.fresh-list');
    freshList.textContent = '';
    mealDraft.fresh.forEach((f, i) => {
      const chip = document.createElement('span');
      chip.className = 'fresh-item';
      const nm = document.createElement('span');
      nm.className = 'fnm';
      nm.textContent = f.name;
      const qty = document.createElement('button');
      qty.type = 'button';
      qty.className = 'qty' + (f.qty > 1 ? ' on' : '');
      qty.textContent = '×' + (f.qty || 1);
      qty.title = 'How many packs this meal needs (tap for 1, 2 or 3)';
      qty.setAttribute('aria-label', 'Packs needed: ' + (f.qty || 1));
      qty.addEventListener('click', () => {
        mealDraft.fresh[i].qty = ((mealDraft.fresh[i].qty || 1) % 3) + 1;
        renderMealDraft();
      });
      const some = document.createElement('button');
      some.type = 'button';
      some.className = 'some';
      some.textContent = 'some';
      some.title = 'Only some of this is used in the meal';
      some.setAttribute('aria-pressed', String(f.some));
      some.addEventListener('click', () => {
        mealDraft.fresh[i].some = !mealDraft.fresh[i].some;
        renderMealDraft();
      });
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'rm';
      rm.innerHTML = ICON('close', 12, 2.4);
      rm.setAttribute('aria-label', 'Remove ' + f.name);
      rm.addEventListener('click', () => {
        mealDraft.fresh.splice(i, 1);
        renderMealDraft();
      });
      chip.append(nm, qty, some, rm);
      freshList.appendChild(chip);
    });
    const otherList = form.querySelector('.other-list');
    otherList.textContent = '';
    mealDraft.other.forEach((o, i) => {
      const row = document.createElement('div');
      row.className = 'other-item';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = o.qty ? o.name + ' ' + o.qty : o.name;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'rm';
      rm.innerHTML = ICON('close', 12, 2.4);
      rm.setAttribute('aria-label', 'Remove ' + o.name);
      rm.addEventListener('click', () => {
        mealDraft.other.splice(i, 1);
        renderMealDraft();
      });
      row.append(nm, rm);
      otherList.appendChild(row);
    });
  }

  function sugButton(name, label, isNew) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sug' + (isNew ? ' new' : '');
    b.textContent = label;
    b.addEventListener('click', () => addFreshFromTyping(name));
    return b;
  }

  // Chips under the fresh food box while typing: suggestions, then "+ Add new" if it is a new name
  function showFreshSuggest() {
    const box = document.getElementById('freshSuggest');
    box.textContent = '';
    const typed = document.getElementById('freshIn').value;
    if (!typed.trim()) return;
    const sugs = FT.suggestFoods(packs, typed, mealDraft.fresh.map(f => f.name));
    sugs.forEach(s => box.appendChild(sugButton(s.name, '+ ' + s.name, false)));
    const fresh = FT.newFoodName(typed, sugs);
    if (fresh && !mealDraft.fresh.some(f => f.name.toLowerCase() === fresh.toLowerCase())) {
      box.appendChild(sugButton(fresh, '+ Add new: ' + fresh, true));
    }
  }

  // Tapping a chip adds that food (not as "some"), clears the box and goes back to typing
  function addFreshFromTyping(name) {
    draftAddFresh(name);
    const input = document.getElementById('freshIn');
    input.value = '';
    document.getElementById('freshSuggest').textContent = '';
    renderMealDraft();
    input.focus();
  }

  function addOtherItem() {
    const nameIn = document.getElementById('otherName');
    const qtyIn = document.getElementById('otherQty');
    const name = FT.tidyName(nameIn.value);
    if (!name) return;
    mealDraft.other.push({ name, qty: qtyIn.value.trim() || null });
    nameIn.value = '';
    qtyIn.value = '';
    renderMealDraft();
    nameIn.focus();
  }

  async function saveMealForm() {
    const res = FT.makeMeal({
      id: mealFormId,
      name: document.getElementById('mealName').value,
      fresh: mealDraft.fresh,
      other: mealDraft.other,
      fancy: mealById(mealFormId)?.fancy === true // editing keeps the star
    }, recipes);
    if (res.error) {
      setMealErr(res.error);
      return;
    }
    const meal = res.meal;
    try {
      if (mealFormId != null) {
        await DB.recipes.put(meal);
        recipes = recipes.map(m => (String(m.id) === String(meal.id) ? meal : m));
      } else {
        meal.id = await DB.recipes.add(meal);
        recipes = [...recipes, meal];
        selSlot = 'meal'; // a new meal is the first thing to plan: the picker shows the Meals tab
      }
    } catch (e) {
      setMealErr("Couldn't save the meal. Try again.");
      return;
    }
    closeMealForm();
    syncPlans();
    renderMeals();
    renderAll();
  }

  // Delete (after the confirm): the meal's plans come off their days, then the meal goes
  async function deleteMeal() {
    const meal = mealById(mealFormId);
    closeMealForm();
    if (!meal) return;
    const writes = mealPlans.filter(pl => String(pl.mealId) === String(meal.id)).flatMap(dropPlan);
    recipes = recipes.filter(m => String(m.id) !== String(meal.id));
    writes.push(DB.recipes.remove(meal.id));
    renderMeals();
    renderAll();
    await persistAll(writes);
  }

  // Single planned foods on a day (not takeaways), when the day has no meal: the names that
  // "Save as meal" starts from. Null when there are none or a meal is planned.
  function saveMealNames(day, mealTime) {
    const groups = FT.dayGroups(packs, mealPlans, recipes, day, mealTime);
    if (groups.some(g => g.type === 'meal')) return null;
    const names = groups.filter(g => g.type === 'pack' && g.pack.kind !== 'takeaway').map(g => g.pack.name);
    return names.length ? names : null;
  }

  // "Save as meal" on a day: a new meal starting with that meal's foods
  function openMealFromDay(day, mealTime) {
    openMealForm(null, saveMealNames(day, mealTime) || []);
  }

  // Name of a planned group on a day: a meal's name, a takeaway, or a single food's name
  function groupName(g) {
    if (g.type === 'meal') return g.view.name;
    return g.pack.kind === 'takeaway' ? 'Takeaway' : g.pack.name;
  }

  // Upcoming day card. Open: Dinner | Tea buttons, the selected meal's foods, the picker, and the
  // other meal as one quiet line. Closed: one line per meal that has food (no buttons).
  function dayCard(day, picker) {
    const isToday = day === today;
    const isOpen = day === openDay && !inHad();
    const asked = pastDays();
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
    if (FT.dayGroups(packs, mealPlans, recipes, day).length === 0) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.innerHTML = ICON('add', 14, 2.2) + 'Plan';
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
      const seg = document.createElement('div');
      seg.className = 'meal-seg';
      for (const meal of ['dinner', 'tea']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.meal = meal;
        const on = selMeal === meal;
        b.className = on ? 'on' : '';
        b.setAttribute('aria-pressed', String(on));
        b.append(meal === 'dinner' ? 'Dinner' : 'Tea');
        const n = FT.dayGroups(packs, mealPlans, recipes, day, meal).length;
        if (n) {
          const count = document.createElement('span');
          count.className = 'n';
          count.textContent = '· ' + n;
          b.appendChild(count);
        }
        b.addEventListener('click', () => {
          selMeal = meal;
          selSlot = defaultSlot(); // a new meal starts its picker on the first slot
          pendingPlan = null;
          renderMeals();
        });
        seg.appendChild(b);
      }
      card.appendChild(seg);

      const now = document.createElement('div');
      now.className = 'meal-now';
      const line = document.createElement('div');
      line.className = 'meal-line';
      now.append(line, ...mealChips(line, day, selMeal, false));
      card.appendChild(now);

      const body = document.createElement('div');
      body.className = 'dbody';
      body.appendChild(picker);
      picker.hidden = false;
      card.appendChild(body);

      const other = selMeal === 'dinner' ? 'tea' : 'dinner';
      const names = asked.includes(FT.sitKey(day, other))
        ? []
        : FT.dayGroups(packs, mealPlans, recipes, day, other).map(groupName);
      if (names.length) {
        const line2 = document.createElement('div');
        line2.className = 'other-meal';
        line2.textContent = (other === 'dinner' ? 'Dinner' : 'Tea') + ': ' + names.join(', ');
        card.appendChild(line2);
      }
    } else {
      for (const meal of ['dinner', 'tea']) {
        if (asked.includes(FT.sitKey(day, meal))) continue; // being asked on its own card
        if (FT.dayGroups(packs, mealPlans, recipes, day, meal).length === 0) continue;
        const line = document.createElement('div');
        line.className = 'sit';
        line.dataset.meal = meal;
        const lbl = document.createElement('span');
        lbl.className = 'sit-lbl';
        lbl.textContent = meal === 'dinner' ? 'DINNER' : 'TEA';
        line.appendChild(lbl);
        const blocks = mealChips(line, day, meal, false);
        card.appendChild(line);
        blocks.forEach(b => card.appendChild(b));
      }
    }
    return card;
  }

  // The chips of one meal on a day, into el (a line of the card). Save as meal when it has only
  // single foods. Returns the blocks of the meal plans that are open.
  function mealChips(el, day, mealTime, noX) {
    const blocks = appendDayChips(el, day, noX, mealTime);
    if (saveMealNames(day, mealTime)) {
      const meal = document.createElement('button');
      meal.type = 'button';
      meal.className = 'day-meal';
      meal.textContent = 'Save as meal';
      meal.addEventListener('click', e => { e.stopPropagation(); openMealFromDay(day, mealTime); });
      el.appendChild(meal);
    }
    return blocks;
  }

  // Asking: one card per day. Each waiting meal is a block in it (dinner first); its line opens its
  // buttons, one block at a time. The head opens or closes the first block still asking.
  function askCard(day, keys, picker) {
    const card = document.createElement('div');
    card.className = 'day past' + (keys.some(k => (pastState[k] || 'ask') === 'ask') ? ' asking' : '');

    const head = document.createElement('div');
    head.className = 'dh';
    head.appendChild(dayName(day));
    const first = keys.find(k => (pastState[k] || 'ask') === 'ask');
    if (first) {
      const closed = askOpen !== first && addingDay !== first;
      head.setAttribute('role', 'button');
      head.setAttribute('aria-expanded', String(!closed));
      head.addEventListener('click', () => {
        askOpen = closed ? first : null;
        addingDay = null;
        openDay = null; // only one card open: close any other day
        renderMeals();
      });
    }
    card.appendChild(head);
    keys.forEach(key => askBlock(key, picker).forEach(el => card.appendChild(el)));
    return card;
  }

  // One waiting meal on a day: its line (label, chips, and "Used?" when closed), then its buttons
  // or question when open. Returns the elements to put in the card.
  function askBlock(key, picker) {
    const { day, mealTime } = FT.sitOf(key);
    const state = pastState[key] || 'ask';
    // A closed asking meal: no ✕ on its chips, just the quiet tag; tap its line to open it
    const closed = state === 'ask' && askOpen !== key && addingDay !== key;
    const askText = LOOK.askText(FT.dayMeals(packs, day, mealTime));

    const block = document.createElement('div');
    block.className = 'ask-meal';
    block.dataset.meal = mealTime;

    const line = document.createElement('div');
    line.className = 'ask-line';
    const lbl = document.createElement('span');
    lbl.className = 'sit-lbl';
    lbl.textContent = mealTime === 'dinner' ? 'DINNER' : 'TEA';
    line.appendChild(lbl);
    const mealBlocks = appendDayChips(line, day, closed, mealTime);
    if (closed) {
      const tag = document.createElement('span');
      tag.className = 'ask-tag';
      tag.textContent = askText;
      line.appendChild(tag);
    }
    if (state === 'ask') {
      line.setAttribute('role', 'button');
      line.setAttribute('aria-expanded', String(!closed));
      line.tabIndex = 0;
      const toggle = () => {
        askOpen = closed ? key : null;
        addingDay = null;
        openDay = null; // only one card open: close any other day
        renderMeals();
      };
      line.addEventListener('click', toggle);
      line.addEventListener('keydown', e => {
        if (e.target !== line) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    }
    block.appendChild(line);
    mealBlocks.forEach(b => block.appendChild(b));

    if (!closed) {
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
        // Yes / No, then + Add (this meal's picker, until Done) and Save as meal
        const row = document.createElement('div');
        row.className = 'askrow ans';
        const text = document.createElement('span');
        text.className = 'q-sm';
        text.textContent = askText;
        const yes = button('had-yes mini', 'Yes', () => { addingDay = null; answerYes(key); });
        const no = button('had-no mini', 'No', () => { addingDay = null; answerNo(key); });

        const adding = addingDay === key;
        const add = button('had-add mini', '', () => {
          addingDay = adding ? null : key;
          openDay = null; // only one picker: close any other open day
          selDay = day;
          selMeal = mealTime;
          selSlot = defaultSlot();
          pendingPlan = null;
          renderMeals();
        });
        add.innerHTML = ICON(adding ? 'close' : 'add', 14, 2.2) + (adding ? 'Done' : 'Add');
        add.setAttribute('aria-expanded', String(adding));
        // A meal already planned on the day: nothing to save, so "Saved ✓"
        const saved = FT.dayGroups(packs, mealPlans, recipes, day, mealTime).some(g => g.type === 'meal');
        const meal = button('mini day-meal', saved ? 'Saved ✓' : 'Save as meal', () => openMealFromDay(day, mealTime));
        meal.disabled = saved;
        row.append(text, yes, no, add, meal);
        body.append(row);
        if (adding) {
          body.appendChild(picker);
          picker.hidden = false;
        }
      } else if (state === 'use') {
        q('How much did you use?');
        const planned = FT.dayMeals(packs, day, mealTime).filter(p => p.kind !== 'takeaway');
        const partIds = FT.partDefaults(packs, mealPlans, recipes, day, mealTime);
        planned.forEach(pack => {
          const row = document.createElement('div');
          row.className = 'use-row';
          row.dataset.id = pack.id;
          const name = document.createElement('b');
          name.textContent = pack.name;
          const seg = document.createElement('div');
          seg.className = 'seg';
          const startPart = partIds.has(pack.id);
          const all = document.createElement('button');
          all.type = 'button';
          all.className = startPart ? 'all' : 'all on';
          all.textContent = 'All used';
          const part = document.createElement('button');
          part.type = 'button';
          part.className = startPart ? 'part on' : 'part';
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
          finishUse(key, rows);
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
          button('cost-skip', 'Skip', () => finishCost(key, null)),
          button('cost-save', 'Save', () => finishCost(key, input.value)));
      } else if (state === 'had') {
        q('What did you have?');
        body.appendChild(picker);
        picker.hidden = false;
        const picked = (hadPicked[key] || []).length;
        btns().appendChild(button('had-skip', picked ? 'Done' : 'Skip', endHad));
      }
      block.appendChild(body);
    }
    return [block];
  }

  // Planned foods on a day as chips: one chip per meal plan, single foods as before. Returns the
  // blocks of foods for the open meals, to go under the card head.
  function appendDayChips(head, day, noX, mealTime) {
    const blocks = [];
    for (const g of FT.dayGroups(packs, mealPlans, recipes, day, mealTime)) {
      if (g.type === 'meal') {
        head.appendChild(mealPlanChip(g, day, noX));
        if (openPlans.has(g.plan.id)) blocks.push(mealIngs(g.view, day));
      } else {
        head.appendChild(mealChip(g.pack, day, noX));
      }
    }
    return blocks;
  }

  // A meal on a day: one chip. Tap it to open its foods; ✕ takes the whole meal off the day.
  function mealPlanChip(g, day, noX) {
    const { view, plan } = g;
    const isOpen = openPlans.has(plan.id);
    const chip = document.createElement('span');
    chip.className = 'chip meal-chip' + (view.warn ? ' warn' : '');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'meal-open';
    open.setAttribute('aria-expanded', String(isOpen));
    const tag = document.createElement('span');
    tag.className = 'meal-tag';
    tag.textContent = 'MEAL';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = view.name;
    open.append(tag, nm);
    if (view.warn) {
      const warn = document.createElement('span');
      warn.className = 'meal-warn';
      warn.textContent = '!';
      warn.title = 'Missing food, or out of date by then';
      warn.setAttribute('aria-label', 'Missing food, or out of date by then');
      open.appendChild(warn);
    }
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = isOpen ? '▴' : '▾';
    open.appendChild(caret);
    open.addEventListener('click', e => {
      e.stopPropagation();
      if (isOpen) openPlans.delete(plan.id);
      else openPlans.add(plan.id);
      renderMeals();
    });

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'meal-x';
    x.innerHTML = ICON('close', 12, 2.4);
    x.setAttribute('aria-label', 'Take ' + view.name + ' off ' + shortDay(day));
    x.addEventListener('click', e => {
      e.stopPropagation();
      removeMealPlan(plan);
    });
    chip.append(open);
    if (!noX) chip.append(x);
    return chip;
  }

  // The foods of an open meal: each with its pack date, "need" when no pack is in the fridge,
  // "skipped this time" when skipped (✕ skips, ↺ puts back), then the cupboard items
  function mealIngs(view, day) {
    const box = document.createElement('div');
    box.className = 'meal-ings';
    for (const f of view.foods) {
      const row = document.createElement('div');
      let status;
      if (f.skipped) {
        row.className = 'ing skipped';
        status = 'skipped this time';
      } else if (!f.pack) {
        row.className = 'ing need';
        status = 'need';
      } else {
        row.className = 'ing' + (f.out > 0 ? ' warn' : '');
        if (f.out > 0) status = 'out by ' + shortDay(day);
        else if (f.need > 0) status = 'need ' + f.need + ' more';
        else status = f.pack.date ? LOOK.whenText(f.pack.date, today) : FT.ageLabel(f.pack.added, today);
      }
      const name = document.createElement('span');
      name.className = 'iname';
      name.textContent = f.name;
      row.appendChild(name);
      if (f.qty > 1) {
        const q = document.createElement('span');
        q.className = 'qty-tag';
        q.textContent = '×' + f.qty;
        row.appendChild(q);
      }
      if (f.some) {
        const some = document.createElement('span');
        some.className = 'some-tag';
        some.textContent = 'some';
        row.appendChild(some);
      }
      const st = document.createElement('span');
      st.className = 'ist';
      st.textContent = status;
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'skip';
      if (f.skipped) {
        skip.textContent = '↺';
        skip.setAttribute('aria-label', 'Use ' + f.name + ' again');
      } else {
        skip.innerHTML = ICON('close', 12, 2.4);
        skip.setAttribute('aria-label', 'Skip ' + f.name + ' this time');
      }
      skip.addEventListener('click', () => toggleSkip(view.plan, f.name));
      row.append(st, skip);
      box.appendChild(row);
    }
    if (view.other.length) {
      const label = document.createElement('p');
      label.className = 'tag cupboard-lbl';
      label.textContent = 'Check the cupboard';
      box.appendChild(label);
      for (const o of view.other) {
        const row = document.createElement('div');
        row.className = 'cupboard';
        const text = document.createElement('span');
        text.textContent = o.qty ? o.name + ' ' + o.qty : o.name;
        row.appendChild(text);
        box.appendChild(row);
      }
    }
    return box;
  }

  function mealChip(item, day, noX) {
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
    chip.append(label);
    if (!noX) chip.append(x);
    return chip;
  }

  function renderWarnBar() {
    const bar = document.getElementById('warnBar');
    bar.innerHTML = '';
    bar.hidden = !pendingPlan;
    if (!pendingPlan) return;

    const { pack, day, slot, mealTime } = pendingPlan;
    const n = FT.outByDay(pack, day);
    const text = document.createElement('span');
    text.textContent = `${pack.name} will be ${n} day${n > 1 ? 's' : ''} out by ${shortDay(day)}`;

    const btns = document.createElement('div');
    btns.className = 'btns';
    const yes = document.createElement('button');
    yes.className = 'act alt';
    yes.id = 'wYes';
    yes.textContent = 'Add anyway';
    yes.addEventListener('click', () => planMeal(pack, day, slot, mealTime));
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
      renderMealPick(listEl);
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

  // Meals tab of the picker: one row per meal, tap to plan it for the open day. "+ New meal" last.
  function renderMealPick(listEl) {
    const sorted = [...recipes].sort((a, b) => a.name.localeCompare(b.name));
    for (const m of sorted) {
      const st = mealStatusText(m);
      const need = st.miss;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item' + (need ? ' st-soon' : '');
      const name = document.createElement('span');
      name.textContent = m.name;
      const right = document.createElement('span');
      right.textContent = st.text;
      btn.append(name, right);
      btn.addEventListener('click', () => (inHad() ? hadMeal(m) : planMealFor(selDay, m)));
      listEl.appendChild(btn);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'item ta';
    add.textContent = '+ New meal';
    add.addEventListener('click', () => openMealForm(null));
    listEl.appendChild(add);
  }

  // Past card, "Yes": a takeaway goes to the cost question, anything else to how much was used
  function answerYes(key) {
    finishHad();
    const { day, mealTime } = FT.sitOf(key);
    const hasTakeaway = FT.dayMeals(packs, day, mealTime).some(p => p.kind === 'takeaway');
    pastState[key] = hasTakeaway ? 'cost' : 'use';
    renderMeals();
  }

  // Past card, "No": the sitting's plans come off, and the picker asks what was eaten instead
  function answerNo(key) {
    finishHad();
    const { day, mealTime } = FT.sitOf(key);
    const writes = dropPlansOn(day, mealTime);
    writes.push(...FT.dayMeals(packs, day, mealTime).map(p => (p.kind === 'takeaway' ? dropPack(p) : setPack(FT.unplanPack(p)))));
    askDay = key;
    pastState[key] = 'had';
    hadPicked[key] = [];
    selDay = day;
    selMeal = mealTime;
    selSlot = defaultSlot();
    pendingPlan = null;
    renderMeals();
    renderAll();
    return persistAll(writes);
  }

  // Past card, "Done" on use: all used goes on the shopping list if needed, part used stays in the fridge
  function finishUse(key, rows) {
    const { day, mealTime } = FT.sitOf(key);
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
    delete pastState[key];
    writes.push(...dropPlansOn(day, mealTime));
    writes.push(saveMeal(FT.mealRecord(day, planned, { mealTime })));
    renderMeals();
    renderAll();
    return persistAll(writes);
  }

  // Takeaway cost: the takeaway goes, the sitting's other plans come off, and the meal is kept
  function finishCost(key, cost) {
    const { day, mealTime } = FT.sitOf(key);
    const picked = hadPicked[key] || [];
    const writes = dropPlansOn(day, mealTime);
    writes.push(...FT.dayMeals(packs, day, mealTime).map(p => (p.kind === 'takeaway' ? dropPack(p) : setPack(FT.unplanPack(p)))));
    writes.push(saveMeal(FT.mealRecord(day, picked, { takeaway: true, cost, mealTime })));
    delete pastState[key];
    delete hadPicked[key];
    if (askDay === key) askDay = null;
    renderMeals();
    renderAll();
    return persistAll(writes);
  }

  // "Had" mode: a food picked is eaten now (marked used), and the slot moves on as in planning
  function hadPick(pack) {
    const key = askDay;
    const slot = selSlot;
    const updated = FT.markUsed(pack, today);
    hadPicked[key] = [...(hadPicked[key] || []), { ...updated, slot }];
    renderMeals();
    renderAll();
    return persistAll([setPack(updated), autoAddFinished(updated, 'used')]);
  }

  // Done / Skip in "had" mode: keep what was picked, then back to today
  function endHad() {
    finishHad();
    selDay = today;
    openDay = today;
    selSlot = defaultSlot();
    selMeal = 'tea';
    pendingPlan = null;
    renderMeals();
  }

  // Tap a food: warn first if it will be out of date on that day
  async function choosePick(pack) {
    if (inHad()) return hadPick(pack);
    if (FT.outByDay(pack, selDay) > 0) {
      pendingPlan = { pack, day: selDay, slot: selSlot, mealTime: selMeal };
      renderMeals();
      return;
    }
    await planMeal(pack, selDay, selSlot, selMeal);
  }

  async function planMeal(pack, day, slot, mealTime) {
    pendingPlan = null;
    // Planning tonight after 5pm turns today's card into "Used?": keep its picker open until Done
    if (day === today) addingDay = FT.sitKey(day, mealTime);
    try {
      await savePack(FT.planPack(pack, day, slot, mealTime));
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
    if (!FT.dayMeals(packs, day, selMeal).some(p => p.kind === 'takeaway')) {
      try {
        const takeaway = FT.makeTakeaway(day, selMeal);
        takeaway.id = await DB.add(takeaway);
        packs.push(takeaway);
      } catch (e) {
        renderMeals();
        return;
      }
    }
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
    todayEl.textContent = FT.formatDate(today);
  }

  // Packs added today, still in the fridge or freezer: tap one for the fridge menu
  function renderAddedToday() {
    const list = FT.addedToday(packs, today);
    document.getElementById('addedWrap').hidden = list.length === 0;
    document.getElementById('addedHead').textContent = `Added today · ${list.length} ${list.length === 1 ? 'pack' : 'packs'}`;
    const box = document.getElementById('addedToday');
    box.innerHTML = '';
    list.forEach(pack => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'added-row';
      const kind = document.createElement('span');
      kind.className = 'qf-kindtag';
      kind.textContent = (FT.kindLabel(pack.kind) || pack.kind || '').toUpperCase();
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = pack.name;
      if (typeof pack.price === 'number') {
        const price = document.createElement('span');
        price.className = 'pr';
        price.textContent = ` · £${pack.price.toFixed(2)}`;
        name.appendChild(price);
      }
      row.append(kind, name);
      const tag = FT.dateTag(pack);
      if (tag) {
        const dt = document.createElement('span');
        dt.className = 'dt';
        dt.textContent = tag;
        row.appendChild(dt);
      }
      const when = document.createElement('span');
      if (pack.date) {
        when.className = 'when';
        when.textContent = FT.formatDate(pack.date);
      } else if (pack.dateMissing) {
        when.className = 'nd-tag';
        when.textContent = 'NO DATE';
      } else {
        when.className = 'when';
        when.textContent = 'no date';
      }
      row.appendChild(when);
      row.addEventListener('click', () => showSheet(pack.id));
      box.appendChild(row);
    });
  }

  // ---- Ideas & feedback (Settings) ----

  let fbNoteTimer = null;
  // Short message under the notes box; hides itself after a few seconds
  function fbSay(text) {
    const note = document.getElementById('fbMsg');
    clearTimeout(fbNoteTimer);
    note.textContent = text;
    note.hidden = !text;
    if (text) fbNoteTimer = setTimeout(() => { note.hidden = true; }, 2500);
  }

  // The version shown in Settings, e.g. "v3.16"
  function fbVersion() {
    const v = window.FT_VERSION;
    return v ? (v.prefix || 'v') + (v.label || v.n) : '';
  }

  // My name in the household (falls back to "Me", e.g. in memory mode)
  function fbMyName() {
    const members = (window.FT_HOUSEHOLD && window.FT_HOUSEHOLD.members) || [];
    const me = members.find(m => m.uid === DB.uid);
    return me && me.name ? me.name : 'Me';
  }

  async function saveFeedback(type) {
    const box = document.getElementById('fbText');
    const item = FT.makeFeedback(box.value, type, { by: DB.uid, name: fbMyName(), version: fbVersion(), at: Date.now() });
    if (!item) {
      fbSay('Write something first');
      box.focus();
      return;
    }
    try {
      const id = await DB.feedback.add(item);
      feedback = [...feedback, { ...item, id }];
      box.value = '';
      fbSay('Saved');
    } catch (e) {
      fbSay('Could not save. Try again');
    }
    renderFeedback();
  }

  async function removeFeedback(id) {
    try {
      await DB.feedback.remove(id);
      feedback = feedback.filter(f => String(f.id) !== String(id));
    } catch (e) {
      fbSay('Could not delete. Try again');
    }
    renderFeedback();
  }

  // Newest first; each note: type tag, text, then "Thu 15 Oct · Darren · v3.16" and a delete button
  function renderFeedback() {
    const list = document.getElementById('fbList');
    if (!list) return;
    list.innerHTML = '';
    if (feedback.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'li';
      empty.innerHTML = '<div class="grow note">No notes yet</div>';
      list.appendChild(empty);
      return;
    }
    const sorted = [...feedback].sort((a, b) => (b.at || 0) - (a.at || 0));
    for (const f of sorted) {
      const row = document.createElement('div');
      row.className = 'li fb-item';

      const body = document.createElement('div');
      body.className = 'grow';
      const problem = f.type === 'problem';
      const tag = document.createElement('span');
      tag.className = 'fb-tag' + (problem ? ' problem' : '');
      tag.textContent = problem ? 'PROBLEM' : 'IDEA';
      const text = document.createElement('div');
      text.className = 'fb-text';
      text.textContent = f.text;
      const meta = document.createElement('div');
      meta.className = 'note small fb-meta';
      meta.textContent = [f.at ? FT.dayLabel(f.at) : '', f.name || 'Someone', f.version].filter(Boolean).join(' · ');
      const top = document.createElement('div');
      top.appendChild(tag);
      top.appendChild(text);
      body.appendChild(top);
      body.appendChild(meta);

      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'fb-x';
      x.innerHTML = ICON('close', 16, 2);
      x.setAttribute('aria-label', 'Delete this note');
      x.title = 'Delete';
      x.addEventListener('click', () => removeFeedback(f.id));

      row.appendChild(body);
      row.appendChild(x);
      list.appendChild(row);
    }
  }

  // Every note as one list for a Claude chat
  async function copyFeedback() {
    const text = FT.feedbackText(feedback, fbVersion());
    if (!text) {
      fbSay('Nothing to copy yet');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      fbSay('Copied — paste it into a Claude chat');
    } catch (e) {
      fbSay('Could not copy. Select the notes and copy them by hand');
    }
  }

  function renderAll() {
    renderTopDate();
    const activeView = document.querySelector('[data-view].on')?.dataset.view;
    if (activeView === 'fridge' || activeView === 'cupboard') renderFridgeView();
    else if (activeView === 'freezer') renderFreezerView();
    else if (activeView === 'used') renderUsedView();
    if (packs) {
      renderTabCounts();
      renderByDate();
      renderStock();
      renderAddedToday();
    }
    renderPageCount();
    syncSearch(); // also at start-up, where updateNav has not run yet
    renderBell();
    renderFeedback();
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
      const stored = localStorage.getItem('v4demo.bellSeen');
      if (stored) return Number(stored);
      const now = Date.now();
      localStorage.setItem('v4demo.bellSeen', String(now));
      return now;
    } catch (e) { return Date.now(); }
  }

  // Everything in the list counts as seen once it is on screen
  function markBellSeen() {
    const feed = FT.activityFeed(bellEntries, DB.uid);
    const newest = feed.length ? feed[0].at : 0;
    try { localStorage.setItem('v4demo.bellSeen', String(Math.max(Date.now(), newest))); } catch (e) { /* ignore */ }
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
    // The bell always shows (Darren 2026-10-13), even alone in a household
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
    try { return JSON.parse(localStorage.getItem('v4demo.backupSnooze')) || null; } catch (e) { return null; }
  }

  function writeSnooze(snooze) {
    try { localStorage.setItem('v4demo.backupSnooze', JSON.stringify(snooze)); } catch (e) { /* ignore */ }
  }

  function clearSnooze() {
    try { localStorage.removeItem('v4demo.backupSnooze'); } catch (e) { /* ignore */ }
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
        mealPlans: await DB.mealPlans.all(),
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
        mealPlans: await DB.mealPlans.all(),
      };
      const plan = FT.restorePlan(current, r.data);
      const stores = { packs: DB, shop: DB.shop, meals: DB.meals, sheets: DB.sheets, ratings: DB.ratings, recipes: DB.recipes, mealPlans: DB.mealPlans };
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

  // The item with this name that is still to get (not crossed out, not deleted), if any
  function toGetItem(name) {
    const key = name.toLowerCase();
    return shop.find(i => !i.got && !i.del && i.name.toLowerCase() === key) || null;
  }

  // Same food again while it is still to get: one line, counted (auto null = the user typed it)
  async function mergeShopItem(item, auto) {
    Object.assign(item, FT.shopMerge(item, auto));
    await saveShop(item);
    renderShop();
    return item;
  }

  // Add an item with a reason; a name already to get is counted instead (then returns null)
  async function autoAdd(name, auto) {
    const key = name.toLowerCase();
    if (autoBusy.has(key)) return null;
    autoBusy.add(key);
    try {
      const have = toGetItem(name);
      if (have) {
        await mergeShopItem(have, auto);
        return null; // not a new line: undo must not remove the user's line
      }
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
    const name = FT.tidyName(input.value);
    if (!name) return;
    input.value = '';
    const have = toGetItem(name);
    if (have) await mergeShopItem(have, null);
    else await addShopItem(name);
    renderShop();
  }

  // Bought-before chip or Ideas "+": add it (or count it if it is already to get), or un-get it if it is crossed out
  async function tapShopName(name) {
    const have = toGetItem(name);
    if (have) return mergeShopItem(have, null);
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

  // Old repeated lines (from before counting) become one line with a count; the extra lines are removed
  async function foldShop() {
    const f = FT.foldShopRepeats(shop);
    for (const keep of f.keep) {
      const item = shop.find(i => i.id === keep.id);
      if (!item) continue;
      item.count = keep.count;
      await saveShop(item);
    }
    for (const id of f.remove) {
      try {
        await DB.shop.remove(id);
      } catch (e) {
        continue; // not removed: it is folded again at the next start
      }
      shop = shop.filter(i => i.id !== id);
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
    label.textContent = FT.shopLabel(item);
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
      tag.textContent = 'gone in ' + FT.shopGoneIn(item) + ' min';
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
        item.del = Date.now();
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
    // Deleted items whose hour is up go for good
    const expiredNow = FT.expiredShopDeletes(shop, today);
    if (expiredNow.length) {
      shop = shop.filter(i => !expiredNow.includes(i));
      for (const item of expiredNow) DB.shop.remove(item.id).catch(() => {});
    }
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
