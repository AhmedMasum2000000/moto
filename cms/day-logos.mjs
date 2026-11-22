// Day mode shows logos straight on the light page, with no dark plate behind them.
// Many logos are drawn as white lettering on a transparent background, which would
// vanish on a light page. In day mode a copy of each such logo is made in which the
// white lettering is drawn dark (see recolour.mjs). Night mode always shows the
// original file.
//
// The work never blocks the page: a logo is only prepared when it comes near the
// screen, the pixel work runs in a background worker (or in idle time where workers
// cannot draw), and finished logos are kept in the browser's cache so later visits
// show them at once.
import {recolour, MAX_SIDE} from './recolour.mjs?v=fb-1122';
export {recolour};

const SELECTOR = [
  '.nav__brand img', '.menu__top img', '.footer img[src*="logo"]',
  '.brandmarks img', '.brand-partners__tile img', '.partners__row img',
].join(',');
const CACHE = 'mm-day-logos-1';
const memo = new Map();        // original src -> Promise<day src | ''>

const isLight = () => document.documentElement.dataset.theme === 'light';

// Hand-made day versions win over the automatic one (the store logo keeps its white M on red).
const MADE = [[/\/assets\/logo\.(png|webp)(\?.*)?$/, 'assets/logo-day.png?v=fb-1122']];

let worker = null, workerFailed = false, nextId = 0;
const waiting = new Map();
function viaWorker(src) {
  if (workerFailed || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  try {
    if (!worker) {
      worker = new Worker(new URL('./day-logos-worker.mjs?v=fb-1122', import.meta.url), {type: 'module'});
      worker.onmessage = ({data}) => { const done = waiting.get(data.id); waiting.delete(data.id); done?.(data); };
      worker.onerror = () => { workerFailed = true; for (const done of waiting.values()) done({error: 'worker'}); waiting.clear(); };
    }
  } catch { workerFailed = true; return null; }
  const id = ++nextId;
  return new Promise(resolve => { waiting.set(id, resolve); worker.postMessage({id, src}); });
}

// Fallback for browsers whose workers cannot draw: the same work, in idle time.
function onMainThread(src) {
  return new Promise(resolve => {
    const run = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onerror = () => resolve({error: 'load'});
      img.onload = () => {
        try {
          const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d', {willReadFrequently: true});
          ctx.drawImage(img, 0, 0, w, h);
          const pixels = ctx.getImageData(0, 0, w, h);
          if (!recolour(pixels, w, h)) return resolve({blob: null});
          ctx.putImageData(pixels, 0, 0);
          canvas.toBlob(blob => resolve({blob}), 'image/png');
        } catch (error) { resolve({error: String(error)}); }
      };
      img.src = src;
    };
    'requestIdleCallback' in window ? requestIdleCallback(run, {timeout: 2000}) : setTimeout(run, 200);
  });
}

async function fromCache(src) {
  try {
    if (!('caches' in window)) return undefined;
    const hit = await (await caches.open(CACHE)).match(src);
    if (!hit) return undefined;
    return hit.headers.get('x-day-logo') === 'unchanged' ? null : await hit.blob();
  } catch { return undefined; }
}
async function toCache(src, blob) {
  try {
    if (!('caches' in window)) return;
    const response = blob ? new Response(blob, {headers: {'content-type': 'image/png'}}) : new Response('', {headers: {'x-day-logo': 'unchanged'}});
    await (await caches.open(CACHE)).put(src, response);
  } catch { /* storage full or blocked: the logo is simply prepared again next time */ }
}

async function dayVersion(src) {
  for (const [test, file] of MADE) if (test.test(src)) return new URL(file, document.baseURI).href;
  if (/\.jpe?g(\?|$)/i.test(src)) return '';
  let blob = await fromCache(src);
  if (blob === undefined) {
    const result = (await viaWorker(src)) || (await onMainThread(src));
    const final = result.error && !workerFailed ? await onMainThread(src) : result;
    if (final.error) return '';
    blob = final.blob;
    toCache(src, blob);
  }
  return blob ? URL.createObjectURL(blob) : '';
}

function original(img) { return img.dataset.nightSrc || img.currentSrc || img.src; }

function toNight(img) {
  if (!img.dataset.nightSrc) return;
  img.src = img.dataset.nightSrc;
  delete img.dataset.nightSrc;
  img.removeAttribute('data-day-logo');
}

async function toDay(img) {
  const src = original(img);
  if (!src || src.startsWith('data:') || src.startsWith('blob:') || img.dataset.nightSrc) return;
  if (!memo.has(src)) memo.set(src, dayVersion(src).catch(() => ''));
  const day = await memo.get(src);
  if (!day || !isLight() || img.dataset.nightSrc || original(img) !== src) return;
  img.dataset.nightSrc = src;
  img.removeAttribute('srcset');
  img.dataset.dayLogo = '';
  img.src = day;
}

// Logos are prepared only when they come within reach of the screen.
const near = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    near.unobserve(entry.target);
    if (isLight()) toDay(entry.target);
  }
}, {rootMargin: '600px 0px'});

function sweep(root = document) {
  const list = root.matches?.(SELECTOR) ? [root] : [...(root.querySelectorAll?.(SELECTOR) || [])];
  for (const img of list) {
    if (!isLight()) { toNight(img); continue; }
    if (near) near.observe(img); else toDay(img);
  }
}

export function dayLogos() {
  sweep();
  new MutationObserver(() => sweep()).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  new MutationObserver(records => {
    for (const r of records) for (const node of r.addedNodes) if (node.nodeType === 1) sweep(node);
  }).observe(document.body, {childList: true, subtree: true});
}
