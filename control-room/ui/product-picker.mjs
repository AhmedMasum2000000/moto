// Product picker for hand-picked sections and bundles: search over name, brand and SKU with
// thumbnails, a selected list in drag order, "x of 48". The selection is written as hidden inputs
// (name="productIds" by default) in order, so saveEditor's FormData.getAll(name) gets the ordered ids.
//
// API:
//   searchProducts(doc, query, {limit=30, exclude}) → products matching name / brand / SKU / tags
//   renderProductPicker(ctx, ids, {name='productIds', max=48, label, tour}) → html (div[data-product-picker])
//   bindProductPicker(ctx, root, {onChange(ids)}) → {get ids(), set(ids), destroy()}; also el._picker
import {escOf} from './confirm.mjs';
import {makeSortable, moveIds, dragHandle} from './sortable.mjs';

const key = v => String(v ?? '').trim().toLowerCase();
const money = v => '৳' + Number(v || 0).toLocaleString('en-US');

export function searchProducts(doc, query, {limit = 30, exclude} = {}) {
  const words = key(query).split(/\s+/).filter(Boolean);
  const out = [];
  for (const p of doc?.products || []) {
    if (exclude?.has?.(p.id)) continue;
    const hay = [p.name, p.brand, p.sku, ...(Array.isArray(p.tags) ? p.tags : [])].map(key).join(' ');
    if (words.every(w => hay.includes(w))) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

function selectedHtml(ctx, ids, name, max) {
  const esc = escOf(ctx);
  const byId = new Map((ctx.data?.products || []).map(p => [p.id, p]));
  const shown = ids.filter(id => byId.has(id));
  return shown.map((id, i) => { const p = byId.get(id); return `<li class="pp-row" data-sort-id="${esc(id)}">
${dragHandle('Drag ' + p.name, {tour: false})}
<img src="${esc(ctx.imageUrl?.(p.image) || '')}" alt=""><span class="pp-row__name"><b>${esc(p.name)}</b><small>${esc([p.brand, p.sku].filter(Boolean).join(' · '))}${p.visible === false ? ' · Hidden' : ''}</small></span>
<span class="pp-row__arrows"><button type="button" class="icon-button" data-pp-move="up" aria-label="Move ${esc(p.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-pp-move="down" aria-label="Move ${esc(p.name)} down" ${i === shown.length - 1 ? 'disabled' : ''}>↓</button></span>
<button type="button" class="icon-button" data-pp-remove aria-label="Remove ${esc(p.name)}">✕</button>
<input type="hidden" name="${esc(name)}" value="${esc(id)}"></li>`; }).join('');
}

function resultsHtml(ctx, list, selected, full) {
  const esc = escOf(ctx);
  if (!list.length) return '<li class="pp-empty">No products match. Try a shorter word.</li>';
  return list.map(p => `<li class="pp-result"><img src="${esc(ctx.imageUrl?.(p.image) || '')}" alt=""><span class="pp-row__name"><b>${esc(p.name)}</b><small>${esc([p.brand, p.sku].filter(Boolean).join(' · '))} · ${money(p.sale || p.price)}</small></span>${selected.has(p.id) ? '<span class="pp-added">Added</span>' : `<button type="button" class="btn ghost tiny" data-pp-add="${esc(p.id)}" ${full ? 'disabled' : ''}>Add</button>`}</li>`).join('');
}

export function renderProductPicker(ctx, ids = [], {name = 'productIds', max = 48, label = 'Products to show', tour = ''} = {}) {
  const esc = escOf(ctx);
  const list = [...new Set(ids)].slice(0, max);
  return `<div class="product-picker" data-product-picker data-name="${esc(name)}" data-max="${max}" ${tour ? `data-tour="${esc(tour)}"` : ''}>
<div class="product-picker__head"><span class="product-picker__label">${esc(label)}</span><span class="product-picker__count" data-pp-count aria-live="polite">${list.length} of ${max}</span></div>
<ol class="product-picker__selected" data-pp-selected>${selectedHtml(ctx, list, name, max)}</ol>
<p class="product-picker__empty" data-pp-none ${list.length ? 'hidden' : ''}>Nothing picked yet. Search below and tap Add.</p>
<label class="search-box product-picker__search"><input type="search" data-pp-search placeholder="Search name, brand or SKU…" aria-label="Search products to add"></label>
<ul class="product-picker__results" data-pp-results>${resultsHtml(ctx, searchProducts(ctx.data, '', {limit: 12}), new Set(list), list.length >= max)}</ul>
</div>`;
}

export function bindProductPicker(ctx, root, {onChange} = {}) {
  const box = root.matches?.('[data-product-picker]') ? root : root.querySelector('[data-product-picker]');
  if (!box) return null;
  const name = box.dataset.name || 'productIds';
  const max = Number(box.dataset.max) || 48;
  const selectedEl = box.querySelector('[data-pp-selected]');
  const resultsEl = box.querySelector('[data-pp-results]');
  const search = box.querySelector('[data-pp-search]');
  const read = () => [...selectedEl.querySelectorAll('[data-sort-id]')].map(li => li.dataset.sortId);
  let timer = 0;

  const paint = (ids, focusSel) => {
    selectedEl.innerHTML = selectedHtml(ctx, ids, name, max);
    box.querySelector('[data-pp-count]').textContent = `${ids.length} of ${max}`;
    box.querySelector('[data-pp-none]').hidden = ids.length > 0;
    showResults();
    if (focusSel) selectedEl.querySelector(focusSel)?.focus();
    onChange?.(ids);
  };
  const showResults = () => {
    const ids = read();
    resultsEl.innerHTML = resultsHtml(ctx, searchProducts(ctx.data, search.value, {limit: search.value.trim() ? 30 : 12}), new Set(ids), ids.length >= max);
  };
  const onClick = e => {
    const add = e.target.closest('[data-pp-add]');
    if (add) {
      const ids = read();
      if (ids.length >= max) { ctx.toast?.(`Up to ${max} products fit here.`); return; }
      if (!ids.includes(add.dataset.ppAdd)) paint([...ids, add.dataset.ppAdd]);
      return;
    }
    const row = e.target.closest('[data-sort-id]');
    if (!row) return;
    if (e.target.closest('[data-pp-remove]')) paint(read().filter(id => id !== row.dataset.sortId));
    const mv = e.target.closest('[data-pp-move]');
    if (mv) paint(moveIds(read(), row.dataset.sortId, mv.dataset.ppMove), `[data-sort-id="${CSS.escape(row.dataset.sortId)}"] [data-pp-move="${mv.dataset.ppMove}"]`);
  };
  const onInput = e => { if (e.target === search) { clearTimeout(timer); timer = setTimeout(showResults, 120); } };
  const onKey = e => { if (e.target === search && e.key === 'Enter') { e.preventDefault(); resultsEl.querySelector('[data-pp-add]:not([disabled])')?.click(); } };
  box.addEventListener('click', onClick);
  box.addEventListener('input', onInput);
  box.addEventListener('keydown', onKey);
  const sortable = makeSortable(selectedEl, {onDrop: ids => paint(ids)});
  const api = {
    get ids() { return read(); },
    set(ids) { paint([...new Set(ids)].slice(0, max)); },
    destroy() { clearTimeout(timer); sortable.destroy(); box.removeEventListener('click', onClick); box.removeEventListener('input', onInput); box.removeEventListener('keydown', onKey); },
  };
  box._picker = api;
  return api;
}
