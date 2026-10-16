(function() {
  // Constants
  const STARTERS = {
    main: ["Chicken", "Mince", "Sausages", "Gammon"],
    side: ["Dauphinoise potatoes", "Cauliflower cheese", "Roast potatoes", "Jacket potatoes", "Sweetcorn cobs"],
    veg: ["Carrots", "Onions", "Broccoli", "Peppers", "Mushrooms", "Leeks", "Cabbage", "Potatoes"],
    misc: ["Milk", "Eggs", "Margarine", "Butter"]
  };
  const KINDS = ["main", "side", "veg", "misc", "cupboard"];
  // What the app calls each kind. misc is the old Misc, now "Other" (the value stays "misc")
  const KIND_LABELS = { main: "Main", side: "Side", veg: "Veg", misc: "Other", cupboard: "Cupboard" };
  function kindLabel(kind) {
    return Object.prototype.hasOwnProperty.call(KIND_LABELS, kind) ? KIND_LABELS[kind] : "";
  }
  // The fridge menu's small line: "Tue 13 Oct · Cupboard · £1.20" (Price n/a when there is none)
  function sheetLine(pack, today) {
    const when = pack.date ? formatDate(pack.date) : ageLabel(pack.added, today);
    const price = typeof pack.price === "number" ? `£${pack.price.toFixed(2)}` : "Price n/a";
    return [when, kindLabel(pack.kind), price].filter(Boolean).join(" · ");
  }

  // Everyday UK fresh foods, offered even when never bought (after STARTERS in foodCandidates)
  const COMMON_FOODS = {
    "Beef": "main", "Steak": "main", "Turkey": "main", "Pork chops": "main", "Pork belly": "main",
    "Lamb": "main", "Duck": "main", "Salmon": "main", "Cod": "main", "Haddock": "main",
    "Fish fingers": "main", "Prawns": "main", "Tuna": "main", "Chorizo": "main", "Ham": "main",
    "Bacon": "main", "Meatballs": "main", "Tofu": "main",
    "Pastry": "side", "Yorkshire puddings": "side", "Stuffing": "side", "Chips": "side", "Mash": "side",
    "Rice": "side", "Pasta": "side", "Naan bread": "side", "Garlic bread": "side", "Coleslaw": "side",
    "Couscous": "side", "Noodles": "side", "Pitta bread": "side", "Burger buns": "side",
    "Sweet potatoes": "side", "Potato wedges": "side", "Hash browns": "side", "Crusty bread": "side",
    "Mushrooms": "veg", "Spinach": "veg", "Courgette": "veg", "Sweetcorn": "veg", "Peas": "veg",
    "Green beans": "veg", "Garlic": "veg", "Tomatoes": "veg", "Lettuce": "veg", "Cucumber": "veg",
    "Aubergine": "veg", "Celery": "veg", "Butternut squash": "veg", "Cauliflower": "veg", "Kale": "veg",
    "Red onions": "veg", "Spring onions": "veg", "Parsnips": "veg", "Beetroot": "veg", "Asparagus": "veg",
    "Lemons": "veg", "Bean sprouts": "veg",
    "Gravy granules": "misc", "Tortilla wraps": "misc", "Cheese": "misc", "Grated cheese": "misc",
    "Cream": "misc", "Double cream": "misc", "Yoghurt": "misc", "Sour cream": "misc",
    "Creme fraiche": "misc", "Mayonnaise": "misc", "Ketchup": "misc", "Halloumi": "misc",
    "Hummus": "misc", "Mozzarella": "misc", "Parmesan": "misc", "Feta": "misc", "Passata": "misc",
    "Baked beans": "misc", "Pesto": "misc", "Salsa": "misc", "Soy sauce": "misc"
  };

  // Date utilities
  // Ids are strings in V2 (cloud ids), numbers in V1: compare both the same way
  function byId(a, b) {
    const x = String(a.id), y = String(b.id);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  function addDays(iso, n) {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().split("T")[0];
  }

  function daysLeft(iso, today) {
    const target = new Date(iso + "T00:00:00Z");
    const todayDate = new Date(today + "T00:00:00Z");
    const diff = target - todayDate;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  function formatDate(iso) {
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const d = new Date(iso + "T00:00:00Z");
    const weekday = weekdays[d.getUTCDay()];
    const day = d.getUTCDate();
    const month = months[d.getUTCMonth()];

    return `${weekday} ${day} ${month}`;
  }

  function parseDDMM(str, today) {
    if (!str || str.length !== 4 && str.length !== 6) return null;
    if (!/^\d+$/.test(str)) return null;

    let day, month, year;

    if (str.length === 4) {
      day = parseInt(str.substring(0, 2), 10);
      month = parseInt(str.substring(2, 4), 10);
      year = new Date(today + "T00:00:00Z").getUTCFullYear();
    } else {
      day = parseInt(str.substring(0, 2), 10);
      month = parseInt(str.substring(2, 4), 10);
      year = 2000 + parseInt(str.substring(4, 6), 10);
    }

    // Validate date
    if (month < 1 || month > 12 || day < 1) return null;

    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
      daysInMonth[1] = 29;
    }
    if (day > daysInMonth[month - 1]) return null;

    const result = new Date(Date.UTC(year, month - 1, day));
    const iso = result.toISOString().split("T")[0];
    return iso;
  }

  function parseDays(str, today) {
    if (!str || !/^\d+$/.test(str)) return null;
    const n = parseInt(str, 10);
    if (n < 0) return null;
    return addDays(today, n);
  }

  // Countdown and colour
  function countdown(date, today) {
    const days = daysLeft(date, today);
    if (days > 5) return formatDate(date);
    if (days >= 2 && days <= 5) return `${days} days left`;
    if (days === 1) return "1 day left";
    if (days === 0) return "Today!";
    if (days === -1) return "1 day out";
    return `${-days} days out`;
  }

  function colour(date, today) {
    const days = daysLeft(date, today);
    if (days > 3) return "green";
    if (days >= 0) return "amber";
    return "red";
  }

  // Age
  function ageLabel(added, today) {
    const age = daysLeft(today, added);
    if (age === 0) return "Added today";
    if (age === 1) return "1 day old";
    return `${age} days old`;
  }

  function isOld(added, today) {
    return daysLeft(today, added) >= 7;
  }

  // Pack creation
  function makePacks(spec, today) {
    const { name, kind, date, dateType, count, toFreezer, noDate, dateMissing, sub, price } = spec;

    // Validation
    if (!name || !name.trim()) throw new Error("Empty name");
    if (["main", "misc", "cupboard"].includes(kind) && !date && !noDate) throw new Error(`${kind} needs a date`);

    const trimmedName = name.trim();
    const capitalizedName = trimmedName.charAt(0).toUpperCase() + trimmedName.slice(1);

    const packs = [];
    for (let i = 0; i < count; i++) {
      const pack = {
        name: capitalizedName,
        kind,
        date: date || null,
        dateType: date ? (dateType || "use_by") : null,
        status: toFreezer ? "frozen" : "in_fridge",
        added: today,
        left: null,
        frozen: toFreezer ? today : null,
        sub: sub || null,
        price: (typeof price === "number" ? price : null)
      };
      if (dateMissing === true) pack.dateMissing = true;
      packs.push(pack);
    }
    return packs;
  }

  // Pack actions
  function markUsed(pack, today) {
    return { ...pack, status: "used", left: today };
  }

  function markThrown(pack, today) {
    return { ...pack, status: "thrown_away", left: today };
  }

  function freeze(pack, today) {
    return { ...pack, status: "frozen", frozen: today };
  }

  function defrost(pack, today) {
    const nextDay = addDays(today, 1);
    return { ...pack, status: "in_fridge", date: nextDay, dateType: "use_by", frozen: null };
  }

  // Delete (a mistake): not saved as used or wasted. Kept for Undo for 1 hour (Darren 2026-10-16).
  // del is the time it was deleted (ms); older data has a date string, which counts as gone.
  function markDeleted(pack, today, now = Date.now()) {
    return { ...pack, status: "deleted", del: now };
  }

  const DELETE_KEEP_MS = 3600000;

  // Deleted in the last hour: shown in the Fridge list with Undo, newest first
  function deletedList(packs, today, now = Date.now()) {
    return packs
      .filter(p => p.status === "deleted" && typeof p.del === "number" && now - p.del < DELETE_KEEP_MS)
      .sort((a, b) => b.del - a.del);
  }

  // Deleted over an hour ago (or under the old day rule): remove from the database for good
  function expiredDeletes(packs, today, now = Date.now()) {
    return packs.filter(p => p.status === "deleted" && !(typeof p.del === "number" && now - p.del < DELETE_KEEP_MS));
  }

  // Remembered "no date" per food: the latest pack (not deleted) of that name decides
  function rememberedNoDate(allPacks, name) {
    const key = String(name ?? "").trim().toLowerCase();
    if (!key) return false;
    let latest = null;
    for (const p of allPacks || []) {
      if (p.status === "deleted") continue;
      if (String(p.name ?? "").trim().toLowerCase() !== key) continue;
      if (!latest || p.added > latest.added || (p.added === latest.added && p.id > latest.id)) latest = p;
    }
    return !!latest && (latest.date === null || latest.date === undefined || latest.date === "");
  }

  // Remembered kind per food: the latest pack (not deleted) decides, else the starter lists
  function rememberedKind(allPacks, name) {
    const key = String(name ?? "").trim().toLowerCase();
    if (!key) return null;
    let latest = null;
    for (const p of allPacks || []) {
      if (p.status === "deleted") continue;
      if (String(p.name ?? "").trim().toLowerCase() !== key) continue;
      if (!latest || p.added > latest.added || (p.added === latest.added && p.id > latest.id)) latest = p;
    }
    if (latest) return latest.kind;
    const starter = KINDS.find(k => (STARTERS[k] || []).some(s => s.toLowerCase() === key));
    return starter || null;
  }

  // Every food the Add search can offer: non-deleted pack names (deduped case-insensitively,
  // first spelling kept, kind remembered) then the starter foods. Each has a lower-case key.
  function foodCandidates(allPacks) {
    const counts = {};
    const cands = []; // { name, key, kind, count }
    const seen = new Set();
    for (const p of (allPacks || []).filter(p => p.status !== "deleted")) {
      const name = String(p.name ?? "").trim();
      const key = name.toLowerCase();
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push({ name, key, kind: rememberedKind(allPacks, name), count: 0 });
    }
    for (const kind of KINDS) {
      for (const name of STARTERS[kind] || []) {
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cands.push({ name, key, kind, count: 0 });
      }
    }
    for (const name of Object.keys(COMMON_FOODS)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push({ name, key, kind: COMMON_FOODS[name], count: 0 });
    }
    for (const c of cands) c.count = counts[c.key] || 0;
    return cands;
  }

  // Add-screen search: foods (from packs, then starters) whose name contains the text.
  // Names starting with the text come first, then most-added, then alphabetical. Max 10.
  function searchFoods(allPacks, query) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return [];
    return foodCandidates(allPacks)
      .filter(c => c.key.includes(q))
      .map(c => ({ ...c, starts: c.key.startsWith(q) }))
      .sort((a, b) => (b.starts - a.starts) || (b.count - a.count) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, 10)
      .map(c => ({ name: c.name, kind: c.kind }));
  }

  // Edit distance between two strings (insert, delete, replace each cost 1)
  function editDistance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // Chips while typing a fresh food: searchFoods first, then spelling-slip matches (closest first,
  // then name). Blank text = nothing; under 3 letters = no slip matches. Names in `exclude` (any case)
  // are left out. Max 10.
  function suggestFoods(allPacks, query, exclude = []) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return [];
    const out = searchFoods(allPacks, query);
    const have = new Set(out.map(o => o.name.toLowerCase()));
    if (q.length >= 3) {
      const limit = q.length >= 6 ? 2 : 1;
      const slips = [];
      for (const c of foodCandidates(allPacks)) {
        if (have.has(c.key)) continue;
        const n = q.length;
        let best = Infinity;
        for (const L of [n - 1, n, n + 1]) {
          if (L < 1) continue;
          best = Math.min(best, editDistance(q, c.key.slice(0, L)));
        }
        best = Math.min(best, editDistance(q, c.key));
        if (best <= limit) slips.push({ name: c.name, key: c.key, kind: c.kind, dist: best });
      }
      slips.sort((a, b) => (a.dist - b.dist) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const s of slips) out.push({ name: s.name, kind: s.kind });
    }
    const skip = new Set(exclude.map(e => String(e ?? "").trim().toLowerCase()));
    return out.filter(o => !skip.has(o.name.toLowerCase())).slice(0, 10);
  }

  // How many packs of this food were ever added (not counting deleted ones)
  function boughtCount(allPacks, name) {
    const key = String(name ?? "").trim().toLowerCase();
    if (!key) return 0;
    return (allPacks || []).filter(p =>
      p.status !== "deleted" && String(p.name ?? "").trim().toLowerCase() === key).length;
  }

  // Fridge view utilities
  function cards(packs, kind) {
    // Filter: in_fridge with a date and that kind
    const filtered = packs.filter(p =>
      p.status === "in_fridge" && p.date && p.kind === kind
    );

    // Sort by date
    const sorted = filtered.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return byId(a, b); // stable sort by id
    });

    // Group by name
    const grouped = {};
    const nameOrder = [];
    for (const pack of sorted) {
      if (!grouped[pack.name]) {
        grouped[pack.name] = [];
        nameOrder.push(pack.name);
      }
      grouped[pack.name].push(pack);
    }

    // Split each name's list into chunks of 2 and create result
    const result = [];
    for (const name of nameOrder) {
      const packs = grouped[name];
      for (let i = 0; i < packs.length; i += 2) {
        const chunk = packs.slice(i, i + 2);
        result.push({ name, packs: chunk });
      }
    }

    // Sort by first pack's date
    result.sort((a, b) => {
      const dateA = a.packs[0].date;
      const dateB = b.packs[0].date;
      return dateA.localeCompare(dateB);
    });

    return result;
  }

  // Use soon: fridge packs with a date 2 days or less away (today and out-of-date included)
  function useSoon(packs, today) {
    return packs
      .filter(p => p.status === "in_fridge" && p.date && daysLeft(p.date, today) <= 2)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function fridgeView(packs, today) {
    const inFridge = packs.filter(p => p.status === "in_fridge");
    const byAdded = (a, b) => a.added.localeCompare(b.added);

    // Mains: dated cards, plus undated mains listed under them (oldest first)
    const mains = cards(packs, "main");
    const mainsNoDate = inFridge.filter(p => p.kind === "main" && !p.date).sort(byAdded);

    // Sides: dated cards, plus undated sides (oldest first)
    const sides = cards(packs, "side");
    const sidesNoDate = inFridge.filter(p => p.kind === "side" && !p.date).sort(byAdded);

    // Veg: all veg, dated or not, oldest first
    const veg = inFridge.filter(p => p.kind === "veg").sort(byAdded);

    // Misc: every misc pack; dated soonest first, then undated oldest first
    const miscDated = inFridge.filter(p => p.kind === "misc" && p.date).sort((a, b) => a.date.localeCompare(b.date));
    const miscUndated = inFridge.filter(p => p.kind === "misc" && !p.date).sort(byAdded);
    const misc = [...miscDated, ...miscUndated];

    // Cupboard (its own tab, not in the fridge): dated soonest first, then undated oldest first
    const cupboardDated = packs.filter(p => p.status === "in_fridge" && p.kind === "cupboard" && p.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    const cupboardUndated = packs.filter(p => p.status === "in_fridge" && p.kind === "cupboard" && !p.date).sort(byAdded);
    const cupboard = [...cupboardDated, ...cupboardUndated];

    const countKind = kind => inFridge.filter(p => p.kind === kind).length;

    return {
      mains,
      mainsNoDate,
      sides,
      sidesNoDate,
      veg,
      misc,
      cupboard,
      mainCount: countKind("main"),
      sideCount: countKind("side"),
      vegCount: countKind("veg"),
      miscCount: countKind("misc"),
      cupboardCount: countKind("cupboard")
    };
  }

  // Freezer
  function freezeAge(frozenIso, today) {
    const age = daysLeft(today, frozenIso);
    if (age === 0) return "today";
    if (age === 1) return "1 day";
    if (age < 14) return `${age} days`;
    if (age < 60) return `${Math.floor(age / 7)} weeks`;
    return `${Math.floor(age / 30)} months`;
  }

  function freezerList(packs, today) {
    const frozen = packs.filter(p => p.status === "frozen");

    frozen.sort((a, b) => a.frozen.localeCompare(b.frozen));

    return frozen.map(pack => {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const d = new Date(pack.frozen + "T00:00:00Z");
      const day = d.getUTCDate();
      const month = months[d.getUTCMonth()];
      const age = freezeAge(pack.frozen, today);

      const label = `in ${day} ${month} · ${age}`;
      const frozenAge = daysLeft(today, pack.frozen);
      const old = frozenAge >= 90;

      return { pack, label, old };
    });
  }

  // Used & wasted
  function usedSummary(packs, today) {
    // Get year and month of today
    const todayDate = new Date(today + "T00:00:00Z");
    const thisYear = todayDate.getUTCFullYear();
    const thisMonth = todayDate.getUTCMonth();

    // Count used and thrown_away with left in this month
    const thisMonthPacks = packs.filter(p => {
      if ((p.status !== "used" && p.status !== "thrown_away") || !p.left) return false;
      const leftDate = new Date(p.left + "T00:00:00Z");
      return leftDate.getUTCFullYear() === thisYear && leftDate.getUTCMonth() === thisMonth;
    });

    const used = thisMonthPacks.filter(p => p.status === "used").length;
    const wasted = thisMonthPacks.filter(p => p.status === "thrown_away").length;

    // All used + thrown_away sorted by left newest first
    const allUsedThrownAway = packs
      .filter(p => (p.status === "used" || p.status === "thrown_away") && p.left)
      .sort((a, b) => b.left.localeCompare(a.left));

    return {
      used,
      wasted,
      list: allUsedThrownAway
    };
  }

  // Usuals
  function usuals(allPacks, kind) {
    const starters = STARTERS[kind] || [];
    const packs = allPacks.filter(p => p.status !== "deleted");

    // Collect all names from packs of this kind (case-insensitive dedupe, keep first spelling)
    const nameMap = {};
    const nameOrder = [];

    for (const pack of packs) {
      if (pack.kind === kind) {
        const lowerName = pack.name.toLowerCase();
        if (!nameMap[lowerName]) {
          nameMap[lowerName] = pack.name;
          nameOrder.push(lowerName);
        }
      }
    }

    // Count packs per name
    const counts = {};
    for (const lowerName of nameOrder) {
      counts[lowerName] = packs.filter(p => p.kind === kind && p.name.toLowerCase() === lowerName).length;
    }

    // Sort: by count desc, then starters first (in starter order), then alphabetically
    const allNames = [...starters];
    for (const lowerName of nameOrder) {
      const name = nameMap[lowerName];
      if (!allNames.some(n => n.toLowerCase() === lowerName)) {
        allNames.push(name);
      }
    }

    // Sort by count (for non-starters), then by order
    allNames.sort((a, b) => {
      const aIsStarter = starters.some(s => s.toLowerCase() === a.toLowerCase());
      const bIsStarter = starters.some(s => s.toLowerCase() === b.toLowerCase());

      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();

      const aCount = counts[aLower] || 0;
      const bCount = counts[bLower] || 0;

      if (aCount !== bCount) return bCount - aCount; // desc

      if (aIsStarter && !bIsStarter) return -1;
      if (!aIsStarter && bIsStarter) return 1;

      if (aIsStarter && bIsStarter) {
        return starters.findIndex(s => s.toLowerCase() === aLower) - starters.findIndex(s => s.toLowerCase() === bLower);
      }

      return a.localeCompare(b);
    });

    return allNames;
  }

  // Quick fill (JSON pasted back from Claude)
  const CLAUDE_PROMPT = [
    "I'm sending you photos of my fridge and freezer. Please:",
    "- Make one entry per photo (one food item each).",
    "- \"name\": the short main name, e.g. \"Chicken\".",
    "- \"sub\": the full packet name as printed, e.g. \"Asda chicken breasts 500g\".",
    "- \"date\": YYYY-MM-DD. Use the use-by date, else the best before date. Ignore \"display until\".",
    "- \"price\": a number only if a price is printed, e.g. 3.5 (no £ sign).",
    "- \"bb\": true only if the date is a best before date.",
    "- \"packs\": only if there is more than one pack with the same date.",
    "- Fresh veg or fruit (\"veg\"): name only, no date, e.g. {\"name\":\"Carrots\"}.",
    "- Items that never have a date (e.g. margarine, ketchup): leave out the date and add \"noDate\":true.",
    "- Do not add a \"kind\" field. The app works out the kind itself.",
    "- Never guess. If you can't read a date clearly, or you are unsure of the name, ASK me before giving the JSON.",
    "- Reply with only a JSON array in a ```json block, like this:",
    "[{\"name\":\"Chicken\",\"sub\":\"Asda chicken breasts\",\"date\":\"2026-10-12\",\"price\":3.5},{\"name\":\"Milk\",\"sub\":\"Cravendale 2L\",\"date\":\"2026-10-15\",\"bb\":true},{\"name\":\"Mince\",\"sub\":\"Tesco beef mince 5%\",\"date\":\"2026-10-10\",\"packs\":3},{\"name\":\"Carrots\"}]",
    "Keep it short and plain English."
  ].join("\n");

  function isRealDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d) && d.toISOString().split("T")[0] === s;
  }

  // "3.5", 3.5 or "£3.50" give a number; anything else (or negative) gives null
  function parsePrice(v) {
    if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
    if (typeof v !== "string") return null;
    const s = v.trim().replace(/^£\s*/, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return parseFloat(s);
  }

  // Step 7a: edit a pack. Returns a NEW pack with only the keys given in `changes` changed.
  function editPack(pack, changes) {
    const has = key => Object.prototype.hasOwnProperty.call(changes, key);
    const out = { ...pack };

    if (has("name")) {
      const trimmed = String(changes.name ?? "").trim();
      if (!trimmed) throw new Error("Needs a name");
      out.name = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
    if (has("sub")) {
      const trimmed = String(changes.sub ?? "").trim();
      out.sub = trimmed || null;
    }
    if (has("kind")) {
      if (!KINDS.includes(changes.kind)) throw new Error("Kind must be main, side, veg, misc or cupboard");
      out.kind = changes.kind;
    }
    if (has("date")) {
      const d = changes.date;
      if (d === "" || d === null || d === undefined) {
        out.date = null;
      } else {
        if (!isRealDate(d)) throw new Error("Date must look like 2026-10-10");
        out.date = d;
      }
    }
    if (has("dateType")) {
      if (changes.dateType !== "use_by" && changes.dateType !== "best_before") {
        throw new Error("Date type must be use_by or best_before");
      }
      out.dateType = changes.dateType;
    }
    if (has("price")) {
      const v = changes.price;
      if (v === "" || v === null || v === undefined) {
        out.price = null;
      } else {
        const s = typeof v === "string" ? v.trim().replace(/^£\s*/, "") : v;
        const n = typeof s === "number" ? s : (/^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN);
        if (!Number.isFinite(n) || n < 0) throw new Error("Price must be a number");
        out.price = n;
      }
    }

    if (out.date === null) {
      out.dateType = null;
    } else if (!out.dateType) {
      out.dateType = "use_by";
    }
    if (["main", "misc", "cupboard"].includes(out.kind) && !out.date && !out.noDate) {
      throw new Error("Needs a date");
    }
    return out;
  }

  function quickFillRow(row, allPacks = []) {
    const r = row || {};
    const rawName = String(r.name ?? "").trim();
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const sub = String(r.sub ?? "").trim() || null;
    const price = parsePrice(r.price);

    // Kind: given in the row, else remembered for this food (no kind yet = ask the user)
    let kind = String(r.kind ?? "").trim().toLowerCase();
    if (kind === "vegetable") kind = "veg";
    const kindGiven = kind !== "";
    if (!kindGiven) kind = rememberedKind(allPacks, name) || "";
    const needsKind = kind === "";

    // Date: bb or dateType best_before → best before, else use by
    const sentDate = r.date !== null && r.date !== undefined && String(r.date).trim() !== "";
    const forcedNoDate = kind === "veg" || rememberedNoDate(allPacks, name);
    const hasDate = sentDate && !forcedNoDate;
    const date = hasDate ? String(r.date).trim() : null;
    const dateType = hasDate ? (r.bb === true || r.dateType === "best_before" ? "best_before" : "use_by") : null;

    // No date is fine for sides and veg, for foods marked noDate, or for foods remembered with no date
    const dateMissing = r.dateMissing === true;
    const noDate = forcedNoDate || (!hasDate && (r.noDate === true || kind === "side" || dateMissing));

    const count = Math.min(20, Math.max(1, parseInt(r.packs ?? r.count ?? 1, 10) || 1));
    const toFreezer = r.freezer === true || r.toFreezer === true;

    let problem = null;
    if (!name) problem = "Needs a name";
    else if (needsKind) problem = "Pick a kind";
    else if (!KINDS.includes(kind)) problem = "Kind must be main, side, veg, misc or cupboard";
    else if (hasDate && !isRealDate(date)) problem = "Date must look like 2026-10-10";
    else if (!hasDate && !noDate) problem = "Needs a date";

    return {
      name, sub, price, kind, date, dateType, count, toFreezer, noDate, dateMissing,
      check: r.check === true,
      ok: problem === null, problem, needsKind, raw: row
    };
  }

  function parseQuickFill(text, today, allPacks = []) {
    const raw = String(text || "").trim();
    if (!raw) return { error: "Paste the JSON from Claude first", items: [] };

    const readError = { error: "Couldn't read that — copy the whole JSON from Claude", items: [] };

    // Strip ``` fences, then keep from the first [ or { to its matching last ] or }
    const body = raw.replace(/```(json)?/gi, "");
    const starts = [body.indexOf("["), body.indexOf("{")].filter(i => i >= 0);
    if (starts.length === 0) return readError;
    const start = Math.min(...starts);
    const end = body.lastIndexOf(body[start] === "[" ? "]" : "}");
    if (end < start) return readError;

    let data;
    try {
      data = JSON.parse(body.slice(start, end + 1));
    } catch (e) {
      return readError;
    }

    const list = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : []);
    if (list.length === 0) return { error: "No food found in that", items: [] };

    return { error: null, items: list.map(row => quickFillRow(row, allPacks)) };
  }

  // Meal planner
  const SLOT_ORDER = { main: 0, side: 1, veg: 2, misc: 3 };

  // Mon..Sun of the week that contains today
  function weekDays(today) {
    const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7; // Mon = 0
    const monday = addDays(today, -dow);
    return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(monday, i));
  }

  // Packs that can be picked for a slot: one row per food, soonest pack first
  // Veg for meals and shopping: the veg kind, plus sides with no date
  function isVegPack(p) {
    return p.kind === "veg" || (p.kind === "side" && !p.date);
  }

  // Misc: dated packs soonest first, then undated packs oldest first (dates may be null)
  function miscOrder(a, b) {
    if (a.date && b.date) return a.date.localeCompare(b.date) || byId(a, b);
    if (a.date) return -1;
    if (b.date) return 1;
    return (a.added || "").localeCompare(b.added || "") || byId(a, b);
  }

  function mealPick(packs, slot) {
    const inSlot = slot === "misc" ? (p => p.kind === "misc")
      : slot === "veg" ? isVegPack
      : (p => p.kind === slot && !!p.date);
    const free = packs.filter(p =>
      p.status === "in_fridge" && !p.plannedFor && p.kind !== "takeaway" && inSlot(p)
    );

    const sortKey = p => (slot === "veg" ? p.added : p.date);
    const byKey = slot === "misc" ? miscOrder
      : (a, b) => sortKey(a).localeCompare(sortKey(b)) || byId(a, b);

    const groups = new Map();
    for (const p of free.sort(byKey)) {
      const key = p.name.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }

    return [...groups.values()]
      .map(list => ({ name: list[0].name, pack: list[0], count: list.length }))
      .sort((a, b) => byKey(a.pack, b.pack));
  }

  function planPack(pack, dayIso, slot) {
    return { ...pack, plannedFor: dayIso, slot };
  }

  function unplanPack(pack) {
    return { ...pack, plannedFor: null, slot: null, mealId: null, mealName: null, mealPlanId: null };
  }

  // Days a pack is out of date on a planned day (0 if fine or undated)
  function outByDay(pack, dayIso) {
    if (!pack.date) return 0;
    return Math.max(0, daysLeft(dayIso, pack.date));
  }

  function makeTakeaway(dayIso) {
    return { name: "Takeaway", kind: "takeaway", status: "plan", plannedFor: dayIso, slot: "main",
      date: null, dateType: null, added: dayIso, left: null, frozen: null };
  }

  // A day's plan: planned fridge packs and takeaways, main then side then veg
  function dayMeals(packs, dayIso) {
    return packs
      .filter(p => p.plannedFor === dayIso &&
        (p.status === "in_fridge" || (p.kind === "takeaway" && p.status === "plan")))
      .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
  }

  // Meal ideas: food combos eaten at home (2+ foods), most had first, then latest.
  // missing = food names with no free fridge pack (in fridge, not planned)
  function mealIdeas(meals, packs) {
    const groups = new Map();
    for (const m of meals) {
      if (m.takeaway === true || !Array.isArray(m.items) || m.items.length < 2) continue;
      const names = m.items.map(i => String(i.name).toLowerCase()).sort();
      const key = names.join("\u0001");
      if (!groups.has(key)) groups.set(key, { count: 0, day: "", items: [] });
      const g = groups.get(key);
      g.count++;
      if (m.day >= g.day) { // most recent meal of the combo supplies the items
        g.day = m.day;
        g.items = m.items.map(i => ({ name: i.name, slot: i.slot }));
      }
    }

    const slotRank = slot => (slot in SLOT_ORDER ? SLOT_ORDER[slot] : 3);
    const freeNames = new Set(
      packs.filter(p => p.status === "in_fridge" && !p.plannedFor).map(p => p.name.toLowerCase())
    );

    return [...groups.values()]
      .map(g => {
        const items = [...g.items].sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
        // Casing as in the fridge when the food is there; otherwise as the meal had it
        const named = items.map(i => {
          const pack = packs.find(p => p.name.toLowerCase() === String(i.name).toLowerCase());
          return { ...i, name: pack ? pack.name : i.name };
        });
        const missing = named.filter(i => !freeNames.has(i.name.toLowerCase())).map(i => i.name);
        return { name: named.map(i => i.name).join(" + "), items: named, count: g.count, day: g.day, missing };
      })
      .sort((a, b) => b.count - a.count || b.day.localeCompare(a.day))
      .map(({ day, ...rest }) => rest);
  }

  // Shopping list
  // Order: to get (newest first), then crossed out, then deleted today or yesterday
  function byNewest(a, b) {
    return b.added.localeCompare(a.added) || byId(b, a);
  }

  function shopOrder(items, today, now = Date.now()) {
    const toGet = items.filter(i => !i.got && !i.del).sort(byNewest);
    const got = items.filter(i => i.got && !i.del).sort(byNewest);
    const gone = items.filter(i => i.del && (typeof i.del === "number"
      ? now - i.del < SHOP_DEL_MS
      : daysLeft(i.del, today) >= -1)).sort(byNewest);
    return [...toGet, ...got, ...gone];
  }

  // Shop items to get that one of the added foods may have bought: a whole word (3+ letters) in common
  function shopMatches(shopItems, addedNames) {
    const wordsOf = s => String(s).toLowerCase().match(/\p{L}{3,}/gu) || [];
    const added = new Set(addedNames.flatMap(wordsOf));
    return shopItems.filter(i => !i.got && !i.del && wordsOf(i.name).some(w => added.has(w)));
  }

  // Same food typed or added again while it is still to get: one line, counted (Darren 2026-10-15).
  // auto null = the user typed it (replaces the app's reason); otherwise the item keeps its reason.
  function shopMerge(item, auto) {
    return { ...item, count: (item.count || 1) + 1, auto: auto === null ? null : item.auto };
  }

  // "Chicken · 2 used", "Milk · 2", or just the name
  function shopLabel(item) {
    const n = item.count || 1;
    if (n > 1 && item.auto) return `${item.name} · ${n} used`;
    if (n > 1) return `${item.name} · ${n}`;
    return item.name;
  }

  // Old repeated lines: among the items to get, one line per name (lower case).
  // keep = the first of each repeated name, with the summed count; remove = the other ids.
  function foldShopRepeats(items) {
    const groups = new Map();
    for (const item of items) {
      if (item.got || item.del) continue;
      const key = String(item.name).toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const keep = [];
    const remove = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const total = group.reduce((sum, i) => sum + (i.count || 1), 0);
      keep.push({ ...group[0], count: total });
      for (const extra of group.slice(1)) remove.push(extra.id);
    }
    return { keep, remove };
  }

  // Search: fridge, cupboard and freezer packs whose name or sub matches (case-insensitive)
  function searchPacks(packs, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const pack of packs) {
      const hit = String(pack.name || "").toLowerCase().includes(q) ||
        String(pack.sub || "").toLowerCase().includes(q);
      if (!hit) continue;
      let place = null;
      if (pack.status === "in_fridge") place = pack.kind === "cupboard" ? "Cupboard" : "Fridge";
      else if (pack.status === "frozen") place = "Freezer";
      if (place) out.push({ pack, place });
    }
    return out.sort((a, b) => a.pack.name.localeCompare(b.pack.name) || a.place.localeCompare(b.place));
  }

  // Packs added today that are still in the fridge or freezer: mains, sides, veg, misc, then name
  const ADDED_ORDER = ["main", "side", "veg", "misc"];
  function addedToday(packs, today) {
    const rank = p => (ADDED_ORDER.includes(p.kind) ? ADDED_ORDER.indexOf(p.kind) : 4);
    return packs
      .filter(p => p.added === today && (p.status === "in_fridge" || p.status === "frozen"))
      .sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
  }

  // UB (use by) or BB (best before) for a dated pack, "" when it has no date
  function dateTag(pack) {
    if (!pack.date) return "";
    return pack.dateType === "best_before" ? "BB" : "UB";
  }

  // A deleted shopping item stays for 1 hour (del is a ms timestamp), then goes for good.
  // Old data (del is a YYYY-MM-DD string) counts as gone straight away.
  const SHOP_DEL_MS = 3600 * 1000;
  function expiredShopDeletes(items, today, now = Date.now()) {
    return items.filter(i => {
      if (!i.del) return false;
      if (typeof i.del === "number") return now - i.del >= SHOP_DEL_MS;
      return true;
    });
  }

  // Whole minutes left before a deleted shopping item goes (at least 1); 0 for old date-style deletes
  function shopGoneIn(item, now = Date.now()) {
    if (typeof item.del !== "number") return 0;
    return Math.max(1, Math.ceil((item.del + SHOP_DEL_MS - now) / 60000));
  }

  // Packs with this name (not deleted, not takeaway), any kind
  function timesBought(packs, name) {
    const key = name.toLowerCase();
    return packs.filter(p => p.status !== "deleted" && p.kind !== "takeaway" &&
      String(p.name).toLowerCase() === key).length;
  }

  // Packs that belong to one tab of "bought before"
  function inShopTab(p, tab) {
    if (p.status === "deleted" || p.kind === "takeaway") return false;
    if (tab === "main") return p.kind === "main";
    if (tab === "side") return p.kind === "side" && !!p.date;
    if (tab === "veg") return isVegPack(p);
    if (tab === "other") return p.kind === "misc";
    return false;
  }

  // Unique names for a tab, most bought first, then alphabetical
  function boughtBefore(packs, tab) {
    const seen = new Map(); // lower name -> { name, count }
    for (const p of packs) {
      if (!inShopTab(p, tab)) continue;
      const key = p.name.toLowerCase();
      if (!seen.has(key)) seen.set(key, { name: p.name, count: 0 });
      seen.get(key).count++;
    }
    return [...seen.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(e => e.name);
  }

  // Ideas for a tab: best rated first, then most bought. Unrated counts as 3; 1-2 stars = low
  function ideas(packs, ratings, tab) {
    const rows = boughtBefore(packs, tab).map(name => {
      const rating = ratings[name] ?? 3;
      return { name, count: timesBought(packs, name), rating, low: rating <= 2 };
    });
    return rows.sort((a, b) => b.rating - a.rating || b.count - a.count);
  }

  // A finished misc pack goes on the list with a reason; other kinds don't
  // Anything used goes on the shopping list; misc also when thrown away
  function autoOnFinish(pack, status) {
    if (pack.kind === "takeaway") return null;
    if (status === "used") return { name: pack.name, auto: "used up" };
    if (status === "thrown_away" && pack.kind === "misc") return { name: pack.name, auto: "thrown away" };
    return null;
  }

  // Misc packs 1 or 2 days out of date, not already on the list (deleted items don't count)
  function autoOutOfDate(packs, items, today) {
    const out = [];
    const seen = new Set();
    for (const p of packs) {
      if (p.status !== "in_fridge" || p.kind !== "misc" || !p.date) continue;
      const days = daysLeft(p.date, today);
      if (days !== -1 && days !== -2) continue;
      const key = p.name.toLowerCase();
      if (seen.has(key)) continue;
      if (items.some(i => i.name.toLowerCase() === key)) continue; // deleted items count too, so a delete sticks
      seen.add(key);
      out.push({ name: p.name, auto: days === -1 ? "1 day out" : "2 days out" });
    }
    return out;
  }

  // Meals v2: rolling days, "had this meal?", part used, takeaway cost
  // Today plus the next 6 days
  function mealDays(today) {
    return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(today, i));
  }

  // A plan still waiting to be marked: a fridge pack, or a takeaway not yet done
  function isWaitingPlan(p) {
    return !!p.plannedFor && (p.status === "in_fridge" || (p.kind === "takeaway" && p.status === "plan"));
  }

  // From this hour, today's waiting plan is asked "Had this meal?" too
  const TONIGHT_HOUR = 17;

  // Days 1-3 ago that still have a waiting plan, and today's once it is TONIGHT_HOUR (oldest first)
  function pastToAsk(packs, today, hour) {
    const days = new Set();
    for (const p of packs) {
      if (!isWaitingPlan(p)) continue;
      const left = daysLeft(p.plannedFor, today);
      if (left >= -3 && left <= -1) days.add(p.plannedFor);
      if (left === 0 && hour != null && hour >= TONIGHT_HOUR) days.add(p.plannedFor);
    }
    return [...days].sort();
  }

  // Waiting plans more than 3 days old: these drop off
  function expiredPlans(packs, today) {
    return packs.filter(p => isWaitingPlan(p) && daysLeft(p.plannedFor, today) < -3);
  }

  // Part used: back in the fridge, unplanned, with a 3-day timer (or its own sooner date)
  function partUse(pack, today) {
    const threeDays = addDays(today, 3);
    return {
      ...pack,
      status: "in_fridge",
      partUsed: true,
      plannedFor: null,
      slot: null,
      date: pack.date && pack.date < threeDays ? pack.date : threeDays,
      dateType: pack.dateType || "use_by"
    };
  }

  // What was eaten on a day (for the meals history)
  function mealRecord(day, packs, { takeaway = false, cost = null } = {}) {
    return {
      day,
      items: packs.map(p => ({ name: p.name, slot: p.slot })),
      takeaway,
      cost: parsePrice(cost)
    };
  }

  // Takeaways this month: count, and total cost (unknown costs count as 0)
  function takeawaySummary(meals, today) {
    const month = today.slice(0, 7);
    const mine = meals.filter(m => m.takeaway === true && String(m.day).slice(0, 7) === month);
    const total = mine.reduce((sum, m) => sum + (typeof m.cost === "number" ? m.cost : 0), 0);
    return { count: mine.length, total: Math.round(total * 100) / 100 };
  }

  // Printable fridge sheet
  // "0910-1840" from today's ISO date and HH:MM
  function sheetCode(todayIso, hhmm) {
    return todayIso.slice(8, 10) + todayIso.slice(5, 7) + "-" + String(hhmm).replace(":", "");
  }

  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // "14 Oct" (day and month only)
  function dayMonth(iso) {
    const d = new Date(iso + "T00:00:00Z");
    return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
  }

  function packDateLabel(p) {
    if (!p.date) return `added ${dayMonth(p.added)}`;
    return p.dateType === "best_before" ? `BB ${dayMonth(p.date)}` : `UB ${dayMonth(p.date)}`;
  }

  // Dated packs soonest first (then id), then undated packs oldest added first (then id)
  function sheetOrder(a, b) {
    if (a.date && b.date) return a.date.localeCompare(b.date) || byId(a, b);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.added.localeCompare(b.added) || byId(a, b);
  }

  function printSheet(packs, today, { rows = 26 } = {}) {
    const inFridge = (packs || []).filter(p => p.status === "in_fridge" && p.kind !== "takeaway");
    const soonPacks = useSoon(inFridge, today);
    const soonIds = new Set(soonPacks.map(p => p.id));

    const sectionDefs = [
      { key: "soon", title: "⚠️ USE SOON", packs: soonPacks },
      { key: "main", title: "🍖 MAINS", packs: [] },
      { key: "side", title: "🍚 SIDES", packs: [] },
      { key: "veg", title: "🥦 VEG", packs: [] },
      { key: "misc", title: "🧀 MISC", packs: [] }
    ];
    const byKey = Object.fromEntries(sectionDefs.map(s => [s.key, s]));
    for (const p of inFridge) {
      if (soonIds.has(p.id)) continue;
      // The print sheet has no cupboard section, so cupboard packs are left off it
      if (byKey[p.kind]) byKey[p.kind].packs.push(p);
    }
    for (const s of sectionDefs) s.packs.sort(sheetOrder);

    // Fit one column: each header costs 1 slot, the rest go round-robin, then
    // sections with packs left over give back 1 row for their "+N more" line
    function fitColumn(defs) {
      const active = defs.filter(s => s.packs.length > 0);
      const sections = active.map(s => ({ ...s, shown: 0 }));
      let free = rows - sections.length;
      let progress = true;
      while (free > 0 && progress) {
        progress = false;
        for (const s of sections) {
          if (free > 0 && s.shown < s.packs.length) {
            s.shown++;
            free--;
            progress = true;
          }
        }
      }
      return sections.map(s => {
        const partial = s.shown < s.packs.length;
        const count = partial && s.shown > 0 ? s.shown - 1 : s.shown;
        return {
          key: s.key,
          title: s.title,
          rows: s.packs.slice(0, count).map(p => ({ id: p.id, name: p.name, date: packDateLabel(p) })),
          more: s.packs.length - count
        };
      });
    }

    const left = fitColumn([byKey.soon, byKey.main]);
    const right = fitColumn([byKey.side, byKey.veg, byKey.misc]);

    let no = 0;
    for (const sec of [...left, ...right]) {
      sec.rows = sec.rows.map(r => ({ no: String(++no).padStart(2, "0"), ...r }));
    }

    const shown = no;
    const total = inFridge.length;

    // The 7 days after today, like "Mon 12"
    const days = [];
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, i);
      days.push(formatDate(d).split(" ").slice(0, 2).join(" "));
    }

    return { left, right, days, total, shown };
  }

  // Photo of the printed sheet: which mark wins for one row.
  // U beats P, B beats P, U + B together asks the user to pick.
  function resolveMark(m) {
    if (!m) return null;
    if (m.u && m.b) return "ask";
    if (m.u) return "u";
    if (m.b) return "b";
    if (m.p) return "p";
    return null;
  }

  // Changes found on a sheet photo: every marked row. Food already used / binned / frozen /
  // deleted on a phone since printing comes back as done (nothing to apply).
  function sheetChanges(rows, marks, packs) {
    const byId = new Map((packs || []).map(p => [p.id, p]));
    const out = [];
    for (const row of rows || []) {
      const pack = byId.get(row.id);
      const m = (marks || {})[row.no];
      const mark = resolveMark(m);
      const need = !!(m && m.n);
      if (!mark && !need) continue;
      const gone = !pack || pack.status !== "in_fridge";
      const partAlready = !gone && pack.partUsed && mark === "p" && !need;
      if (gone || partAlready) {
        out.push({ no: row.no, id: row.id, name: row.name, mark, need, done: true, note: "already done" });
        continue;
      }
      let note = "";
      if (mark === "ask") note = "U and B both marked · pick one";
      else if (m.u && m.p && !m.b) note = "U and P both marked → Used";
      out.push({ no: row.no, id: row.id, name: row.name, mark, need, note });
    }
    return out;
  }

  // V2 step 5: sync sign on the Today line
  function syncLabel({ online, waiting }) {
    const sign = online ? "✅ synced" : "📴 offline";
    if (waiting > 0) return online ? `⏳ ${waiting} waiting` : `${sign} · ${waiting} waiting`;
    return sign;
  }

  // V2 step 5: undo is refused when another phone changed (or removed) an item since
  const UNDO_BLOCKED_MSG = "Changed on another phone, can't undo";

  function undoBlocked(ids, current, uid) {
    if (!uid) return false;
    return ids.some(id => {
      const pack = current[id];
      if (!pack) return true;
      return !!pack.updatedBy && pack.updatedBy !== uid;
    });
  }

  // 🔔 What the other people did (step 7c). Only real news: no deletes, edits or plans.
  const SHOP_VERB = "added to the shopping list";
  const MERGE_MS = 10 * 60 * 1000;
  // A backup is kept in the 🔔 list too, so both phones know when the last one was
  const BACKUP_VERB = "backed up";
  const NO_MERGE = ["had", "had a takeaway", BACKUP_VERB];

  // "A", "A and B", "A, B and C"
  function joinNames(names) {
    if (names.length <= 1) return names.join("");
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  // What one change means in words ({verb, name}), or null when it is not news
  function activityChange(list, before, after) {
    if (list === "packs") {
      if (!after || after.kind === "takeaway") return null;
      const name = after.name;
      const was = before ? before.status : null;
      const now = after.status;
      if (!before) return now === "in_fridge" || now === "frozen" ? { verb: "added", name } : null;
      if (was === "deleted" || now === "deleted") return null;
      if (!before.partUsed && after.partUsed && now === "in_fridge") return { verb: "used some of", name };
      if (was === now) return null;
      if (now === "used") return { verb: "used", name };
      if (now === "thrown_away") return { verb: "threw away", name };
      if (now === "frozen") return { verb: "froze", name };
      if (was === "frozen" && now === "in_fridge") return { verb: "defrosted", name };
      if ((was === "used" || was === "thrown_away") && now === "in_fridge") return { verb: "put back", name };
      return null;
    }
    if (list === "shop") {
      // Added by hand only: automatic adds (auto set) and ticks are not news
      if (before || !after || after.auto) return null;
      return { verb: SHOP_VERB, name: after.name };
    }
    if (list === "meals") {
      if (before || !after) return null;
      if (after.takeaway === true) return { verb: "had a takeaway", name: "" };
      const names = (after.items || []).map(i => i.name);
      if (names.length === 0) return null;
      return { verb: "had", name: joinNames(names) };
    }
    return null;
  }

  // The 🔔 list: other people's changes, newest first. Same person, same thing,
  // within 10 minutes of each other = one line.
  function activityFeed(entries, me) {
    const sorted = (entries || []).filter(e => e.by !== me).sort((a, b) => b.at - a.at);
    const groups = [];
    let lastAt = 0;
    for (const e of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.by === e.by && last.verb === e.verb && !NO_MERGE.includes(e.verb) && lastAt - e.at <= MERGE_MS) {
        last.names.push(e.name);
      } else {
        groups.push({ by: e.by, verb: e.verb, names: [e.name], at: e.at });
      }
      lastAt = e.at;
    }
    return groups;
  }

  // One line of the 🔔 list, e.g. "Sarah used Leeks and Mince"
  function activityText(group, whoName) {
    const who = whoName || "Someone";
    const list = joinNames(group.names.filter(n => n));
    if (group.verb === SHOP_VERB) return `${who} added ${list} to the shopping list`;
    return [who, group.verb, list].filter(Boolean).join(" ");
  }

  // "just now", "5 min ago", "2 h ago", "yesterday", "3 days ago"
  function timeAgo(at, now) {
    const min = Math.floor((now - at) / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h ago`;
    if (h < 48) return "yesterday";
    return `${Math.floor(h / 24)} days ago`;
  }

  // Lines from other people newer than "seen up to" (ms)
  function unreadCount(entries, me, seenAt) {
    return activityFeed(entries, me).filter(g => g.at > seenAt).length;
  }

  // V2 step 9: backups. The file is plain JSON with every list in it.
  const BACKUP_APP = "food-tracker-v2";
  const BACKUP_LISTS = ["packs", "shop", "meals", "sheets", "ratings", "recipes", "mealPlans"];
  const NOT_BACKUP = "This isn't a Food Tracker backup file.";
  const BACKUP_EVERY = 5;

  // The backup file: { name, text }
  function backupFile(data, today, madeIso) {
    const body = { app: BACKUP_APP, made: madeIso };
    for (const k of BACKUP_LISTS) body[k] = data[k] || [];
    return { name: `food-backup-${today}.json`, text: JSON.stringify(body, null, 2) };
  }

  // { ok, data } for a good file, or { ok: false, reason } for anything else
  function readBackup(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, reason: NOT_BACKUP };
    }
    if (!data || typeof data !== "object" || data.app !== BACKUP_APP) return { ok: false, reason: NOT_BACKUP };
    const out = { made: data.made };
    for (const k of BACKUP_LISTS) {
      if (data[k] == null) out[k] = [];
      else if (Array.isArray(data[k])) out[k] = data[k];
      else return { ok: false, reason: NOT_BACKUP };
    }
    return { ok: true, data: out };
  }

  // What a restore does to each list: put every saved item back, remove the ones not in the backup
  function restorePlan(current, backup) {
    const plan = {};
    for (const k of BACKUP_LISTS) {
      const put = backup[k] || [];
      // Ratings have no id (they are kept by name), so nothing is removed for them
      if (k === "ratings") {
        plan[k] = { put, remove: [] };
        continue;
      }
      const keep = new Set(put.map(item => item.id));
      const remove = (current[k] || []).filter(item => !keep.has(item.id)).map(item => item.id);
      plan[k] = { put, remove };
    }
    return plan;
  }

  // How many changes (from both phones) happened after the last backup
  function changesSinceBackup(entries, lastBackup) {
    return (entries || []).filter(e => e.verb !== BACKUP_VERB && e.at > (lastBackup || 0)).length;
  }

  // When the last backup was made: the newest "backed up" entry (ms, or null)
  function lastBackupFrom(entries) {
    let last = null;
    for (const e of entries || []) {
      if (e.verb === BACKUP_VERB && (last === null || e.at > last)) last = e.at;
    }
    return last;
  }

  // Ask at 5 changes. After a "No", ask again 5 changes later (until the next backup).
  function backupDue(count, snooze, lastBackup) {
    if (snooze && snooze.lastBackup === lastBackup) return count >= snooze.count + BACKUP_EVERY;
    return count >= BACKUP_EVERY;
  }

  // "Sun 11 Oct" for the local day of a time in ms
  function dayLabel(ms) {
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, "0");
    return formatDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }

  // The Settings line
  function lastBackupLabel(ms) {
    if (!ms) return "Never backed up";
    const d = new Date(ms);
    const hhmm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    return `Last backup: ${dayLabel(ms)}, ${hhmm}`;
  }

  // Meals (V3): a name, fresh foods (checked against the fridge; each can be "some") and other items
  // (cupboard bits, never in the fridge). Saved in the "recipes" list.
  // Tidy what was typed: single spaces, trimmed, capital first letter. "" when blank.
  function tidyName(s) {
    const t = String(s ?? "").replace(/\s+/g, " ").trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  }

  // Case-insensitive key for a name
  function keyOf(s) {
    return String(s ?? "").trim().toLowerCase();
  }

  // A fresh food as { name, some } (a plain name is an old saved food: not "some")
  function normFresh(f) {
    if (f && typeof f === "object") return { name: String(f.name ?? "").trim(), some: !!f.some };
    return { name: String(f ?? "").trim(), some: false };
  }

  // Any saved meal in the current shape (old ones kept fresh as plain names). null for none.
  function normMeal(r) {
    if (!r) return null;
    return {
      id: r.id,
      name: String(r.name ?? "").trim(),
      fresh: (r.fresh || []).map(normFresh).filter(f => f.name),
      other: (r.other || [])
        .map(o => ({ name: String(o?.name ?? "").trim(), qty: String(o?.qty ?? "").trim() || null }))
        .filter(o => o.name)
    };
  }

  // Check and tidy a meal being saved: { meal } or { error } for the message to show
  function makeMeal(input, meals) {
    const src = input || {};
    const name = tidyName(src.name);
    if (!name) return { error: "Give the meal a name." };

    const fresh = [];
    const seen = new Set();
    for (const raw of src.fresh || []) {
      const f = normFresh(raw);
      const n = tidyName(f.name);
      if (!n || seen.has(keyOf(n))) continue;
      seen.add(keyOf(n));
      fresh.push({ name: n, some: f.some });
    }

    const other = [];
    for (const o of src.other || []) {
      const n = tidyName(o?.name);
      if (!n) continue;
      other.push({ name: n, qty: String(o.qty ?? "").trim() || null });
    }

    if (!fresh.length && !other.length) return { error: "Add at least one food." };

    const hasId = src.id !== undefined && src.id !== null && src.id !== "";
    const dup = (meals || []).find(m =>
      !(hasId && String(m.id) === String(src.id)) && keyOf(tidyName(m.name)) === keyOf(name));
    if (dup) return { error: `You already have ${tidyName(dup.name)}.` };

    const meal = {};
    if (hasId) meal.id = src.id;
    meal.name = name;
    meal.fresh = fresh;
    meal.other = other;
    return { meal };
  }

  // The name to offer as "+ Add new": null when blank or already among the suggestions (any case)
  function newFoodName(typed, suggestions) {
    const t = tidyName(typed);
    if (!t) return null;
    const taken = (suggestions || []).some(s => keyOf(s?.name ?? s) === keyOf(t));
    return taken ? null : t;
  }

  // Shelf slot for a planned pack: its kind when it is a meal slot, else side
  function slotFor(kind) {
    return ["main", "side", "veg", "misc"].includes(kind) ? kind : "side";
  }

  // Free = in the fridge, not planned, not a takeaway
  function isFree(p) {
    return p.status === "in_fridge" && !p.plannedFor && p.kind !== "takeaway";
  }

  // Foods (names, in order) matched to the soonest free pack each, one pack per food.
  // Returns { picks: [{ name, pack }], missing: [names with no free pack] }. Input not changed.
  function pickFoods(names, packs) {
    const used = new Set();
    const picks = [];
    const missing = [];
    for (const name of names) {
      const key = keyOf(name);
      const free = packs
        .filter(p => isFree(p) && !used.has(p.id) && keyOf(p.name) === key)
        .sort((a, b) => {
          if (a.date && b.date) return a.date.localeCompare(b.date) || byId(a, b);
          if (a.date) return -1;
          if (b.date) return 1;
          return byId(a, b);
        });
      if (!free.length) {
        missing.push(name);
        continue;
      }
      used.add(free[0].id);
      picks.push({ name, pack: free[0] });
    }
    return { picks, missing };
  }

  // New planned pack objects for a meal on a day: the soonest free pack per fresh food, not skipped
  function planMeal(meal, packs, dayIso, planId, skip = []) {
    const m = normMeal(meal) || { fresh: [] };
    const skipKeys = new Set((skip || []).map(keyOf));
    const names = m.fresh.map(f => f.name).filter(n => !skipKeys.has(keyOf(n)));
    const { picks } = pickFoods(names, packs || []);
    return picks.map(({ pack }) => ({
      ...pack, plannedFor: dayIso, slot: slotFor(pack.kind), mealPlanId: planId
    }));
  }

  // Keep a meal plan in step with its meal and the fridge: unplan what is no longer wanted (or
  // doubled), and plan the wanted foods that have a free pack now (e.g. bought since)
  function syncMealPlan(plan, meal, packs, today) {
    const m = normMeal(meal);
    if (!plan || plan.day < today || !m) return { plan: [], unplan: [] };
    const skipKeys = new Set((plan.skip || []).map(keyOf));
    const wanted = m.fresh.map(f => f.name).filter(n => !skipKeys.has(keyOf(n)));
    const wantedKeys = new Set(wanted.map(keyOf));

    const current = (packs || []).filter(p => p.mealPlanId === plan.id && p.status === "in_fridge");
    const kept = new Set();
    const unplan = [];
    for (const p of current) {
      const key = keyOf(p.name);
      if (!wantedKeys.has(key) || kept.has(key)) unplan.push(unplanPack(p));
      else kept.add(key);
    }

    const missing = wanted.filter(n => !kept.has(keyOf(n)));
    const planned = planMeal({ fresh: missing.map(name => ({ name })) }, packs, plan.day, plan.id);
    return { plan: planned, unplan };
  }

  // What a meal plan's day shows: each fresh food with its pack (or none), skipped and out-of-date
  // flags, the foods still missing, and the other items. null when the meal is gone.
  function mealPlanView(plan, meal, packs) {
    const m = normMeal(meal);
    if (!m) return null;
    const skipKeys = new Set((plan.skip || []).map(keyOf));
    const foods = m.fresh.map(f => {
      const pack = (packs || []).find(p =>
        p.mealPlanId === plan.id && p.status === "in_fridge" && keyOf(p.name) === keyOf(f.name)) || null;
      return {
        name: f.name,
        some: f.some,
        pack,
        skipped: skipKeys.has(keyOf(f.name)),
        out: pack ? outByDay(pack, plan.day) : 0
      };
    });
    const missing = foods.filter(f => !f.pack && !f.skipped).map(f => f.name);
    return {
      id: m.id,
      plan,
      name: m.name,
      foods,
      missing,
      other: m.other,
      warn: missing.length > 0 || foods.some(f => f.out > 0)
    };
  }

  // Names to buy for a meal: missing fresh foods, then other items with their amount
  function mealShopNames(view) {
    return [...view.missing, ...view.other.map(o => o.qty ? o.name + " " + o.qty : o.name)];
  }

  // Meal groups for a day (one per meal plan whose meal exists, in plan order), then single foods
  // that are not part of one of those groups
  function dayGroups(packs, mealPlans, meals, dayIso) {
    const day = dayIso;
    const groups = [];
    const planIds = new Set();
    for (const plan of (mealPlans || []).filter(pl => pl.day === day)) {
      const meal = (meals || []).find(m => String(m.id) === String(plan.mealId));
      if (!meal) continue;
      planIds.add(plan.id);
      groups.push({ type: "meal", plan, view: mealPlanView(plan, meal, packs) });
    }
    const singles = dayMeals(packs, day)
      .filter(p => !(p.mealPlanId != null && planIds.has(p.mealPlanId)))
      .map(p => ({ type: "pack", pack: p }));
    return [...groups, ...singles];
  }

  // A meal's status on My meals: planned days from today on, else the fresh foods with no free pack
  function mealStatus(meal, mealPlans, packs, today) {
    const planned = [...new Set((mealPlans || [])
      .filter(pl => String(pl.mealId) === String(meal.id) && pl.day >= today)
      .map(pl => pl.day))].sort();
    if (planned.length) return { planned, need: [] };
    const m = normMeal(meal) || { fresh: [] };
    const { missing } = pickFoods(m.fresh.map(f => f.name), packs || []);
    return { planned: [], need: missing };
  }

  // Pack ids of the day's "some" foods (they start as part used on "How much did you use?")
  function partDefaults(packs, mealPlans, meals, dayIso) {
    const out = new Set();
    for (const p of packs || []) {
      if (p.plannedFor !== dayIso || p.mealPlanId == null) continue;
      const plan = (mealPlans || []).find(pl => String(pl.id) === String(p.mealPlanId));
      if (!plan) continue;
      const meal = normMeal((meals || []).find(m => String(m.id) === String(plan.mealId)));
      if (!meal) continue;
      if (meal.fresh.some(f => f.some && keyOf(f.name) === keyOf(p.name))) out.add(p.id);
    }
    return out;
  }

  // Meal plans more than 3 days old: these drop off
  function expiredMealPlans(mealPlans, today) {
    return (mealPlans || []).filter(pl => daysLeft(pl.day, today) < -3);
  }

  // Names (first spelling, no repeats) not already to get on the shopping list
  function recipeShopList(names, shopItems) {
    const onList = new Set((shopItems || [])
      .filter(i => !i.got && !i.del)
      .map(i => String(i.name ?? "").trim().toLowerCase()));
    const seen = new Set();
    const out = [];
    for (const n of names || []) {
      const t = String(n ?? "").trim();
      const key = t.toLowerCase();
      if (!t || seen.has(key) || onList.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  // Ideas & feedback (Settings): one note, cleaned. Blank text = null (nothing to save).
  // Type is "problem" or "idea"; anything else is an idea.
  function makeFeedback(text, type, { by, name, version, at } = {}) {
    const clean = String(text ?? "").trim();
    if (!clean) return null;
    return { text: clean, type: type === "problem" ? "problem" : "idea", by: by ?? null, name: name ?? null, version: version ?? null, at: at ?? null };
  }

  // One plain list to paste into a Claude chat, newest first
  function feedbackText(items, version) {
    if (!items || items.length === 0) return "";
    const sorted = [...items].sort((a, b) => b.at - a.at);
    const count = sorted.length === 1 ? "1 note" : `${sorted.length} notes`;
    const lines = [`Food Tracker ideas & feedback (app ${version}), ${count}:`];
    for (const f of sorted) {
      const kind = f.type === "problem" ? "Problem" : "Idea";
      const when = f.at ? dayLabel(f.at) : "";
      const who = [when, f.name, f.version].filter(Boolean).join(", ");
      const text = String(f.text).replace(/\s*\n\s*/g, " ");
      lines.push(who ? `- ${kind}: ${text} (${who})` : `- ${kind}: ${text}`);
    }
    return lines.join("\n");
  }

  // Export
  const FT = {
    shopMatches,
    shopMerge,
    shopLabel,
    foldShopRepeats,
    searchPacks,
    addedToday,
    dateTag,
    addDays,
    daysLeft,
    formatDate,
    parseDDMM,
    parseDays,
    countdown,
    colour,
    ageLabel,
    isOld,
    makePacks,
    editPack,
    markUsed,
    markThrown,
    freeze,
    defrost,
    markDeleted,
    deletedList,
    expiredDeletes,
    cards,
    fridgeView,
    useSoon,
    freezeAge,
    freezerList,
    usedSummary,
    STARTERS,
    KINDS,
    kindLabel,
    sheetLine,
    usuals,
    rememberedNoDate,
    rememberedKind,
    searchFoods,
    suggestFoods,
    boughtCount,
    quickFillRow,
    parseQuickFill,
    CLAUDE_PROMPT,
    weekDays,
    mealPick,
    planPack,
    unplanPack,
    outByDay,
    makeTakeaway,
    dayMeals,
    dayGroups,
    mealIdeas,
    tidyName,
    normMeal,
    makeMeal,
    newFoodName,
    planMeal,
    syncMealPlan,
    mealPlanView,
    mealShopNames,
    mealStatus,
    partDefaults,
    expiredMealPlans,
    recipeShopList,
    shopOrder,
    expiredShopDeletes,
    shopGoneIn,
    timesBought,
    boughtBefore,
    ideas,
    autoOnFinish,
    autoOutOfDate,
    mealDays,
    TONIGHT_HOUR,
    pastToAsk,
    expiredPlans,
    partUse,
    mealRecord,
    takeawaySummary,
    sheetCode,
    printSheet,
    resolveMark,
    sheetChanges,
    syncLabel,
    UNDO_BLOCKED_MSG,
    undoBlocked,
    activityChange,
    activityFeed,
    activityText,
    timeAgo,
    unreadCount,
    BACKUP_EVERY,
    backupFile,
    readBackup,
    restorePlan,
    changesSinceBackup,
    lastBackupFrom,
    BACKUP_VERB,
    backupDue,
    dayLabel,
    lastBackupLabel,
    makeFeedback,
    feedbackText
  };

  if (typeof module !== "undefined") {
    module.exports = FT;
  } else {
    window.FT = FT;
  }
})();
