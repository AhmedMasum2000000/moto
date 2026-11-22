// Day-mode logo recolouring, shared by the page and its background worker.
// Redraws white lettering that sits on transparency in a dark grey, so it stays
// readable on the light page. White inside a coloured shape (a white "T" in a
// badge, letters on a coloured block) and logos with a solid background are left
// exactly as they are.
const DARK = [31, 30, 34];
export const MAX_SIDE = 900;   // enough for a crisp logo at any size the page shows

// Redraws white lettering that sits on transparency in DARK. Returns true when anything changed.
export function recolour(data, w, h) {
  const px = data.data;
  const n = w * h;
  const light = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4, a = px[o + 3];
    if (a < 8) continue;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    if (mn >= 165 && mx - mn <= 45) light[i] = 1;
  }
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let changed = false;
  for (let start = 0; start < n; start++) {
    if (!light[start] || seen[start]) continue;
    // Collect one connected patch of light pixels and see what surrounds it.
    let top = 0, size = 0, edgeClear = 0, edgeAll = 0;
    const members = [];
    stack[top++] = start; seen[start] = 1;
    while (top) {
      const i = stack[--top];
      members.push(i); size++;
      const x = i % w, y = (i - x) / w;
      const near = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of near) {
        if (j < 0) continue;
        if (light[j]) { if (!seen[j]) { seen[j] = 1; stack[top++] = j; } continue; }
        edgeAll++;
        if (px[j * 4 + 3] < 40) edgeClear++;
      }
    }
    // Lettering on transparency: most of its outline borders see-through pixels.
    if (size < 4 || !edgeAll || edgeClear / edgeAll < 0.45) continue;
    for (const i of members) {
      const o = i * 4;
      const lum = (px[o] + px[o + 1] + px[o + 2]) / 3;
      const lift = Math.round((255 - lum) * 0.5); // keep light-grey shading a touch lighter
      px[o] = DARK[0] + lift; px[o + 1] = DARK[1] + lift; px[o + 2] = DARK[2] + lift;
    }
    changed = true;
  }
  return changed;
}

