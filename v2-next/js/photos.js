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
    return (results || []).map(r => ({
      name: r.name || "",
      sub: r.sub || null,
      date: r.date || null,
      bb: r.bb === true,
      price: r.price ?? null,
      packs: r.packs ?? 1,
      kind: r.kind || "",
      noDate: r.noDate === true,
      check: r.needsCheck === true,
    }));
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

  const FT_PHOTOS = {
    WORKER_URL, chunk, fitSize, gaugeText, gaugeLeft, gaugePct,
    errorText, toQuickFill, scanAll, shrink
  };

  if (typeof module !== "undefined" && module.exports) module.exports = FT_PHOTOS;
  else window.FT_PHOTOS = FT_PHOTOS;
})();
