// Reads ✕ marks off a photo of the printed fridge sheet (no AI, no network).
// Works on a grayscale image: finds the 4 black corner squares, maps each
// U / P / B (and N) box from the saved sheet layout onto the photo, and checks for ink.
// Plain JS so it runs in the browser (window.FT_OMR) and in Node tests.
(function() {
  // Box positions relative to the 4 corner marks: (0,0) = top-left mark centre,
  // (1,1) = bottom-right mark centre. corners: { tl, tr, bl, br } as {x,y,w,h};
  // rows: [{ no, id, name, boxes: [{x,y,w,h} x3 or x4] }] -> boxes as [u, v, w, h].
  function layoutFromRects(corners, rows) {
    const c = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    const tl = c(corners.tl), tr = c(corners.tr), bl = c(corners.bl);
    const sx = tr.x - tl.x, sy = bl.y - tl.y;
    const round = n => Math.round(n * 1e5) / 1e5;
    return rows.map(row => ({
      ...row,
      boxes: row.boxes.map(b => [round((b.x - tl.x) / sx), round((b.y - tl.y) / sy), round(b.w / sx), round(b.h / sy)])
    }));
  }

  // Tuning knobs (see the notes in readSheet).
  const C = 18;           // how much darker than its neighbourhood a pixel must be to count as ink
  const SHRINK = 0.25;    // skip this fraction of each box edge (the printed border)
  const GRID = 24;        // sample points per box side
  const THRESHOLD = 0.06; // share of ink samples needed to call a box marked (empty boxes score 0, marked >= ~0.11)

  // Ink mask: a pixel is ink when it is darker than the mean of its neighbourhood
  // by at least C. This copes with shadows and uneven light. Uses an integral image.
  function inkMask(gray, w, h) {
    const S = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += gray[y * w + x];
        S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row;
      }
    }
    const r = Math.max(4, Math.round(w / 40)); // window about 1/20 of the image width
    const ink = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        if (gray[y * w + x] < mean - C) ink[y * w + x] = 1;
      }
    }
    return ink;
  }

  // Connected ink blobs (4-connected), found with an explicit stack (no recursion).
  function blobs(ink, w, h) {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const out = [];
    for (let s = 0; s < w * h; s++) {
      if (!ink[s] || seen[s]) continue;
      let top = 0;
      stack[top++] = s;
      seen[s] = 1;
      const b = { x0: w, y0: h, x1: -1, y1: -1, area: 0 };
      while (top > 0) {
        const i = stack[--top];
        const x = i % w, y = (i - x) / w;
        b.area++;
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
        // push unseen ink neighbours
        const nb = [];
        if (x > 0) nb.push(i - 1);
        if (x < w - 1) nb.push(i + 1);
        if (y > 0) nb.push(i - w);
        if (y < h - 1) nb.push(i + w);
        for (const j of nb) if (ink[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
      }
      out.push(b);
    }
    return out;
  }

  // The 4 corner marks are solid, roughly square black blobs away from the image edge.
  // Pick the combination (one per quadrant around their centre) that spans the largest area.
  function findCorners(ink, w, h) {
    const cands = [];
    for (const b of blobs(ink, w, h)) {
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
      const inside = b.x0 > 1 && b.y0 > 1 && b.x1 < w - 2 && b.y1 < h - 2;
      const square = bw / bh > 0.6 && bw / bh < 1.6;
      const size = bw >= 0.015 * w && bw <= 0.08 * w;
      const filled = b.area / (bw * bh) > 0.7;
      if (inside && square && size && filled) {
        cands.push({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, size: (bw + bh) / 2 });
      }
    }
    // keep the most plausible few, largest first (the real corners are never tiny)
    cands.sort((a, b) => b.size - a.size);
    const list = cands.slice(0, 10);
    let best = null, bestArea = 0;
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++)
      for (let c = b + 1; c < list.length; c++) for (let d = c + 1; d < list.length; d++) {
        const q = [list[a], list[b], list[c], list[d]];
        const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
        const lab = {};
        let ok = true;
        for (const p of q) {
          const key = (p.y < cy ? "t" : "b") + (p.x < cx ? "l" : "r");
          if (lab[key]) { ok = false; break; }
          lab[key] = p;
        }
        if (!ok || !lab.tl || !lab.tr || !lab.bl || !lab.br) continue;
        // the 4 marks should all be about the same size
        const sizes = q.map(p => p.size);
        if (Math.max(...sizes) > 1.6 * Math.min(...sizes)) continue;
        // area of the quadrilateral tl -> tr -> br -> bl (shoelace)
        const pts = [lab.tl, lab.tr, lab.br, lab.bl];
        let area = 0;
        for (let i = 0; i < 4; i++) {
          const p = pts[i], n = pts[(i + 1) % 4];
          area += p.x * n.y - n.x * p.y;
        }
        area = Math.abs(area) / 2;
        if (area > bestArea) { bestArea = area; best = lab; }
      }
    return best;
  }

  // Solve A x = b (small dense system) by Gaussian elimination with partial pivoting.
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      [M[col], M[piv]] = [M[piv], M[col]];
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  // Perspective map from the unit square to the 4 image points (TL, TR, BR, BL).
  // Returns a function (u, v) -> { x, y } in image pixels.
  function homography(pts) {
    const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const A = [], b = [];
    src.forEach(([u, v], i) => {
      const { x, y } = pts[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    });
    const [h0, h1, h2, h3, h4, h5, h6, h7] = solve(A, b);
    return (u, v) => {
      const d = h6 * u + h7 * v + 1;
      return { x: (h0 * u + h1 * v + h2) / d, y: (h3 * u + h4 * v + h5) / d };
    };
  }

  // Share of ink samples inside a box, skipping the printed border (SHRINK on each side).
  function boxScore(ink, w, h, map, box) {
    const [u, v, bw, bh] = box;
    let hits = 0, n = 0;
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const fx = SHRINK + (1 - 2 * SHRINK) * (i + 0.5) / GRID;
      const fy = SHRINK + (1 - 2 * SHRINK) * (j + 0.5) / GRID;
      const p = map(u + bw * fx, v + bh * fy);
      const x = Math.floor(p.x + 0.5), y = Math.floor(p.y + 0.5);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      n++;
      hits += ink[y * w + x];
    }
    return n ? hits / n : 0;
  }

  // The photo lens bends the grid a little (more at the edges), so the homography
  // alone is a few pixels off. Find each box's printed outline in the ink mask,
  // then fit a smooth offset field (quadratic in position) that corrects the map.
  const SEARCH = 10; // max pixel shift tried per box

  // Best whole-pixel shift that lines a box's outline up with the ink mask.
  function outlineShift(ink, w, h, map, box) {
    const [u, v, bw, bh] = box;
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.05) pts.push([u + bw * t, v], [u + bw * t, v + bh], [u, v + bh * t], [u + bw, v + bh * t]);
    const P = pts.map(([a, b]) => map(a, b));
    const scores = [];
    let best = 0;
    for (let dy = -SEARCH; dy <= SEARCH; dy++) for (let dx = -SEARCH; dx <= SEARCH; dx++) {
      let hits = 0;
      for (const p of P) {
        const x = Math.floor(p.x + dx + 0.5), y = Math.floor(p.y + dy + 0.5);
        if (x >= 0 && y >= 0 && x < w && y < h) hits += ink[y * w + x];
      }
      const s = hits / P.length;
      scores.push({ dx, dy, s });
      if (s > best) best = s;
    }
    // average the shifts that tie for best (ties are common on straight lines)
    const tied = scores.filter(o => o.s >= best - 0.02);
    return {
      dx: tied.reduce((a, o) => a + o.dx, 0) / tied.length,
      dy: tied.reduce((a, o) => a + o.dy, 0) / tied.length,
      s: best
    };
  }

  // Quadratic terms of a position normalised to -1..1, and a dot product with coefficients.
  const terms = (x, y) => [1, x, y, x * x, x * y, y * y];
  const dot = (c, t) => t.reduce((a, x, i) => a + x * c[i], 0);

  // Weighted least-squares fit of a quadratic surface: pts = [{ t: terms, v: value, wt: weight }].
  function fitSurface(pts) {
    const M = Array.from({ length: 6 }, () => new Array(6).fill(0));
    const r = new Array(6).fill(0);
    for (const { t, v, wt } of pts) for (let i = 0; i < 6; i++) {
      r[i] += wt * t[i] * v;
      for (let j = 0; j < 6; j++) M[i][j] += wt * t[i] * t[j];
    }
    for (let i = 0; i < 6; i++) M[i][i] += 1e-9; // keep the solve stable
    return solve(M, r);
  }

  // Corrected map: homography plus the fitted offset field. Falls back to the homography.
  function calibrate(ink, w, h, map0, rows) {
    const norm = (x, y) => terms((x - w / 2) / (w / 2), (y - h / 2) / (h / 2));
    const obs = [];
    for (const row of rows) for (const box of row.boxes) {
      const p = map0(box[0] + box[2] / 2, box[1] + box[3] / 2);
      const s = outlineShift(ink, w, h, map0, box);
      obs.push({ t: norm(p.x, p.y), dx: s.dx, dy: s.dy, wt: s.s });
    }
    let use = obs.filter(o => o.wt > 0.5);
    let cx = null, cy = null;
    for (let pass = 0; pass < 3 && use.length > 12; pass++) {
      cx = fitSurface(use.map(o => ({ t: o.t, v: o.dx, wt: o.wt })));
      cy = fitSurface(use.map(o => ({ t: o.t, v: o.dy, wt: o.wt })));
      // drop boxes more than 1.5 px off the surface, then refit
      use = use.filter(o => Math.hypot(dot(cx, o.t) - o.dx, dot(cy, o.t) - o.dy) < 1.5);
    }
    if (!cx || !cy || ![...cx, ...cy].every(Number.isFinite)) return map0;
    return (u, v) => {
      const p = map0(u, v);
      const t = norm(p.x, p.y);
      return { x: p.x + dot(cx, t), y: p.y + dot(cy, t) };
    };
  }

  // img: { gray: Uint8Array, width, height }; rows: [{ no, boxes: [[u,v,w,h] x3 or x4] }]
  // Returns { ok: true, marks: { "01": { u, p, b[, n] }, ... } } or { ok: false, reason }.
  function readSheet(img, rows) {
    const { gray, width: w, height: h } = img;
    const ink = inkMask(gray, w, h);
    const corners = findCorners(ink, w, h);
    if (!corners) return { ok: false, reason: "corners" };
    const map0 = homography([corners.tl, corners.tr, corners.br, corners.bl]);
    const map = calibrate(ink, w, h, map0, rows);
    const marks = {};
    for (const row of rows) {
      const s = row.boxes.map(box => boxScore(ink, w, h, map, box));
      const m = { u: s[0] > THRESHOLD, p: s[1] > THRESHOLD, b: s[2] > THRESHOLD };
      // Newer sheets have a 4th box (N = need more)
      if (s.length > 3) m.n = s[3] > THRESHOLD;
      marks[row.no] = m;
    }
    return { ok: true, marks };
  }

  const FT_OMR = { layoutFromRects, readSheet };
  if (typeof module !== "undefined") module.exports = FT_OMR;
  else window.FT_OMR = FT_OMR;
})();
