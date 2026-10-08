(function() {
  // Constants
  const STARTERS = {
    main: ["Chicken", "Mince", "Sausages", "Gammon"],
    side: ["Dauphinoise potatoes", "Cauliflower cheese", "Roast potatoes", "Potatoes", "Jacket potatoes", "Carrots", "Broccoli", "Sweetcorn cobs"],
    misc: ["Milk", "Eggs", "Margarine", "Butter"]
  };

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
    const { name, kind, date, dateType, count, toFreezer } = spec;

    // Validation
    if (!name || !name.trim()) throw new Error("Empty name");
    if ((kind === "main" || kind === "misc") && !date) throw new Error(`${kind} needs a date`);

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
        frozen: toFreezer ? today : null
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

  function fridgeView(packs, today) {
    // Mains: use cards
    const mains = cards(packs, "main");

    // Sides: use cards
    const allSides = cards(packs, "side");
    const sides = allSides;

    // Misc: in-fridge with date, daysLeft < 7, sorted by date
    const misc = packs
      .filter(p => p.status === "in_fridge" && p.kind === "misc" && p.date && daysLeft(p.date, today) < 7)
      .sort((a, b) => a.date.localeCompare(b.date));

    // Misc OK: count of other in-fridge misc packs (no date or date >= 7 days away)
    const miscOk = packs
      .filter(p => p.status === "in_fridge" && p.kind === "misc" && (!p.date || daysLeft(p.date, today) >= 7))
      .length;

    // Veg: in-fridge with no date, sorted by added oldest first
    const veg = packs
      .filter(p => p.status === "in_fridge" && !p.date && (p.kind === "side" || p.kind === "main"))
      .sort((a, b) => a.added.localeCompare(b.added));

    // Actually, looking at the test, veg should be for undated side packs
    const vegFixed = packs
      .filter(p => p.status === "in_fridge" && p.kind === "side" && !p.date)
      .sort((a, b) => a.added.localeCompare(b.added));

    // Count mains: in-fridge dated mains
    const mainCount = packs.filter(p => p.status === "in_fridge" && p.kind === "main" && p.date).length;

    // Count sides: in-fridge sides (dated + undated)
    const sideCount = packs.filter(p => p.status === "in_fridge" && p.kind === "side").length;

    return {
      mains,
      sides,
      misc,
      miscOk,
      veg: vegFixed,
      mainCount,
      sideCount
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
    "- Read each food item and its use-by or best-before date from the photos.",
    "- For each item choose a kind: \"main\" (meat, fish or a main meal), \"side\" (sides and veg), or \"misc\" (milk, eggs, butter, sauces etc).",
    "- If you are unsure of the kind, or can't read a date clearly, ASK me before giving the JSON. Never guess a date.",
    "- Write dates as YYYY-MM-DD. Veg with no date: use null.",
    "- If the same item has several packs with the same date, make one row with \"packs\".",
    "- Reply with only a JSON array in a ```json block, like this:",
    "[{\"name\":\"Sausages\",\"kind\":\"main\",\"date\":\"2026-10-10\",\"dateType\":\"use_by\",\"packs\":2},{\"name\":\"Carrots\",\"kind\":\"side\",\"date\":null}]",
    "Keep it short and plain English."
  ].join("\n");

  function isRealDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d) && d.toISOString().split("T")[0] === s;
  }

  function quickFillRow(row) {
    const r = row || {};
    const rawName = String(r.name ?? "").trim();
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);

    let kind = String(r.kind ?? "").trim().toLowerCase();
    if (kind === "veg" || kind === "vegetable") kind = "side";

    const hasDate = r.date !== null && r.date !== undefined && String(r.date).trim() !== "";
    const date = hasDate ? String(r.date).trim() : null;
    const dateType = hasDate ? (r.dateType === "best_before" ? "best_before" : "use_by") : null;

    const count = Math.min(20, Math.max(1, parseInt(r.packs ?? r.count ?? 1, 10) || 1));
    const toFreezer = r.freezer === true || r.toFreezer === true;

    let problem = null;
    if (!name) problem = "Needs a name";
    else if (!["main", "side", "misc"].includes(kind)) problem = "Kind must be main, side or misc";
    else if (hasDate && !isRealDate(date)) problem = "Date must look like 2026-10-10";
    else if ((kind === "main" || kind === "misc") && !hasDate) problem = "Needs a date";

    return { name, kind, date, dateType, count, toFreezer, ok: problem === null, problem };
  }

  function parseQuickFill(text, today) {
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

    return { error: null, items: list.map(quickFillRow) };
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
  function mealPick(packs, slot) {
    const free = packs.filter(p =>
      p.status === "in_fridge" && !p.plannedFor && p.kind !== "misc" && p.kind !== "takeaway" &&
      (slot === "veg" ? p.kind === "side" && !p.date : p.kind === slot && !!p.date)
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
    freezeAge,
    freezerList,
    usedSummary,
    STARTERS,
    usuals,
    parseQuickFill,
    CLAUDE_PROMPT,
    weekDays,
    mealPick,
    planPack,
    unplanPack,
    outByDay,
    makeTakeaway,
    dayMeals
  };

  if (typeof module !== "undefined") {
    module.exports = FT;
  } else {
    window.FT = FT;
  }
})();
