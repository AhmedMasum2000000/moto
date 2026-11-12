// Day mode shows logos straight on the light page, with no dark plate behind them.
// Many logos are drawn as white lettering on a transparent background, which would
// vanish on a light page. In day mode this module makes a copy of each such logo
// in which the white lettering that sits on transparency is drawn dark instead.
// White that sits inside a coloured shape (a white "T" in a badge, letters on a
// coloured block) and logos with a solid background are left exactly as they are.
// Night mode always shows the original file.

const SELECTOR = [
  '.nav__brand img', '.menu__top img', '.footer img[src*="logo"]',
  '.brandmarks img', '.brand-partners__tile img', '.partners__row img',
].join(',');
const DARK = [31, 30, 34];
const MAX_SIDE = 900;          // enough for a crisp logo at any size the page shows
const cache = new Map();       // original src -> Promise<day src | ''>

const isLight = () => document.documentElement.dataset.theme === 'light';

function load(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

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

// Hand-made day versions win over the automatic one (the store logo keeps its white M on red).
const MADE = [[/\/assets\/logo\.(png|webp)(\?.*)?$/, 'assets/logo-day.png?v=fb-1112b']];

async function dayVersion(src) {
  for (const [test, file] of MADE) if (test.test(src)) return new URL(file, document.baseURI).href;
  if (/\.jpe?g(\?|$)/i.test(src)) return '';
  const img = await load(src);
  let w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return '';
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  if (!recolour(data, w, h)) return '';
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

function original(img) { return img.dataset.nightSrc || img.currentSrc || img.src; }

async function apply(img) {
  const src = original(img);
  if (!src || src.startsWith('data:')) return;
  if (!isLight()) {
    if (img.dataset.nightSrc) { img.src = img.dataset.nightSrc; delete img.dataset.nightSrc; img.removeAttribute('data-day-logo'); }
    return;
  }
  if (img.dataset.nightSrc) return;
  if (!cache.has(src)) cache.set(src, dayVersion(src).catch(() => ''));
  const day = await cache.get(src);
  if (!day || !isLight() || img.dataset.nightSrc || original(img) !== src) return;
  img.dataset.nightSrc = src;
  img.removeAttribute('srcset');
  img.dataset.dayLogo = '';
  img.src = day;
}

function sweep(root = document) {
  const list = root.matches?.(SELECTOR) ? [root] : [...(root.querySelectorAll?.(SELECTOR) || [])];
  for (const img of list) apply(img);
}

export function dayLogos() {
  sweep();
  new MutationObserver(() => sweep()).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  new MutationObserver(records => {
    for (const r of records) for (const node of r.addedNodes) if (node.nodeType === 1) sweep(node);
  }).observe(document.body, {childList: true, subtree: true});
}
