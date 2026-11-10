// Drag to reorder with pointer events (mouse, touch and pen). Only the handle has touch-action:none,
// so a list still scrolls normally on a phone. The dragged item follows the pointer, the others move
// out of the way live, the page (or the scrolling sheet) auto-scrolls near the edges, and onDrop runs
// once with the new order. Arrow keys on a focused handle move the item one place (keyboard users).
//
// API:
//   makeSortable(list, {item, handle, grid, onDrop, disabled}) → {destroy()}
//       list    container element
//       item    selector of the sortable children (default '[data-sort-id]'; the id is data-sort-id)
//       handle  selector of the drag handle inside an item (default '[data-drag-handle]')
//       grid    true for wrapping tile grids (gallery); default false (vertical list)
//       onDrop(ids, {id, from, to}) called once after a drop that changed the order
//   moveIds(ids, id, where)   → new array; where = 'up' | 'down' | 'top' | 'bottom' | index
//   dragHandle(label, {tour}) → html for a handle button
//   bindSortable(ctx, root)   → wires every [data-sortable] container inside root to one save per drop:
//       data-sortable="<type>"    a COLLECTIONS type (product, category, brand, …) → reorderRecords
//       data-sortable="subcategory" data-category="<catId>" → children of that category
//       data-sortable="layout" data-page="index|shop"       → page layout refs
//       data-sort-label="Reordered categories" (optional save label)
//     Returns {destroy()}.
import {reorderRecords, reorderLayout} from '../lib/records.mjs';
import {checkDocument} from './confirm.mjs';

const ESC = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function moveIds(ids, id, where) {
  const list = ids.slice(), i = list.indexOf(id);
  if (i < 0) return list;
  list.splice(i, 1);
  const j = where === 'top' ? 0 : where === 'bottom' ? list.length : where === 'up' ? Math.max(0, i - 1) : where === 'down' ? Math.min(list.length, i + 1) : Math.max(0, Math.min(list.length, Number(where) || 0));
  list.splice(j, 0, id);
  return list;
}

export function dragHandle(label = 'Drag to reorder', {tour = true} = {}) {
  return `<button type="button" class="drag-handle" data-drag-handle ${tour ? 'data-tour="drag-handle"' : ''} aria-label="${ESC(label)}" title="Drag to reorder (or use the arrow keys)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke="currentColor" stroke-width="3" stroke-linecap="square"/></svg></button>`;
}

