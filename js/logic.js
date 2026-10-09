(function() {
  // Constants
  const STARTERS = {
    main: ["Chicken", "Mince", "Sausages", "Gammon"],
    side: ["Dauphinoise potatoes", "Cauliflower cheese", "Roast potatoes", "Jacket potatoes", "Sweetcorn cobs"],
    veg: ["Carrots", "Onions", "Broccoli", "Peppers", "Mushrooms", "Leeks", "Cabbage", "Potatoes"],
    misc: ["Milk", "Eggs", "Margarine", "Butter"]
  };
  const KINDS = ["main", "side", "veg", "misc"];

  // Date utilities
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
    const { name, kind, date, dateType, count, toFreezer, noDate, sub, price } = spec;

    // Validation
    if (!name || !name.trim()) throw new Error("Empty name");
    if ((kind === "main" || kind === "misc") && !date && !noDate) throw new Error(`${kind} needs a date`);

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

  // Delete (a mistake): not saved as used or wasted. Kept for Undo until yesterday.
  function markDeleted(pack, today) {
    return { ...pack, status: "deleted", del: today };
  }

  // Deleted today or yesterday: shown in the Fridge list with Undo
  function deletedList(packs, today) {
    return packs
      .filter(p => p.status === "deleted" && daysLeft(p.del, today) >= -1)
      .sort((a, b) => b.del.localeCompare(a.del));
  }

  // Deleted before yesterday: remove from the database for good
  function expiredDeletes(packs, today) {
    return packs.filter(p => p.status === "deleted" && daysLeft(p.del, today) < -1);
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
      return a.id - b.id; // stable sort by id
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

    const countKind = kind => inFridge.filter(p => p.kind === kind).length;

    return {
      mains,
      mainsNoDate,
      sides,
      sidesNoDate,
      veg,
      misc,
      mainCount: countKind("main"),
      sideCount: countKind("side"),
      vegCount: countKind("veg"),
      miscCount: countKind("misc")
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
    const noDate = forcedNoDate || (!hasDate && (r.noDate === true || kind === "side"));

    const count = Math.min(20, Math.max(1, parseInt(r.packs ?? r.count ?? 1, 10) || 1));
    const toFreezer = r.freezer === true || r.toFreezer === true;

    let problem = null;
    if (!name) problem = "Needs a name";
    else if (needsKind) problem = "Pick a kind";
    else if (!KINDS.includes(kind)) problem = "Kind must be main, side, veg or misc";
    else if (hasDate && !isRealDate(date)) problem = "Date must look like 2026-10-10";
    else if (!hasDate && !noDate) problem = "Needs a date";

    return {
      name, sub, price, kind, date, dateType, count, toFreezer, noDate,
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
  const SLOT_ORDER = { main: 0, side: 1, veg: 2 };

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

  function mealPick(packs, slot) {
    const free = packs.filter(p =>
      p.status === "in_fridge" && !p.plannedFor && p.kind !== "misc" && p.kind !== "takeaway" &&
      (slot === "veg" ? isVegPack(p) : p.kind === slot && !!p.date)
    );

    const sortKey = p => (slot === "veg" ? p.added : p.date);
    const byKey = (a, b) => sortKey(a).localeCompare(sortKey(b)) || a.id - b.id;

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
    return { ...pack, plannedFor: null, slot: null };
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
    return b.added.localeCompare(a.added) || b.id - a.id;
  }

  function shopOrder(items, today) {
    const toGet = items.filter(i => !i.got && !i.del).sort(byNewest);
    const got = items.filter(i => i.got && !i.del).sort(byNewest);
    const gone = items.filter(i => i.del && daysLeft(i.del, today) >= -1).sort(byNewest);
    return [...toGet, ...got, ...gone];
  }

  // Deleted before yesterday: remove from the database for good
  function expiredShopDeletes(items, today) {
    return items.filter(i => i.del && daysLeft(i.del, today) < -1);
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

  // Days 1-3 ago that still have a waiting plan (oldest first)
  function pastToAsk(packs, today) {
    const days = new Set();
    for (const p of packs) {
      if (!isWaitingPlan(p)) continue;
      const left = daysLeft(p.plannedFor, today);
      if (left >= -3 && left <= -1) days.add(p.plannedFor);
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

  // Export
  const FT = {
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
    usuals,
    rememberedNoDate,
    rememberedKind,
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
    mealIdeas,
    shopOrder,
    expiredShopDeletes,
    timesBought,
    boughtBefore,
    ideas,
    autoOnFinish,
    autoOutOfDate,
    mealDays,
    pastToAsk,
    expiredPlans,
    partUse,
    mealRecord,
    takeawaySummary
  };

  if (typeof module !== "undefined") {
    module.exports = FT;
  } else {
    window.FT = FT;
  }
})();
