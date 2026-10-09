// Reads ✕ marks off a photo of the printed fridge sheet (no AI, no network).
// Works on a grayscale image: finds the 4 black corner squares, maps each
// U / P / B box from the saved sheet layout onto the photo, and checks for ink.
// Plain JS so it runs in the browser (window.FT_OMR) and in Node tests.
(function() {
  // Box positions relative to the 4 corner marks: (0,0) = top-left mark centre,
  // (1,1) = bottom-right mark centre. corners: { tl, tr, bl, br } as {x,y,w,h};
  // rows: [{ no, id, name, boxes: [{x,y,w,h} x3] }] -> boxes as [u, v, w, h].
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

  // img: { gray: Uint8Array, width, height }; rows: [{ no, boxes: [[u,v,w,h] x3] }]
  // Returns { ok: true, marks: { "01": { u, p, b }, ... } } or { ok: false, reason }.
  function readSheet(img, rows) {
    return { ok: false, reason: "not built yet" };
  }

  const FT_OMR = { layoutFromRects, readSheet };
  if (typeof module !== "undefined") module.exports = FT_OMR;
  else window.FT_OMR = FT_OMR;
})();
