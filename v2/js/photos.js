(function() {
  const WORKER_URL = "https://food-tracker-photos.df-ai-lab-hq.workers.dev";

  // Groups of n, in order: the Worker takes 5 photos a call
  function chunk(list, n) {
    const out = [];
    for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
  }

  // Longest side at most max, never bigger than the photo
  function fitSize(w, h, max) {
    const scale = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
  }

  // Gauge: "7/26", "about 38s left", percent with 1 decimal
  function gaugeText(done, total) {
    return `${done}/${total}`;
  }

  function gaugeLeft(done, total, avgMs) {
    if (done >= total) return "opening the list…";
    if (done === 0 || avgMs <= 0) return "starting…";
    const secs = Math.round((total - done) * avgMs / 1000);
    return `about ${secs}s left`;
  }

  function gaugePct(done, total) {
    if (!total) return 0;
    return Math.round(done / total * 1000) / 10;
  }

  // The photo pile: "1 photo ready", "Read 3 photos"
  function trayText(n) {
    return `${n} photo${n === 1 ? "" : "s"} ready`;
  }

  function readLabel(n) {
    return `Read ${n} photo${n === 1 ? "" : "s"}`;
  }

  // Step 2 while Claude reads: "Reading 3 photos…" (no counter)
  function readingText(n) {
    return `Reading ${n} photo${n === 1 ? "" : "s"}…`;
  }

  // Plain words for each Worker answer
  function errorText(status, body) {
    if (status === 0) return "Couldn't connect — check your internet and try again";
    if (status === 401) return "Please sign in again, then try once more";
    if (status === 403) return "These photos aren't linked to your household — sign in to the right one";
    if (status === 429) {
      const cap = body && body.week ? body.week.cap : null;
      return cap ? `You've used the ${cap} photos for this week — try again next week` : "Too many photos for now — try again later";
    }
    return "Something went wrong on our side — try again";
  }

  // Worker results -> Quick fill rows (the same shape Claude's JSON gives)
  function toQuickFill(results) {
    return (results || []).map(r => {
      const row = {
        name: r.name || "",
        sub: r.sub || null,
        date: r.date || null,
        bb: r.bb === true,
        price: r.price ?? null,
        packs: r.packs ?? 1,
        kind: r.kind || "",
        noDate: r.noDate === true,
        check: r.needsCheck === true,
      };
      if (r.failKey) row.failKey = r.failKey;
      return row;
    });
  }

  // The real date (or "none") for a kept photo, so the Worker can save it as a test case
  function fixFor(row, date) {
    if (!row || !row.failKey) return null;
    return { key: row.failKey, date: date || "none" };
  }

  // Fire and forget: true if the Worker saved it, false otherwise (never throws)
  async function sendFix(fix, opts) {
    try {
      const { fetch, getToken, household } = opts;
      const token = await getToken();
      const res = await fetch(WORKER_URL + "/fail-date", {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ household, key: fix.key, date: fix.date }),
      });
      return res.ok === true;
    } catch (e) {
      return false;
    }
  }

  // Send photos to the Worker 5 at a time, one batch after another
  async function scanAll(photos, opts) {
    const { fetch, getToken, household, names, today, onProgress } = opts;
    const results = [];
    let error = null, month = null, week = null, done = 0;

    for (const batch of chunk(photos, 5)) {
      let token;
      try {
        token = await getToken();
      } catch (e) {
        error = errorText(401);
        break;
      }

      let res, data = {};
      try {
        res = await fetch(WORKER_URL + "/scan", {
          method: "POST",
          headers: { authorization: "Bearer " + token, "content-type": "application/json" },
          body: JSON.stringify({ household, today, names, photos: batch.map(p => ({ id: p.id, jpeg: p.jpeg })) }),
        });
      } catch (e) {
        error = errorText(0);
        break;
      }
      try { data = await res.json(); } catch (e) { data = {}; }
      if (!res.ok) {
        error = errorText(res.status, data);
        break;
      }

      results.push(...(data.results || []));
      month = data.month || month;
      week = data.week || week;
      done += batch.length;
      if (onProgress) onProgress(done, photos.length);
    }
    return { results, error, month, week };
  }

  // Browser only: phone photo -> JPEG, longest side 1000 px, base64 (no data: prefix)
  async function shrink(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const s = fitSize(bmp.width, bmp.height, 1000);
    const canvas = document.createElement("canvas");
    canvas.width = s.w;
    canvas.height = s.h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, s.w, s.h);
    if (bmp.close) bmp.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("Couldn't make a JPEG");
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return url.slice(url.indexOf(",") + 1);
  }

  // Settings: the Worker's /usage numbers in words (cost in US dollars, like the Anthropic bill)
  function usageText(data) {
    if (!data) return null;
    const m = data.month;
    const cost = m && typeof m.cost === "number" ? m.cost : 0;
    const money = cost > 0 && cost < 0.005 ? "under $0.01" : `$${cost.toFixed(2)}`;
    const calls = (m && m.calls) || {};
    const parts = Object.entries(calls).filter(([, n]) => n > 0)
      .map(([model, n]) => `${/haiku/.test(model) ? "Haiku" : /sonnet/.test(model) ? "Sonnet" : model} ${n}`);
    const w = data.week || { used: 0, cap: 0 };
    return {
      month: `This month: ${money} · ${parts.length ? parts.join(" · ") : "no photos yet"}`,
      week: `This week: ${w.used} of ${w.cap} photos`,
    };
  }

  // Ask the Worker for this household's photo count and cost; null when it can't (never throws)
  async function fetchUsage({ fetch, getToken, household }) {
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER_URL}/usage?household=${encodeURIComponent(household)}`, {
        headers: { authorization: "Bearer " + token },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  const FT_PHOTOS = {
    WORKER_URL, chunk, fitSize, gaugeText, gaugeLeft, gaugePct,
    trayText, readLabel, readingText, errorText, toQuickFill, usageText, fetchUsage, fixFor, sendFix, scanAll, shrink
  };

  if (typeof module !== "undefined" && module.exports) module.exports = FT_PHOTOS;
  else window.FT_PHOTOS = FT_PHOTOS;
})();
