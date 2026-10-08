(function() {
  let packs = [];
  let today = getToday();
  let lastAction = null;
  let undoTimeout = null;

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

  async function init() {
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
    setupTheme();
    setupEventListeners();
    renderAll();
  }

  function setupTheme() {
    const stored = localStorage.getItem('theme');
    let theme = stored || 'dark';
    try {
      document.documentElement.setAttribute('data-theme', theme);
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch (e) {
      // ignore
    }
  }

  function setupEventListeners() {
    // Theme
    document.getElementById('theme').addEventListener('click', toggleTheme);

    // Tabs
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Fridge views
    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Kind selection
    document.querySelectorAll('[data-kind]').forEach(btn => {
      btn.addEventListener('click', () => selectKind(btn.dataset.kind));
    });

    // Add form
    document.getElementById('ddmm').addEventListener('input', updateDatePreview);
    document.getElementById('days').addEventListener('input', updateDatePreview);
    document.getElementById('noDate').addEventListener('change', updateDatePreview);
    document.getElementById('name').addEventListener('input', () => {
      document.getElementById('days').value = '';
      document.getElementById('ddmm').value = '';
      updateDatePreview();
    });

    document.getElementById('minus').addEventListener('click', () => changeCount(-1));
    document.getElementById('plus').addEventListener('click', () => changeCount(1));

    document.getElementById('addBtn').addEventListener('click', addPacks);

    // Date type toggle
    document.querySelectorAll('[data-dt]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-dt]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateDatePreview();
      });
    });

    // Sheet actions
    document.getElementById('actUsed').addEventListener('click', actUsed);
    document.getElementById('actThrown').addEventListener('click', actThrown);
    document.getElementById('actFreeze').addEventListener('click', actFreeze);
    document.getElementById('actDelete').addEventListener('click', actDelete);
    document.getElementById('actCancel').addEventListener('click', hideSheet);

    // Undo
    document.getElementById('undoBtn').addEventListener('click', async () => {
      await undo();
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
  }

  function switchSub(sub) {
    document.querySelectorAll('[data-sub]').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-sub="${sub}"]`).classList.add('active');

    document.querySelectorAll('[data-sub-pane]').forEach(p => p.style.display = 'none');
    document.querySelector(`[data-sub-pane="${sub}"]`).style.display = 'block';
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

  function clearQuickFillList() {
    quickFillItems = [];
    quickFillBoxes = [];
    document.getElementById('qfList').innerHTML = '';
    document.getElementById('qfAdd').style.display = 'none';
  }

  function checkQuickFill() {
    const msg = document.getElementById('qfMsg');
    const listEl = document.getElementById('qfList');
    const result = FT.parseQuickFill(document.getElementById('qfText').value, today);

    clearQuickFillList();
    if (result.error) {
      msg.textContent = result.error;
      return;
    }
    msg.textContent = '';

    const emojiMap = { main: '🍖', side: '🥔', misc: '🧂' };
    result.items.forEach(item => {
      const row = document.createElement('label');
      row.className = 'qf-row';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = item.ok;
      box.disabled = !item.ok;
      quickFillBoxes.push(box);
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
      if (item.toFreezer) text.append(' · 🧊');
      row.appendChild(text);

      if (!item.ok) {
        const problem = document.createElement('span');
        problem.className = 'qf-problem';
        problem.textContent = item.problem;
        row.appendChild(problem);
      }

      listEl.appendChild(row);
    });

    quickFillItems = result.items;
    document.getElementById('qfAdd').style.display = '';
  }

  async function addQuickFill() {
    const msg = document.getElementById('qfMsg');
    const chosen = quickFillItems.filter((item, i) => item.ok && quickFillBoxes[i].checked);
    if (chosen.length === 0) {
      msg.textContent = 'Tick at least one item to add';
      return;
    }

    const newPacks = chosen.flatMap(item => FT.makePacks({
      name: item.name, kind: item.kind, date: item.date,
      dateType: item.dateType, count: item.count, toFreezer: item.toFreezer
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
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

    document.querySelectorAll('[data-tab-pane]').forEach(p => p.style.display = 'none');
    document.querySelector(`[data-tab-pane="${tab}"]`).style.display = 'block';

    if (tab === 'fridge') {
      switchView('fridge');
    } else if (tab === 'add') {
      refreshUsuals();
    }
  }

  function switchView(view) {
    document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-view="${view}"]`).classList.add('active');

    document.querySelectorAll('[data-view-pane]').forEach(p => p.style.display = 'none');
    document.querySelector(`[data-view-pane="${view}"]`).style.display = 'block';

    if (view === 'fridge') renderFridgeView();
    else if (view === 'freezer') renderFreezerView();
    else if (view === 'used') renderUsedView();
  }

  function selectKind(kind) {
    document.querySelectorAll('[data-kind]').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-kind="${kind}"]`).classList.add('active');
    // "No date" is only for sides
    document.getElementById('noDate').closest('label').style.display = kind === 'side' ? '' : 'none';
    if (kind !== 'side') document.getElementById('noDate').checked = false;
    refreshUsuals();
    updateDatePreview();
  }

  function refreshUsuals() {
    const kind = document.querySelector('[data-kind].active')?.dataset.kind || 'main';
    const names = FT.usuals(packs, kind);
    const usuals = document.getElementById('usuals');
    usuals.innerHTML = '';
    names.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'usual';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        document.getElementById('name').value = name;
        document.getElementById('days').value = '';
        document.getElementById('ddmm').value = '';
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

    if (noDate) {
      preview.textContent = '';
      return;
    }

    let date = null;
    if (ddmm) {
      date = FT.parseDDMM(ddmm, today);
    } else if (days) {
      date = FT.parseDays(days, today);
    }

    if (!date) {
      preview.textContent = '';
      return;
    }

    const formatted = FT.formatDate(date);
    const color = FT.colour(date, today);
    const daysLeft = FT.daysLeft(date, today);

    let text = formatted;
    if (daysLeft < 0) {
      text += ' — out of date, check?';
    } else if (daysLeft === 0) {
      text += ' · today';
    } else {
      text += ' · ' + daysLeft + (daysLeft === 1 ? ' day left' : ' days left');
    }

    preview.textContent = text;
    preview.className = 'preview-' + color;
  }

  function changeCount(delta) {
    const countEl = document.getElementById('count');
    let count = parseInt(countEl.textContent) || 1;
    count = Math.max(1, count + delta);
    countEl.textContent = count;
  }

  function addPacks() {
    const name = document.getElementById('name').value;
    const kind = document.querySelector('[data-kind].active')?.dataset.kind || 'main';
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

    // Validate and create packs synchronously
    try {
      const newPacks = FT.makePacks({ name, kind, date, dateType: 'use_by', count, toFreezer }, today);

      // Set success message immediately
      document.getElementById('addMsg').textContent = `✓ added ${count} × ${name}`;
      showUndoBar();

      // Store packs for database operations
      const packsCopy = newPacks.map(p => ({ ...p }));

      // Now do async database operations
      (async () => {
        try {
          const ids = [];
          for (const pack of packsCopy) {
            const id = await DB.add(pack);
            pack.id = id;
            ids.push(id);
          }
          packs.push(...packsCopy);
          lastAction = { type: 'add', ids };

          document.getElementById('name').value = '';
          document.getElementById('ddmm').value = '';
          document.getElementById('days').value = '';
          document.getElementById('noDate').checked = false;
          document.getElementById('count').textContent = '1';
          updateDatePreview();
          refreshUsuals();
          renderAll();
        } catch (dbErr) {
          // Database error - revert the success message
          document.getElementById('addMsg').textContent = 'Error saving to database';
        }
      })();
    } catch (err) {
      const msg = err.message || 'Error';
      document.getElementById('addMsg').textContent = msg;
    }
  }

  let selectedPackId = null;

  function showSheet(packId) {
    selectedPackId = packId;
    const pack = packs.find(p => p.id === packId);
    if (!pack) return;

    document.getElementById('sheet').style.display = 'block';
    document.getElementById('sheet').querySelector('.title').textContent = pack.name;
    document.getElementById('sheet').querySelector('.subtitle').textContent = FT.formatDate(pack.date);
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
    lastAction = { type: 'update', packId: selectedPackId, before: beforeState };
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
      } else if (lastAction.type === 'update') {
        const packIndex = packs.findIndex(p => p.id === lastAction.packId);
        if (packIndex !== -1 && lastAction.before) {
          // Replace pack completely with restored state
          const restoredPack = JSON.parse(JSON.stringify(lastAction.before));
          packs[packIndex] = restoredPack;
          await DB.put(restoredPack);
        }
      }
    } finally {
      lastAction = null;
      document.getElementById('undoBar').style.display = 'none';
      renderAll();
    }
  }

  function renderFridgeView() {
    const view = FT.fridgeView(packs, today);

    // Mains
    const mainsEl = document.getElementById('mains');
    document.getElementById('mainCount').textContent = view.mainCount;
    mainsEl.innerHTML = '';
    view.mains.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = card.name;
      cardEl.appendChild(nameEl);
      card.packs.forEach(pack => {
        const btn = document.createElement('button');
        btn.className = 'pack';
        btn.dataset.id = pack.id;
        btn.textContent = FT.countdown(pack.date, today);
        btn.classList.add('use-by-' + FT.colour(pack.date, today));
        btn.addEventListener('click', () => showSheet(pack.id));
        cardEl.appendChild(btn);
      });
      mainsEl.appendChild(cardEl);
    });

    // Misc
    const miscEl = document.getElementById('misc');
    miscEl.innerHTML = '';
    view.misc.forEach(pack => {
      const btn = document.createElement('button');
      btn.className = 'pack';
      btn.dataset.id = pack.id;
      btn.textContent = pack.name + ' · ' + FT.countdown(pack.date, today);
      btn.classList.add('use-by-' + FT.colour(pack.date, today));
      btn.addEventListener('click', () => showSheet(pack.id));
      miscEl.appendChild(btn);
    });

    // Misc OK
    const miscOkEl = document.getElementById('miscOk');
    if (view.miscOk > 0) {
      miscOkEl.textContent = `+ ${view.miscOk} more, all OK`;
    } else {
      miscOkEl.textContent = '';
    }

    // Sides
    const sidesEl = document.getElementById('sides');
    document.getElementById('sideCount').textContent = view.sideCount;
    sidesEl.innerHTML = '';
    view.sides.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = card.name;
      cardEl.appendChild(nameEl);
      card.packs.forEach(pack => {
        const btn = document.createElement('button');
        btn.className = 'pack';
        btn.dataset.id = pack.id;
        btn.textContent = FT.countdown(pack.date, today);
        btn.classList.add('use-by-' + FT.colour(pack.date, today));
        btn.addEventListener('click', () => showSheet(pack.id));
        cardEl.appendChild(btn);
      });
      sidesEl.appendChild(cardEl);
    });

    // Veg
    const vegEl = document.getElementById('veg');
    vegEl.innerHTML = '';
    view.veg.forEach(pack => {
      const btn = document.createElement('button');
      btn.className = 'pack';
      btn.dataset.id = pack.id;
      let label = FT.ageLabel(pack.added, today);
      if (FT.isOld(pack.added, today)) {
        label += ' ⚠️';
      }
      btn.textContent = pack.name + ' · ' + label;
      btn.addEventListener('click', () => showSheet(pack.id));
      vegEl.appendChild(btn);
    });

    // Deleted today or yesterday: red line, with Undo
    const deletedEl = document.getElementById('deletedList');
    deletedEl.innerHTML = '';
    FT.deletedList(packs, today).forEach(pack => {
      const rowEl = document.createElement('div');
      rowEl.className = 'gone';
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
    freezerEl.innerHTML = '';

    list.forEach(item => {
      const rowEl = document.createElement('div');
      rowEl.className = 'frz';
      if (item.old) rowEl.classList.add('old');

      // Kind emoji
      const emojiMap = { main: '🍖', side: '🥔', misc: '🧂' };
      const emoji = emojiMap[item.pack.kind] || '📦';

      rowEl.innerHTML = `<span class="emoji">${emoji}</span><span class="name">${item.pack.name}</span><span class="label">${item.label}</span>`;

      const btn = document.createElement('button');
      btn.className = 'defrost';
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

    const listEl = document.getElementById('usedList');
    listEl.innerHTML = '';
    summary.list.forEach(pack => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      const status = pack.status === 'used' ? 'Used' : 'Wasted';
      rowEl.innerHTML = `<span class="name">${pack.name}</span><span class="date">${FT.formatDate(pack.date)}</span><span class="status">${status}</span>`;
      listEl.appendChild(rowEl);
    });
  }

  function renderAll() {
    document.getElementById('today').textContent = '📅 Today · ' + FT.formatDate(today);
    const activeView = document.querySelector('[data-view].active')?.dataset.view;
    if (activeView === 'fridge') renderFridgeView();
    else if (activeView === 'freezer') renderFreezerView();
    else if (activeView === 'used') renderUsedView();
  }

  // Start
  window.addEventListener('DOMContentLoaded', init);
})();