function scrollParent(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

export function makeSortable(list, {item = '[data-sort-id]', handle = '[data-drag-handle]', grid = false, onDrop, disabled} = {}) {
  if (!list) return {destroy() {}};
  const items = () => [...list.children].filter(x => x.matches(item));
  const idOf = el => el.getAttribute('data-sort-id') ?? el.dataset.id;
  let drag = null;

  const finish = (commit) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.raf);
    d.el.classList.remove('is-dragging');
    d.el.style.transform = '';
    list.classList.remove('is-sorting');
    try { d.handle.releasePointerCapture?.(d.pointerId); } catch { /* not captured */ }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    const ids = items().map(idOf);
    if (!commit) {
      // Put everything back where it was.
      const byId = new Map(items().map(el => [idOf(el), el]));
      const anchor = d.next && d.next.parentNode === list ? d.next : null;
      d.start.forEach(id => list.insertBefore(byId.get(id), anchor));
      return;
    }
    const from = d.start.indexOf(d.id), to = ids.indexOf(d.id);
    if (from !== to) onDrop?.(ids, {id: d.id, from, to});
  };

  const place = (x, y) => {
    const d = drag;
    const others = items().filter(el => el !== d.el);
    let before = null;
    if (grid) {
      let best = null, bestDist = Infinity;
      for (const el of others) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dist = Math.hypot(cx - x, cy - y);
        if (dist < bestDist) { bestDist = dist; best = {el, r, cx}; }
      }
      if (best) {
        const self = d.el.getBoundingClientRect();
        if (bestDist < Math.max(best.r.width, self.width)) before = x < best.cx ? best.el : best.el.nextElementSibling;
        else return;
      }
    } else {
      before = others.find(el => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
    }
    if (before === d.el) return;
    if (before ? d.el.nextElementSibling !== before : d.el !== items().at(-1)) {
      if (before) list.insertBefore(d.el, before);
      else {
        const last = items().filter(el => el !== d.el).at(-1);
        list.insertBefore(d.el, last ? last.nextSibling : null);
      }
    }
  };

  const paint = () => {
    const d = drag;
    if (!d) return;
    // Natural position (without the transform) relative to where the drag started.
    const dx = grid ? d.x - d.sx - (d.el.offsetLeft - d.ox) : 0;
    const dy = d.y - d.sy - (d.el.offsetTop - d.oy) + (d.scroller ? d.scroller.scrollTop - d.st : window.scrollY - d.st);
    d.el.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const tick = () => {
    const d = drag;
    if (!d) return;
    const edge = 56;
    const box = d.scroller ? d.scroller.getBoundingClientRect() : {top: 0, bottom: window.innerHeight};
    let v = 0;
    if (d.y < box.top + edge) v = -Math.ceil((box.top + edge - d.y) / 4);
    else if (d.y > box.bottom - edge) v = Math.ceil((d.y - (box.bottom - edge)) / 4);
    if (v) {
      v = Math.max(-24, Math.min(24, v));
      if (d.scroller) d.scroller.scrollTop += v; else window.scrollBy(0, v);
      place(d.x, d.y);
    }
    paint();
    d.raf = requestAnimationFrame(tick);
  };

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    drag.x = e.clientX; drag.y = e.clientY;
    place(drag.x, drag.y);
  }
  function onUp(e) { if (drag && e.pointerId === drag.pointerId) finish(true); }
  function onCancel(e) { if (drag && e.pointerId === drag.pointerId) finish(false); }

  function onDown(e) {
    if (drag || e.button > 0 || (typeof disabled === 'function' ? disabled() : disabled)) return;
    const h = e.target.closest(handle);
    if (!h || !list.contains(h)) return;
    const el = h.closest(item);
    if (!el || el.parentElement !== list) return;
    e.preventDefault();
    const scroller = scrollParent(list);
    drag = {el, handle: h, id: idOf(el), pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      ox: el.offsetLeft, oy: el.offsetTop, scroller, st: scroller ? scroller.scrollTop : window.scrollY,
      start: items().map(idOf), next: items().at(-1)?.nextSibling || null, raf: 0};
    try { h.setPointerCapture?.(e.pointerId); } catch { /* fine */ }
    el.classList.add('is-dragging');
    list.classList.add('is-sorting');
    window.addEventListener('pointermove', onMove, {passive: false});
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    drag.raf = requestAnimationFrame(tick);
  }

  function onKey(e) {
    const h = e.target.closest(handle);
    if (!h || !list.contains(h) || drag) return;
    const keys = grid ? {ArrowLeft: 'up', ArrowUp: 'up', ArrowRight: 'down', ArrowDown: 'down'} : {ArrowUp: 'up', ArrowDown: 'down', Home: 'top', End: 'bottom'};
    const where = keys[e.key];
    if (!where) return;
    const el = h.closest(item);
    if (!el || el.parentElement !== list) return;
    e.preventDefault();
    const start = items().map(idOf), id = idOf(el);
    const ids = moveIds(start, id, where);
    if (ids.join('\u0000') === start.join('\u0000')) return;
    const byId = new Map(items().map(x => [idOf(x), x]));
    const anchor = items().at(-1)?.nextSibling || null;
    ids.forEach(x => list.insertBefore(byId.get(x), anchor));
    h.focus();
    onDrop?.(ids, {id, from: start.indexOf(id), to: ids.indexOf(id), keyboard: true});
  }

  list.addEventListener('pointerdown', onDown);
  list.addEventListener('keydown', onKey);
  // Stop the browser's own image / link drag on handles.
  const noNative = e => { if (e.target.closest?.(handle)) e.preventDefault(); };
  list.addEventListener('dragstart', noNative);
  return {destroy() { finish(false); list.removeEventListener('pointerdown', onDown); list.removeEventListener('keydown', onKey); list.removeEventListener('dragstart', noNative); }};
}

const PLURAL = {product: 'products', category: 'categories', brand: 'brands', brandGroup: 'brand groups', kit: 'bundles', vehicle: 'bikes & cars', banner: 'banners', block: 'cards', menu: 'menu links', page: 'pages', post: 'posts', service: 'services', subcategory: 'subcategories'};

// One save per drop for every [data-sortable] container inside root.
export function bindSortable(ctx, root) {
  const handles = [];
  for (const list of root.querySelectorAll('[data-sortable]')) {
    if (list._sortable) { handles.push(list._sortable); continue; }
    const type = list.dataset.sortable;
    const s = makeSortable(list, {
      onDrop: async ids => {
        try {
          let result;
          if (type === 'layout') result = reorderLayout(ctx.data, list.dataset.page, ids.map(id => id));
          else result = reorderRecords(ctx.data, type, ids, type === 'subcategory' ? {category: list.dataset.category} : {});
          if (!result.changed) return;
          checkDocument(ctx, result.next);
          const page = list.dataset.page === 'shop' ? 'shop page' : 'homepage';
          await ctx.save(result.next, list.dataset.sortLabel || (type === 'layout' ? 'Reordered ' + page : 'Reordered ' + (PLURAL[type] || 'items')));
        } catch (err) {
          ctx.toast?.(err?.detail || err?.message || 'Could not save the new order.');
        }
      },
    });
    list._sortable = s;
    handles.push(s);
  }
  return {destroy() { handles.forEach(h => h.destroy()); }};
}
