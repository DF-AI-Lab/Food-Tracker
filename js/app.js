(function() {
  let packs = [];
  let today = getToday();
  let lastAction = null;
  let undoTimeout = null;
  // Meal planner state
  let selDay = today;
  let selSlot = 'main';
  let pendingPlan = null; // { pack, day, slot } waiting for "Add anyway"

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

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('.pal [data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === theme));
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
    // Theme
    document.querySelectorAll('.pal [data-m]').forEach(btn => {
      btn.addEventListener('click', () => setTheme(btn.dataset.m));
    });

    // Print + mic: coming soon
    document.getElementById('printF').addEventListener('click', () => {
      const n = document.getElementById('printFNote');
      n.hidden = !n.hidden;
    });
    document.getElementById('mic').addEventListener('click', () => {
      document.getElementById('micNote').textContent = '🎤 Voice input: coming soon';
    });

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
    document.getElementById('actThrown').addEventListener('click', actThrown);
    document.getElementById('actFreeze').addEventListener('click', actFreeze);
    document.getElementById('actDelete').addEventListener('click', actDelete);
    document.getElementById('actCancel').addEventListener('click', hideSheet);

    // Undo
    document.getElementById('undoBtn').addEventListener('click', async () => {
      await undo();
    });

    // Meals: print is coming soon, slot tabs, next day
    document.getElementById('printWeek').addEventListener('click', () => {
      const n = document.getElementById('printWeekNote');
      n.hidden = !n.hidden;
    });
    document.querySelectorAll('#mtabs .sb').forEach(btn => {
      btn.addEventListener('click', () => { selSlot = btn.dataset.s; renderMeals(); });
    });
    document.getElementById('nextDay').addEventListener('click', () => {
      const days = FT.weekDays(today);
      selDay = days[(days.indexOf(selDay) + 1) % 7];
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
  }

  function switchSub(sub) {
    document.querySelectorAll('[data-sub]').forEach(b => b.classList.remove('on'));
    document.querySelector(`[data-sub="${sub}"]`).classList.add('on');

    document.querySelectorAll('[data-sub-pane]').forEach(p => p.style.display = 'none');
    document.querySelector(`[data-sub-pane="${sub}"]`).style.display = '';
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
      row.className = 'srow qf-row';

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

  function selectKind(kind) {
    document.querySelectorAll('[data-kind]').forEach(b => b.classList.remove('on'));
    document.querySelector(`[data-kind="${kind}"]`).classList.add('on');
    // "No date" is only for sides
    document.getElementById('noDate').closest('label').style.display = kind === 'side' ? '' : 'none';
    if (kind !== 'side') document.getElementById('noDate').checked = false;
    refreshUsuals();
    updateDatePreview();
  }

  function refreshUsuals() {
    const kind = document.querySelector('[data-kind].on')?.dataset.kind || 'main';
    const names = FT.usuals(packs, kind);
    const usuals = document.getElementById('usuals');
    usuals.innerHTML = '';
    names.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'qc usual';
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

  function addPacks() {
    const name = document.getElementById('name').value;
    const kind = document.querySelector('[data-kind].on')?.dataset.kind || 'main';
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
      const newPacks = FT.makePacks({ name, kind, date, dateType: document.querySelector('[data-dt].on')?.dataset.dt || 'use_by', count, toFreezer }, today);

      // Set success message immediately
      setAddMsg(`✓ added ${count} × ${name}`);
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
          setAddMsg('Error saving to database', true);
        }
      })();
    } catch (err) {
      const msg = err.message || 'Error';
      setAddMsg(msg, true);
    }
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

  const STATUS_CLASS = { green: 'ok', amber: 'soon', red: 'off' };

  function packButton(pack) {
    const colour = FT.colour(pack.date, today);
    const btn = document.createElement('button');
    btn.className = 'pack ' + STATUS_CLASS[colour] + ' use-by-' + colour;
    btn.dataset.id = pack.id;
    return btn;
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
        tag.textContent = pack.dateType === 'best_before' ? 'BB' : 'USE BY';
        if (plannedThisWeek(pack)) {
          btn.classList.add('plan');
          tag.textContent = '🍽️ ' + shortDay(pack.plannedFor);
        }
        btn.append(when, tag);
        btn.addEventListener('click', () => showSheet(pack.id));
        packsEl.appendChild(btn);
      });
      cardEl.appendChild(packsEl);
      el.appendChild(cardEl);
    });
  }

  function renderFridgeView() {
    const view = FT.fridgeView(packs, today);

    document.getElementById('mainCount').textContent = view.mainCount;
    renderCards(document.getElementById('mains'), view.mains);
    document.getElementById('sideCount').textContent = view.sideCount;
    renderCards(document.getElementById('sides'), view.sides);

    // Misc: name left, countdown right
    const miscEl = document.getElementById('misc');
    miscEl.innerHTML = '';
    view.misc.forEach(pack => {
      const btn = packButton(pack);
      const name = document.createElement('span');
      name.textContent = pack.name;
      const when = document.createElement('span');
      when.textContent = FT.countdown(pack.date, today);
      btn.append(name, when);
      btn.addEventListener('click', () => showSheet(pack.id));
      miscEl.appendChild(btn);
    });
    document.getElementById('miscOk').textContent = view.miscOk > 0 ? `+ ${view.miscOk} more, all OK` : '';

    // Veg & misc with no date: name left, age right
    const vegEl = document.getElementById('veg');
    vegEl.innerHTML = '';
    view.veg.forEach(pack => {
      const old = FT.isOld(pack.added, today);
      const btn = document.createElement('button');
      btn.className = 'age' + (old ? ' old' : '');
      btn.dataset.id = pack.id;
      const name = document.createElement('b');
      name.textContent = pack.name;
      const age = document.createElement('span');
      age.textContent = FT.ageLabel(pack.added, today) + (old ? ' ⚠️' : '');
      btn.append(name, age);
      btn.addEventListener('click', () => showSheet(pack.id));
      vegEl.appendChild(btn);
    });

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

      const emojiMap = { main: '🍖', side: '🥔', misc: '🧂' };
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

  function plannedThisWeek(pack) {
    return !!pack.plannedFor && FT.weekDays(today).includes(pack.plannedFor);
  }

  async function savePack(updated) {
    await DB.put(updated);
    const i = packs.findIndex(p => p.id === updated.id);
    if (i !== -1) packs[i] = updated;
  }

  function renderMeals() {
    const dayListEl = document.getElementById('dayList');
    dayListEl.innerHTML = '';
    FT.weekDays(today).forEach(day => {
      const btn = document.createElement('button');
      btn.className = 'day' + (day === selDay ? ' on' : '');
      const dn = document.createElement('span');
      dn.className = 'dn';
      dn.append(shortDay(day) + ' ');
      const date = document.createElement('small');
      date.textContent = FT.formatDate(day).split(' ').slice(1).join(' ');
      dn.appendChild(date);
      btn.appendChild(dn);
      FT.dayMeals(packs, day).forEach(item => btn.appendChild(mealChip(item, day)));
      btn.addEventListener('click', () => {
        selDay = day;
        selSlot = 'main';
        pendingPlan = null;
        renderMeals();
      });
      dayListEl.appendChild(btn);
    });

    document.querySelectorAll('#mtabs .sb').forEach(t => t.classList.toggle('on', t.dataset.s === selSlot));
    document.getElementById('pickFor').textContent = 'Adding to ' + FT.formatDate(selDay);
    renderWarnBar();
    renderPickList();
    renderWeekSummary();
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

  function renderWeekSummary() {
    const el = document.getElementById('weekSum');
    el.innerHTML = '';
    FT.weekDays(today).forEach(day => {
      const row = document.createElement('div');
      row.className = 'wrow';
      const d = document.createElement('b');
      d.textContent = shortDay(day);
      const list = document.createElement('span');
      const names = FT.dayMeals(packs, day).map(p => (p.kind === 'takeaway' ? '🥡 Takeaway' : p.name));
      if (names.length) {
        list.textContent = names.join(' + ');
      } else {
        const none = document.createElement('span');
        none.className = 'note';
        none.textContent = '—';
        list.appendChild(none);
      }
      row.append(d, list);
      el.appendChild(row);
    });
  }

  // Tap a food: warn first if it will be out of date on that day
  async function choosePick(pack) {
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
    selSlot = slot === 'main' ? 'side' : 'veg';
    renderMeals();
    renderAll();
  }

  async function addTakeaway() {
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
    const days = FT.weekDays(today);
    selDay = days[(days.indexOf(day) + 1) % 7];
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

  // Start
  window.addEventListener('DOMContentLoaded', init);
})();
