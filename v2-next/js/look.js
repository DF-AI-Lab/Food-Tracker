(function() {
  // Days from today to an ISO date (UTC, whole days)
  function daysLeft(iso, today) {
    const target = new Date(iso + "T00:00:00Z");
    const todayDate = new Date(today + "T00:00:00Z");
    return Math.floor((target - todayDate) / (1000 * 60 * 60 * 24));
  }

  // "2026-10-16" -> "Fri 16 Oct"
  function formatDate(iso) {
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = new Date(iso + "T00:00:00Z");
    return `${weekdays[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  }

  // Hex blend between two RGB colours
  const hex = n => Math.round(n).toString(16).padStart(2, "0");
  const blend = (a, b, t) => "#" + a.map((v, i) => hex(v + (b[i] - v) * t)).join("");

  // Freshness: 5-day countdown, min 5%, out of date = full
  function freshPct(d) {
    if (d < 0) return 100;
    return Math.min(100, Math.max(5, d * 20));
  }

  // Freshness state: 2 days or less = soon, past = out
  function freshState(date, today) {
    const d = daysLeft(date, today);
    if (d < 0) return "out";
    if (d <= 2) return "soon";
    return "ok";
  }

  // Row date words
  function whenParts(date, today) {
    const d = daysLeft(date, today);
    if (d < 0) {
      const n = -d;
      return { main: `${n} ${n === 1 ? "day" : "days"} out`, sub: "" };
    }
    if (d === 0) return { main: "Today", sub: "" };
    if (d === 1) return { main: "1 day", sub: "" };
    if (d === 2) return { main: "2 days", sub: "" };
    return { main: formatDate(date), sub: `${d} days` };
  }

  // Freezer age: full at 90 days, min 6%
  function freezerPct(daysFrozen) {
    return Math.min(100, Math.max(6, Math.round(daysFrozen / 90 * 100)));
  }

  // Freezer colour: light blue -> dark blue over 90 days
  function freezerColour(daysFrozen) {
    const t = Math.min(1, daysFrozen / 90);
    return blend([191, 227, 255], [47, 111, 168], t);
  }

  // "in 2 Sep · 5 wks" -> "Frozen 2 Sep · 5 wks"
  function frozenText(label) {
    return label.replace(/^in /, "Frozen ");
  }

  const WORDS = { "-": "out of date", 0: "today", 1: "tomorrow", 2: "in 2 days" };

  // Eat first: fridge packs due within 2 days, soonest first
  function eatFirst(packs, today) {
    const soon = packs
      .filter(p => p.status === "in_fridge" && p.date && daysLeft(p.date, today) <= 2)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const shown = soon.slice(0, 3);
    const lines = shown.map(p => {
      const d = daysLeft(p.date, today);
      const key = d < 0 ? "-" : d;
      return { id: p.id, name: p.name, word: WORDS[key], state: freshState(p.date, today) };
    });
    const more = Math.max(0, soon.length - shown.length);

    const planned = shown.filter(p => p.plannedFor === today);
    let sub = "";
    if (planned.length === shown.length && planned.length > 0) {
      sub = ["", "On tonight's plan", "Both on tonight's plan", "All on tonight's plan"][planned.length];
    } else if (planned.length > 0) {
      const names = planned.map(p => p.name).join(" and ");
      sub = `${names} ${planned.length >= 2 ? "are" : "is"} on tonight's plan`;
    }
    return { lines, more, sub };
  }

  // Sync status words (no emoji)
  function syncText({ online, waiting }) {
    if (!online) {
      return { text: waiting > 0 ? `Offline · ${waiting} waiting` : "Offline", state: "off" };
    }
    if (waiting > 0) return { text: `${waiting} waiting`, state: "wait" };
    return { text: "Synced", state: "ok" };
  }

  // Bell label for screen readers
  function bellLabel(n) {
    return n > 0 ? `Notifications, ${n} new` : "Notifications";
  }

  // Two-letter initials for member and household tiles
  function initials(name) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  const LOOK = {
    daysLeft, formatDate,
    freshPct, freshState, whenParts,
    freezerPct, freezerColour, frozenText,
    eatFirst, syncText, bellLabel, initials
  };

  if (typeof module !== "undefined" && module.exports) module.exports = LOOK;
  else window.LOOK = LOOK;
})();
