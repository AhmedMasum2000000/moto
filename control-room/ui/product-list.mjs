// Fast lists: the Products list (filter chips, sort, search, chunked rendering, inline Visible / In
// stock toggles, bulk select with a sticky bulk bar, drag when filtered to one category) and the
// generic record list that replaces ordered() (checkbox, drag handle, arrows, Edit, Duplicate, Move
// to top/bottom, Delete, bulk Show/Hide/Duplicate/Delete).
//
// API (pure helpers are DOM-free and tested in tests/catalog-ui.test.mjs):
//   PAGE_SIZE = 50, SORTS = [[id, label]], STOCK_FILTERS
//   stockState(p)                          → 'in' | 'low' | 'out'   (low: quantity ≤ lowStock, default 3)
//   defaultListState()                     → {q, cat, sub, brand, stock, vis, featured, sale, sort}
//   parseListHash(hash)                    → state from '#products?cat=oil&sort=price-low…'
//   listHash(state)                        → '#products' + query (only non-default values)
//   filterProducts(doc, state)             → products matching the filters and the search
//   sortProducts(doc, list, sort)          → sorted copy
//   canDragProducts(state)                 → true when filtered to one category with manual sort
//   mountProductList(ctx, el, {hash})      → {state, refresh(), destroy()}  (el is emptied and filled)
//   renderRecordList(ctx, type, list, {sortable, empty, meta}) → html (div[data-record-list])
//   bindRecordList(ctx, root)              → {destroy()}  wires every [data-record-list] in root
//   showProductsIn(ctx, categoryId, subId) → opens Products filtered to a category
import {applyBulk, previewBulk, priceSummary, bulkLabel, actionsFor, ACTION_LABELS, STOCK} from '../lib/bulk.mjs';
import {moveRecord, reorderRecords, canDelete, canDuplicate, nameOf, getRecord, COLLECTIONS} from '../lib/records.mjs';
import {childName, findChild, references} from '../../cms/content-model.mjs';
import {escOf, confirmDialog, deleteFlow, duplicateFlow, checkDocument} from './confirm.mjs';
import {makeSortable, bindSortable, dragHandle} from './sortable.mjs';

export const PAGE_SIZE = 50;
export const SORTS = Object.freeze([['manual', 'Shop order'], ['name', 'Name A–Z'], ['price-low', 'Price: low to high'], ['price-high', 'Price: high to low'], ['stock', 'Stock: lowest first'], ['recent', 'Recently edited']]);
export const STOCK_FILTERS = Object.freeze([['', 'Any stock'], ['in', 'In stock'], ['low', 'Low stock'], ['out', 'Out of stock']]);
const VIS_FILTERS = [['', 'Visible & hidden'], ['visible', 'Visible only'], ['hidden', 'Hidden only']];
const key = v => String(v ?? '').trim().toLowerCase();
const money = v => '৳' + Number(v || 0).toLocaleString('en-US');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const nowIso = () => new Date().toISOString();

export function stockState(p) {
  if (!p) return 'in';
  const q = p.quantity;
  if (p.stock === 'Out of stock' || q === 0) return 'out';
  const low = Number.isFinite(Number(p.lowStock)) && p.lowStock !== null && p.lowStock !== '' ? Number(p.lowStock) : 3;
  if (q !== null && q !== undefined && q !== '' && Number(q) <= low) return 'low';
  return 'in';
}

export const defaultListState = () => ({q: '', cat: '', sub: '', brand: '', stock: '', vis: '', featured: false, sale: false, sort: 'manual'});
const KEYS = ['q', 'cat', 'sub', 'brand', 'stock', 'vis', 'featured', 'sale', 'sort'];

export function parseListHash(hash) {
  const s = defaultListState();
  const raw = String(hash || '');
  const i = raw.indexOf('?');
  if (i < 0) return s;
  const params = new URLSearchParams(raw.slice(i + 1));
  for (const k of KEYS) {
    if (!params.has(k)) continue;
    const v = params.get(k);
    if (k === 'featured' || k === 'sale') s[k] = v === '1' || v === 'true';
    else s[k] = String(v).slice(0, 200);
  }
  if (!SORTS.some(([id]) => id === s.sort)) s.sort = 'manual';
  if (!STOCK_FILTERS.some(([id]) => id === s.stock)) s.stock = '';
  if (!VIS_FILTERS.some(([id]) => id === s.vis)) s.vis = '';
  if (!s.cat) s.sub = '';
  return s;
}

export function listHash(state, route = 'products') {
  const d = defaultListState();
  const params = new URLSearchParams();
  for (const k of KEYS) {
    const v = state?.[k];
    if (v === d[k] || v === undefined || v === null || v === '') continue;
    if (k === 'featured' || k === 'sale') { if (v) params.set(k, '1'); }
    else params.set(k, String(v));
  }
  const q = params.toString();
  return '#' + route + (q ? '?' + q : '');
}

function hiddenCategory(doc, id) { const c = (doc?.categories || []).find(c => c.id === id); return !!c && c.visible === false; }

export function filterProducts(doc, state = {}) {
  const words = key(state.q).split(/\s+/).filter(Boolean);
  const brand = key(state.brand);
  const cats = new Map((doc?.categories || []).map(c => [c.id, c]));
  return (doc?.products || []).filter(p => {
    if (state.cat && p.category !== state.cat) return false;
    if (state.sub) { const cat = cats.get(p.category); const child = findChild(cat, p.subcategory); if ((child?.id || p.subcategory) !== state.sub) return false; }
    if (brand && key(p.brand) !== brand) return false;
    if (state.stock && stockState(p) !== state.stock) return false;
    if (state.vis === 'visible' && (p.visible === false || hiddenCategory(doc, p.category))) return false;
    if (state.vis === 'hidden' && !(p.visible === false || hiddenCategory(doc, p.category))) return false;
    if (state.featured && !p.featured) return false;
    if (state.sale && !(Number(p.sale) > 0 && Number(p.sale) < Number(p.price))) return false;
    if (words.length) {
      const hay = [p.name, p.brand, p.sku, ...(Array.isArray(p.tags) ? p.tags : []), p.description, childName(doc, p.category, p.subcategory), p.badge].map(key).join(' \u0000 ');
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });
}

const pay = p => Number(p.sale > 0 ? p.sale : p.price) || 0;
const stockRank = p => { const s = stockState(p); return s === 'out' ? 0 : s === 'low' ? 1 : 2; };
export function sortProducts(doc, list, sort = 'manual') {
  const order = new Map((doc?.products || []).map((p, i) => [p.id, i]));
  const byOrder = (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  const out = list.slice();
  const cmp = {
    name: (a, b) => String(a.name).localeCompare(String(b.name), 'en', {sensitivity: 'base'}) || byOrder(a, b),
    'price-low': (a, b) => pay(a) - pay(b) || byOrder(a, b),
    'price-high': (a, b) => pay(b) - pay(a) || byOrder(a, b),
    stock: (a, b) => stockRank(a) - stockRank(b) || (Number(a.quantity ?? Infinity) - Number(b.quantity ?? Infinity)) || byOrder(a, b),
    recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || byOrder(a, b),
  }[sort] || byOrder;
  return out.sort(cmp);
}

export const canDragProducts = s => !!s?.cat && (s.sort || 'manual') === 'manual';
const activeFilters = s => ['q', 'cat', 'sub', 'brand', 'stock', 'vis'].some(k => s[k]) || s.featured || s.sale;

// ── long press (phone select mode) ───────────────────────────────────────────────────────────────
const INTERACTIVE = 'button, a, input, select, textarea, label, summary, details, [data-drag-handle]';
function longPress(root, rowSelector, onLong) {
  let t = 0, start = null, fired = false, swallow = false;
  const cancel = () => { clearTimeout(t); t = 0; start = null; };
  const down = e => {
    const ctl = e.target.closest(INTERACTIVE);
    if (e.button > 0 || (ctl && !ctl.matches('[data-pl-open], .rl-text'))) return;
    const row = e.target.closest(rowSelector);
    if (!row || !root.contains(row)) return;
    fired = false; swallow = false;
    start = {x: e.clientX, y: e.clientY, row, at: Date.now()};
    t = setTimeout(() => { fired = true; onLong(start.row); navigator.vibrate?.(12); cancel(); }, 450);
  };
  // Touch slop: a finger wiggles a little. A press that moves after ~300 ms was meant as a long press,
  // so the click the browser still sends afterwards must not open the editor.
  const move = e => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) { if (Date.now() - start.at >= 300) swallow = true; cancel(); } };
  const click = e => { if (fired || swallow) { fired = false; swallow = false; e.preventDefault(); e.stopPropagation(); } };
  const ctxmenu = e => { if (e.target.closest(rowSelector) && (fired || t)) e.preventDefault(); };
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('click', click, true);
  root.addEventListener('contextmenu', ctxmenu);
  return () => { cancel(); root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', cancel); root.removeEventListener('pointercancel', cancel); root.removeEventListener('click', click, true); root.removeEventListener('contextmenu', ctxmenu); };
}

const closeMenus = (root, except) => root.querySelectorAll('details.row-menu[open]').forEach(d => { if (d !== except) d.removeAttribute('open'); });

// ── Products list ────────────────────────────────────────────────────────────────────────────────
const memory = {state: null, selected: new Set(), shown: PAGE_SIZE, selectMode: false};

function optionHtml(esc, options, value) {
  return options.map(([v, t]) => `<option value="${esc(v)}"${String(value) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('');
}

function brandOptions(doc) {
  const seen = new Map();
  for (const b of doc?.brands || []) if (b?.name) seen.set(key(b.name), b.name);
  for (const p of doc?.products || []) if (p.brand && !seen.has(key(p.brand))) seen.set(key(p.brand), p.brand);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', {sensitivity: 'base'}));
}

function filterBarHtml(ctx, s) {
  const esc = escOf(ctx);
  const d = ctx.data;
  const cat = (d.categories || []).find(c => c.id === s.cat);
  const subs = (cat?.children || []).filter(c => c && typeof c === 'object');
  const chip = (name, label, options, value) => `<label class="pl-chip${value ? ' is-on' : ''}"><span class="sr-only">${esc(label)}</span><select data-pl-filter="${name}" aria-label="${esc(label)}">${optionHtml(esc, options, value)}</select></label>`;
  return chip('cat', 'Category', [['', 'All categories'], ...(d.categories || []).map(c => [c.id, c.name + (c.visible === false ? ' (hidden)' : '')])], s.cat)
    + (subs.length ? chip('sub', 'Subcategory', [['', 'All subcategories'], ...subs.map(c => [c.id, c.name])], s.sub) : '')
    + chip('brand', 'Brand', [['', 'All brands'], ...brandOptions(d).map(b => [b, b])], brandOptions(d).find(b => key(b) === key(s.brand)) || '')
    + chip('stock', 'Stock', STOCK_FILTERS, s.stock)
    + chip('vis', 'On website', VIS_FILTERS, s.vis)
    + `<button type="button" class="pl-chip pl-chip--toggle${s.featured ? ' is-on' : ''}" data-pl-toggle="featured" aria-pressed="${s.featured}">Featured</button>`
    + `<button type="button" class="pl-chip pl-chip--toggle${s.sale ? ' is-on' : ''}" data-pl-toggle="sale" aria-pressed="${s.sale}">On sale</button>`
    + (activeFilters(s) ? '<button type="button" class="pl-clear" data-pl-clear>Clear filters</button>' : '');
}

function productRowHtml(ctx, p, {index, selected, draggable, selectMode}) {
  const esc = escOf(ctx);
  const d = ctx.data;
  const st = stockState(p);
  const sub = childName(d, p.category, p.subcategory);
  const cat = (d.categories || []).find(c => c.id === p.category);
  const hidden = p.visible === false;
  const n = esc(p.name);
  const first = index === 0;
  const del = canDelete('product', ctx.role, p), dup = canDuplicate('product', ctx.role, p);
  return `<li class="pl-row${selected ? ' is-selected' : ''}${hidden ? ' is-hidden' : ''}" data-sort-id="${esc(p.id)}" data-pl-id="${esc(p.id)}" ${first ? 'data-tour="row-first"' : ''}>
<label class="pl-check"><input type="checkbox" data-pl-select ${selected ? 'checked' : ''} aria-label="Select ${n}"></label>
${draggable ? dragHandle('Drag ' + p.name, {tour: first}) : ''}
<button type="button" class="pl-main" data-pl-open aria-label="${selectMode ? 'Select' : 'Edit'} ${n}"><span class="pl-img"><img src="${esc(ctx.imageUrl?.(p.image) || '')}" alt="" loading="lazy"></span><span class="pl-text"><b>${n}</b><small>${esc([p.brand, p.sku ? 'SKU ' + p.sku : ''].filter(Boolean).join(' · ') || 'No brand')}</small><small class="pl-cat">${esc(cat?.name || p.category)}${sub ? ' › ' + esc(sub) : ''}</small></span></button>
<span class="pl-price"><b>${money(p.sale > 0 ? p.sale : p.price)}</b>${p.sale > 0 ? `<del>${money(p.price)}</del>` : ''}<small class="pl-stock pl-stock--${st}">${st === 'out' ? 'Out of stock' : st === 'low' ? `Low · ${esc(p.quantity)} left` : p.quantity != null && p.quantity !== '' ? esc(p.quantity) + ' in stock' : 'In stock'}</small></span>
<span class="pl-toggles"><label class="mini-switch" title="Show on website"><input type="checkbox" data-pl-flag="visible" ${hidden ? '' : 'checked'} aria-label="${n} visible on website"><span>Visible</span></label><label class="mini-switch" title="In stock"><input type="checkbox" data-pl-flag="stock" ${st === 'out' ? '' : 'checked'} aria-label="${n} in stock"><span>In stock</span></label></span>
<span class="pl-actions" ${first ? 'data-tour="row-actions"' : ''}><button type="button" class="btn tiny ghost" data-pl-edit>Edit</button><details class="row-menu"><summary class="icon-button" aria-label="More for ${n}">…</summary><div class="row-menu__list">${dup ? '<button type="button" data-pl-act="duplicate">Duplicate</button>' : ''}${draggable ? '<button type="button" data-pl-act="top">Move to top</button><button type="button" data-pl-act="bottom">Move to bottom</button>' : ''}${del ? '<button type="button" class="danger-text" data-pl-act="delete">Delete…</button>' : ''}</div></details></span>
</li>`;
}

const BULK_PRODUCT = ['move', 'show', 'hide', 'feature', 'unfeature', 'price', 'sale', 'stock', 'brand', 'addToKit', 'addToSection', 'duplicate', 'delete'];

function bulkParamsHtml(ctx, action) {
  const esc = escOf(ctx);
  const d = ctx.data;
  switch (action) {
    case 'move': return `<select data-bk="category" aria-label="Move to category">${optionHtml(esc, (d.categories || []).map(c => [c.id, c.name]), (d.categories || [])[0]?.id || '')}</select><select data-bk="subcategory" aria-label="Subcategory">${optionHtml(esc, [['', 'No subcategory'], ...((d.categories || [])[0]?.children || []).filter(c => c && typeof c === 'object').map(c => [c.id, c.name])], '')}</select>`;
    case 'price': return `<select data-bk="mode" aria-label="Change by"><option value="pct">By percent (%)</option><option value="amount">By amount (৳)</option></select><input data-bk="delta" type="number" step="1" inputmode="numeric" placeholder="+10 or -5" aria-label="Change">`;
    case 'sale': return `<input data-bk="pct" type="number" min="1" max="99" step="1" inputmode="numeric" placeholder="Discount %" aria-label="Discount percent"><label class="pl-inline"><input type="checkbox" data-bk="remove"> Remove discount</label>`;
    case 'stock': return `<select data-bk="status" aria-label="Availability">${optionHtml(esc, STOCK.map(s => [s, s]), 'In stock')}</select><input data-bk="quantity" type="number" min="0" step="1" inputmode="numeric" placeholder="Quantity (optional)" aria-label="Quantity">`;
    case 'brand': return `<input data-bk="name" type="text" maxlength="100" list="pl-brand-list" placeholder="Brand name (empty clears)" aria-label="Brand"><datalist id="pl-brand-list">${brandOptions(d).map(b => `<option value="${esc(b)}">`).join('')}</datalist>`;
    case 'addToKit': return (d.kits || []).length ? `<select data-bk="kitId" aria-label="Bundle">${optionHtml(esc, d.kits.map(k => [k.id, k.name]), d.kits[0].id)}</select>` : '<span class="pl-note">No bundles yet. Add one under Bundles first.</span>';
    case 'addToSection': { const list = (d.sections || []).filter(s => s.source?.type === 'products'); return list.length ? `<select data-bk="sectionId" aria-label="Section">${optionHtml(esc, list.map(s => [s.id, s.title]), list[0].id)}</select>` : '<span class="pl-note">No hand-picked sections yet. Add one under Website → Layout.</span>'; }
    default: return '';
  }
}

function bulkValue(bar, action) {
  const v = n => bar.querySelector(`[data-bk="${n}"]`);
  switch (action) {
    case 'move': return {category: v('category')?.value, subcategory: v('subcategory')?.value || ''};
    case 'price': return {mode: v('mode')?.value, delta: v('delta')?.value === '' ? '' : Number(v('delta')?.value)};
    case 'sale': return v('remove')?.checked ? {pct: null} : {pct: v('pct')?.value === '' ? '' : Number(v('pct')?.value)};
    case 'stock': return {status: v('status')?.value, quantity: v('quantity')?.value === '' ? undefined : Number(v('quantity')?.value)};
    case 'brand': return {name: v('name')?.value || ''};
    case 'addToKit': return {kitId: v('kitId')?.value};
    case 'addToSection': return {sectionId: v('sectionId')?.value};
    default: return {};
  }
}

function bulkBarHtml(ctx, actions) {
  const esc = escOf(ctx);
  return `<div class="bulk-bar" data-tour="bulk-bar" data-bulk-bar hidden role="region" aria-label="Bulk actions">
<div class="bulk-bar__top"><b data-bulk-count>0 selected</b><button type="button" class="text-link" data-bulk-all>Select all</button><button type="button" class="text-link" data-bulk-none>Clear</button></div>
<div class="bulk-bar__row"><select data-bulk-action aria-label="Choose what to do"><option value="">Choose an action…</option>${actions.map(a => `<option value="${esc(a)}">${esc((ACTION_LABELS[a] || a).replace(/…$/, ''))}</option>`).join('')}</select><span class="bulk-bar__params" data-bulk-params></span><button type="button" class="btn primary" data-bulk-apply disabled>Apply</button></div>
<p class="bulk-bar__preview" data-bulk-preview aria-live="polite"></p></div>`;
}

export function mountProductList(ctx, el, {hash} = {}) {
  const esc = escOf(ctx);
  if (!el) return null;
  const fromHash = hash !== undefined ? parseListHash(hash) : null;
  const state = fromHash && (String(hash).includes('?') || !memory.state) ? fromHash : (memory.state || defaultListState());
  memory.state = state;
  const ids = new Set((ctx.data.products || []).map(p => p.id));
  for (const id of [...memory.selected]) if (!ids.has(id)) memory.selected.delete(id);
  const selected = memory.selected;
  let current = [];
  const flags = new Map();
  let flagTimer = 0, saving = Promise.resolve();

  el.innerHTML = `<div class="plist${memory.selectMode ? ' is-selecting' : ''}" data-plist>
<div class="plist__toolbar"><label class="search-box plist__search" data-tour="list-search">${ctx.icon?.('search') || ''}<input type="search" data-pl-search value="${esc(state.q)}" placeholder="Search name, brand, SKU or tag…" aria-label="Search products"></label>
<label class="plist__sort" data-tour="sort"><span class="sr-only">Sort</span><select data-pl-sort aria-label="Sort products">${optionHtml(esc, SORTS, state.sort)}</select></label>
<button type="button" class="btn ghost plist__select" data-pl-selectmode data-tour="select-toggle" aria-pressed="${memory.selectMode}">Select</button></div>
<div class="plist__filters" data-tour="filter-bar" data-pl-filters></div>
<div class="plist__meta"><span data-pl-count aria-live="polite"></span><span data-pl-draghint></span></div>
<div class="plist__head" aria-hidden="true"><span></span><span>Product</span><span>Customer pays</span><span>On website</span><span></span></div>
<ol class="plist__rows" data-tour="list" data-pl-rows></ol>
<button type="button" class="btn ghost plist__more" data-tour="show-more" data-pl-more hidden></button>
${bulkBarHtml(ctx, BULK_PRODUCT.filter(a => a !== 'delete' || canDelete('product', ctx.role)).filter(a => a !== 'duplicate' || canDuplicate('product', ctx.role)))}
</div>`;
  const root = el.querySelector('[data-plist]');
  const rowsEl = root.querySelector('[data-pl-rows]');
  const bar = root.querySelector('[data-bulk-bar]');

  const syncHash = () => {
    try { if (/^#products(\?|$)/.test(location.hash) || location.hash === '' ) history.replaceState(history.state, '', listHash(state)); } catch { /* sandboxed */ }
  };
  const draggable = () => canDragProducts(state) && !memory.selectMode;
  const paintFilters = () => { root.querySelector('[data-pl-filters]').innerHTML = filterBarHtml(ctx, state); };
  const paintRows = () => {
    current = sortProducts(ctx.data, filterProducts(ctx.data, state), state.sort);
    const shown = current.slice(0, memory.shown);
    const drag = draggable();
    rowsEl.innerHTML = shown.length ? shown.map((p, i) => productRowHtml(ctx, p, {index: i, selected: selected.has(p.id), draggable: drag, selectMode: memory.selectMode})).join('') : `<li class="plist__empty">${activeFilters(state) ? 'Nothing found. Try another word or clear the filters.' : 'No products yet. Tap Add product to put the first one on your shelf.'}</li>`;
    if (drag) rowsEl.setAttribute('data-sortable-products', ''); else rowsEl.removeAttribute('data-sortable-products');
    const total = (ctx.data.products || []).length;
    root.querySelector('[data-pl-count]').textContent = current.length === total ? `${plural(total, 'product', 'products')}` + (shown.length < current.length ? ` · showing ${shown.length}` : '') : `Showing ${shown.length} of ${current.length} matching · ${total} in total`;
    root.querySelector('[data-pl-draghint]').textContent = drag ? 'Drag the handle to change the order customers see.' : '';
    const more = root.querySelector('[data-pl-more]');
    const left = current.length - shown.length;
    more.hidden = left <= 0;
    more.textContent = `Show more (${left} more)`;
    paintBar();
  };
  const paintBar = () => {
    const n = selected.size;
    bar.hidden = !(n || memory.selectMode);
    bar.querySelector('[data-bulk-count]').textContent = n ? plural(n, 'product', 'products') + ' selected' : 'Tap products to select them';
    const all = bar.querySelector('[data-bulk-all]');
    all.textContent = `Select all ${current.length} shown`;
    all.hidden = !current.length || current.every(p => selected.has(p.id));
    bar.querySelector('[data-bulk-none]').textContent = n ? 'Clear' : 'Done';
    preview();
  };
  const refresh = () => { paintFilters(); paintRows(); syncHash(); };
  const setFilter = (k, v) => { state[k] = v; if (k === 'cat') state.sub = ''; memory.shown = PAGE_SIZE; refresh(); };

  // Bulk preview / apply
  const preview = () => {
    const action = bar.querySelector('[data-bulk-action]').value;
    const out = bar.querySelector('[data-bulk-preview]');
    const apply = bar.querySelector('[data-bulk-apply]');
    out.textContent = ''; out.classList.remove('is-error');
    apply.disabled = !action || !selected.size;
    if (!action || !selected.size || action === 'delete' || action === 'duplicate') return;
    try {
      const pv = previewBulk(ctx.data, [...selected], action, bulkValue(bar, action));
      const failedText = pv.failed.length ? ` ${plural(pv.failed.length, 'product', 'products')} will be skipped: ${pv.failed.slice(0, 3).map(f => `${f.name} (${f.reason})`).join('; ')}${pv.failed.length > 3 ? '…' : ''}` : '';
      out.textContent = (action === 'price' || action === 'sale' ? priceSummary(pv) + '.' : `${plural(pv.changed, 'product', 'products')} will change.`) + failedText;
      if (!pv.changed) apply.disabled = true;
    } catch (err) {
      apply.disabled = true;
      if (err?.code === 'invalid-value') { out.textContent = err.message; out.classList.add('is-error'); }
    }
  };
  const applyAction = async () => {
    const action = bar.querySelector('[data-bulk-action]').value;
    const list = [...selected];
    if (!action || !list.length) return;
    if (action === 'delete') {
      const ok = await confirmDialog(ctx, {kicker: 'DELETE PRODUCTS', title: `Delete ${plural(list.length, 'product', 'products')}?`, message: 'They are also taken out of bundles and hand-picked sections. Live site changes only when you publish. Version history can bring them back.', confirmLabel: 'Delete ' + plural(list.length, 'product', 'products'), cancelLabel: 'Keep them', danger: true});
      if (!ok) return;
    }
    const value = bulkValue(bar, action);
    try {
      const {next, changed, failed} = applyBulk(ctx.data, list, action, value);
      if (!changed) { ctx.toast?.(failed.length ? `Nothing changed: ${failed[0].reason}` : 'Nothing to change.'); return; }
      checkDocument(ctx, next);
      const label = bulkLabel(ctx.data, action, value, changed);
      bar.querySelector('[data-bulk-apply]').disabled = true;
      // ctx.save re-renders the page and remounts this list from the shared selection, so empty it
      // first (and put it back when the save fails).
      selected.clear();
      try { await ctx.save(next, label); } catch (e) { list.forEach(id => selected.add(id)); throw e; }
      if (failed.length) ctx.toast?.(`${label}. Skipped ${failed.length}: ${failed.slice(0, 2).map(f => f.name).join(', ')}${failed.length > 2 ? '…' : ''}`, {undo: true});
      bar.querySelector('[data-bulk-action]').value = '';
      bar.querySelector('[data-bulk-params]').innerHTML = '';
      if (root.isConnected) refresh();
    } catch (err) {
      const out = bar.querySelector('[data-bulk-preview]');
      out.textContent = err?.detail || err?.message || 'Could not apply this change.'; out.classList.add('is-error');
    }
  };

  // Inline Visible / In stock toggles: one debounced save.
  const queueFlag = (id, flag, on) => {
    const entry = flags.get(id) || {};
    entry[flag] = on;
    flags.set(id, entry);
    clearTimeout(flagTimer);
    flagTimer = setTimeout(flushFlags, 800);
  };
  const flushFlags = () => {
    if (!flags.size) return;
    const batch = new Map(flags);
    flags.clear();
    saving = saving.then(async () => {
      const next = structuredClone(ctx.data);
      let n = 0;
      for (const [id, f] of batch) {
        const p = next.products.find(x => x.id === id);
        if (!p) continue;
        let changed = false;
        if ('visible' in f && (p.visible !== false) !== f.visible) { p.visible = f.visible; changed = true; }
        if ('stock' in f) {
          const out = stockState(p) === 'out';
          if (f.stock && out) { p.stock = 'In stock'; if (p.quantity === 0) p.quantity = null; changed = true; }
          else if (!f.stock && !out) { p.stock = 'Out of stock'; changed = true; }
        }
        if (changed) { p.updatedAt = nowIso(); n++; }
      }
      if (!n) return;
      try { checkDocument(ctx, next); await ctx.save(next, `Updated ${plural(n, 'product', 'products')}`); }
      catch (err) { ctx.toast?.(err?.detail || err?.message || 'Could not save.'); }
      if (root.isConnected) paintRows();
    });
  };

  const toggleSelect = (id, on) => { if (on ?? !selected.has(id)) selected.add(id); else selected.delete(id); const row = rowsEl.querySelector(`[data-pl-id="${CSS.escape(id)}"]`); if (row) { row.classList.toggle('is-selected', selected.has(id)); const cb = row.querySelector('[data-pl-select]'); if (cb) cb.checked = selected.has(id); } paintBar(); };
  const setSelectMode = on => { memory.selectMode = on; root.classList.toggle('is-selecting', on); root.querySelector('[data-pl-selectmode]').setAttribute('aria-pressed', String(on)); if (!on) selected.clear(); paintRows(); };

  let searchTimer = 0;
  const onInput = e => {
    if (e.target.matches('[data-pl-search]')) { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = e.target.value.trim(); memory.shown = PAGE_SIZE; paintFilters(); paintRows(); syncHash(); }, 150); }
    else if (bar.contains(e.target)) preview();
  };
  const onChange = e => {
    const t = e.target;
    if (t.matches('[data-pl-filter]')) setFilter(t.dataset.plFilter, t.value);
    else if (t.matches('[data-pl-sort]')) { state.sort = t.value; refresh(); }
    else if (t.matches('[data-pl-select]')) toggleSelect(t.closest('[data-pl-id]').dataset.plId, t.checked);
    else if (t.matches('[data-pl-flag]')) {
      const row = t.closest('[data-pl-id]');
      queueFlag(row.dataset.plId, t.dataset.plFlag, t.checked);
      if (t.dataset.plFlag === 'visible') row.classList.toggle('is-hidden', !t.checked);
    } else if (t.matches('[data-bulk-action]')) { bar.querySelector('[data-bulk-params]').innerHTML = bulkParamsHtml(ctx, t.value); preview(); }
    else if (t.matches('[data-bk="category"]')) {
      const cat = (ctx.data.categories || []).find(c => c.id === t.value);
      bar.querySelector('[data-bk="subcategory"]').innerHTML = optionHtml(esc, [['', 'No subcategory'], ...(cat?.children || []).filter(c => c && typeof c === 'object').map(c => [c.id, c.name])], '');
      preview();
    } else if (bar.contains(t)) preview();
  };
  const onClick = async e => {
    const t = e.target;
    const menu = t.closest('details.row-menu');
    closeMenus(root, menu);
    if (t.closest('[data-pl-toggle]')) { const k = t.closest('[data-pl-toggle]').dataset.plToggle; setFilter(k, !state[k]); return; }
    if (t.closest('[data-pl-clear]')) { Object.assign(state, defaultListState(), {sort: state.sort}); root.querySelector('[data-pl-search]').value = ''; memory.shown = PAGE_SIZE; refresh(); return; }
    if (t.closest('[data-pl-more]')) { memory.shown += PAGE_SIZE; paintRows(); rowsEl.children[memory.shown - PAGE_SIZE]?.querySelector('[data-pl-open]')?.focus(); return; }
    if (t.closest('[data-pl-selectmode]')) { setSelectMode(!memory.selectMode); return; }
    if (t.closest('[data-bulk-all]')) { current.forEach(p => selected.add(p.id)); paintRows(); return; }
    if (t.closest('[data-bulk-none]')) { if (selected.size) { selected.clear(); paintRows(); } else setSelectMode(false); return; }
    if (t.closest('[data-bulk-apply]')) { applyAction(); return; }
    const row = t.closest('[data-pl-id]');
    if (!row) return;
    const id = row.dataset.plId;
    if (t.closest('[data-pl-open]')) {
      if (memory.selectMode || (selected.size && matchMedia('(max-width: 760px)').matches)) toggleSelect(id);
      else ctx.openEditor?.('product', id);
      return;
    }
    if (t.closest('[data-pl-edit]')) { ctx.openEditor?.('product', id); return; }
    const act = t.closest('[data-pl-act]');
    if (!act) return;
    menu?.removeAttribute('open');
    if (act.dataset.plAct === 'duplicate') duplicateFlow(ctx, 'product', id);
    else if (act.dataset.plAct === 'delete') { const r = await deleteFlow(ctx, 'product', id); if (r) { selected.delete(id); if (root.isConnected) paintRows(); } }
    else if (act.dataset.plAct === 'top' || act.dataset.plAct === 'bottom') {
      try {
        const within = current.map(p => p.id);
        const {next, changed} = moveRecord(ctx.data, 'product', id, act.dataset.plAct, {within});
        if (changed) { checkDocument(ctx, next); await ctx.save(next, 'Reordered products'); if (root.isConnected) paintRows(); }
      } catch (err) { ctx.toast?.(err?.detail || err?.message || 'Could not move this product.'); }
    }
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  const offLong = longPress(rowsEl, '[data-pl-id]', row => { if (!memory.selectMode) setSelectMode(true); toggleSelect(row.dataset.plId, true); });
  const sortable = makeSortable(rowsEl, {item: '[data-pl-id]', disabled: () => !draggable(), onDrop: async ids => {
    try {
      const {next, changed} = reorderRecords(ctx.data, 'product', ids);
      if (!changed) return;
      checkDocument(ctx, next);
      const cat = (ctx.data.categories || []).find(c => c.id === state.cat);
      await ctx.save(next, `Reordered products in ${cat?.name || 'a category'}`);
      if (root.isConnected) paintRows();
    } catch (err) { ctx.toast?.(err?.detail || err?.message || 'Could not save the new order.'); paintRows(); }
  }});
  refresh();
  return {
    state, refresh,
    get selected() { return [...selected]; },
    destroy() { flushFlags(); clearTimeout(flagTimer); offLong(); sortable.destroy(); root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('click', onClick); },
  };
}

export function showProductsIn(ctx, categoryId, subId = '') {
  memory.state = {...defaultListState(), cat: categoryId || '', sub: categoryId ? subId || '' : ''};
  memory.shown = PAGE_SIZE;
  try { history.replaceState(history.state, '', listHash(memory.state)); } catch { /* fine */ }
  ctx.go?.('products', 'products');
}

// ── Generic record list (replaces ordered()) ─────────────────────────────────────────────────────
function recordMeta(ctx, type, r) {
  const d = ctx.data;
  switch (type) {
    case 'category': {
      const subs = (r.children || []).length;
      const n = (d.products || []).filter(p => p.category === r.id).length;
      return `${plural(subs, 'subcategory', 'subcategories')} · ${plural(n, 'product', 'products')}`;
    }
    case 'brand': return (d.brandGroups || []).find(g => g.id === r.group)?.name || 'No group';
    case 'brandGroup': { const n = (d.brands || []).filter(b => b.group === r.id).length; return plural(n, 'brand', 'brands'); }
    case 'vehicle': return [r.brand, r.type === 'car' ? 'Car' : 'Bike'].filter(Boolean).join(' · ');
    case 'kit': return plural((r.productIds || []).length, 'product', 'products');
    case 'banner': return 'Opens ' + (r.destination || 'Home');
    case 'menu': return 'Links to ' + (r.target || 'Home');
    default: return r.hint || r.description || r.page || '';
  }
}

function recordRowHtml(ctx, type, r, i, total, {sortable}) {
  const esc = escOf(ctx);
  const name = nameOf(type, r) || 'Untitled';
  const n = esc(name);
  const first = i === 0;
  const del = canDelete(type, ctx.role, r), dup = canDuplicate(type, ctx.role, r);
  const hidden = r.visible === false;
  const img = r.image ? ctx.imageUrl?.(r.image) : '';
  return `<li class="rl-row${hidden ? ' is-hidden' : ''}" data-sort-id="${esc(r.id)}" data-rl-id="${esc(r.id)}" ${first ? 'data-tour="row-first"' : ''}>
${del || dup || 'visible' in r ? `<label class="pl-check"><input type="checkbox" data-rl-select aria-label="Select ${n}"></label>` : '<span class="pl-check"></span>'}
${sortable ? dragHandle('Drag ' + name, {tour: first}) : ''}
${img ? `<img class="rl-art" src="${esc(img)}" alt="" loading="lazy">` : `<span class="rl-num">${String(i + 1).padStart(2, '0')}</span>`}
<button type="button" class="rl-text" data-rl-edit><b>${n}</b><small>${esc(recordMeta(ctx, type, r))}</small></button>
${hidden ? '<span class="badge-hidden">Hidden</span>' : ''}
<span class="rl-actions" ${first ? 'data-tour="row-actions"' : ''}>
${sortable ? `<span class="rl-arrows"><button type="button" class="icon-button" data-rl-move="up" aria-label="Move ${n} up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-rl-move="down" aria-label="Move ${n} down" ${i === total - 1 ? 'disabled' : ''}>↓</button></span>` : ''}
<button type="button" class="btn tiny ghost" data-rl-edit>Edit</button>
<details class="row-menu"><summary class="icon-button" aria-label="More for ${n}">…</summary><div class="row-menu__list">
${type === 'category' ? '<button type="button" data-rl-act="add-product">Add product here</button><button type="button" data-rl-act="view-products">View products</button>' : ''}
${dup ? '<button type="button" data-rl-act="duplicate">Duplicate</button>' : ''}
${sortable ? '<button type="button" data-rl-act="top">Move to top</button><button type="button" data-rl-act="bottom">Move to bottom</button>' : ''}
${del ? '<button type="button" class="danger-text" data-rl-act="delete">Delete…</button>' : ''}
</div></details></span></li>`;
}

export function renderRecordList(ctx, type, list, {sortable = true, empty = 'Nothing here yet.'} = {}) {
  const esc = escOf(ctx);
  const actions = ['show', 'hide', 'duplicate', 'delete'].filter(a => (a !== 'delete' || canDelete(type, ctx.role)) && (a !== 'duplicate' || canDuplicate(type, ctx.role)));
  return `<div class="rl" data-record-list="${esc(type)}">
<ol class="rl__rows" data-tour="list" ${sortable ? `data-sortable="${esc(type)}"` : ''} data-rl-rows>${list.length ? list.map((r, i) => recordRowHtml(ctx, type, r, i, list.length, {sortable})).join('') : `<li class="plist__empty">${esc(empty)}</li>`}</ol>
${list.length > 1 ? bulkBarHtml(ctx, actions) : ''}
</div>`;
}

export function bindRecordList(ctx, root) {
  const offs = [];
  for (const box of root.querySelectorAll('[data-record-list]')) {
    if (box._rl) continue;
    const type = box.dataset.recordList;
    const rowsEl = box.querySelector('[data-rl-rows]');
    const bar = box.querySelector('[data-bulk-bar]');
    const selected = new Set();
    const ids = () => [...rowsEl.querySelectorAll('[data-rl-id]')].map(r => r.dataset.rlId);
    const paintBar = () => {
      if (!bar) return;
      bar.hidden = !selected.size && !box.classList.contains('is-selecting');
      bar.querySelector('[data-bulk-count]').textContent = selected.size ? `${selected.size} selected` : 'Tap rows to select them';
      const all = bar.querySelector('[data-bulk-all]');
      all.textContent = `Select all ${ids().length}`;
      all.hidden = ids().every(id => selected.has(id));
      bar.querySelector('[data-bulk-none]').textContent = selected.size ? 'Clear' : 'Done';
      bar.querySelector('[data-bulk-apply]').disabled = !selected.size || !bar.querySelector('[data-bulk-action]').value;
      bar.querySelector('[data-bulk-preview]').textContent = '';
    };
    const toggle = (id, on) => {
      if (on ?? !selected.has(id)) selected.add(id); else selected.delete(id);
      const row = rowsEl.querySelector(`[data-rl-id="${CSS.escape(id)}"]`);
      if (row) { row.classList.toggle('is-selected', selected.has(id)); const cb = row.querySelector('[data-rl-select]'); if (cb) cb.checked = selected.has(id); }
      paintBar();
    };
    const setAll = on => { ids().forEach(id => toggle(id, on)); if (!on) box.classList.remove('is-selecting'); paintBar(); };
    const apply = async () => {
      const action = bar.querySelector('[data-bulk-action]').value;
      const list = [...selected];
      if (!action || !list.length) return;
      const spec = COLLECTIONS[type];
      const out0 = bar.querySelector('[data-bulk-preview]');
      out0.textContent = ''; out0.classList.remove('is-error');
      if (action === 'delete') {
        // Check first: a category that still has products needs a new home for them, which only the
        // single delete dialog can ask for. Never promise "fixed for you" when it cannot complete.
        const stuck = list.map(id => ({id, record: getRecord(ctx.data, type, id)})).filter(x => x.record && references(ctx.data, type, x.id).some(r => r.fix === 'block')).map(x => ({id: x.id, name: nameOf(type, x.record)}));
        const stuckIds = new Set(stuck.map(f => f.id));
        if (stuck.length) {
          if (stuck.length === 1 && list.length === 1) { await deleteFlow(ctx, type, stuck[0].id); return; }
          const count = id => (ctx.data.products || []).filter(p => (type === 'category' ? p.category === id : false)).length;
          const lines = stuck.map(f => { const n = count(f.id); return type === 'category' && n ? `${f.name} has ${n} product${n === 1 ? '' : 's'}.` : `${f.name} is still in use.`; });
          const rest = list.filter(id => !stuckIds.has(id));
          const msg = `${lines.join(' ')} Delete ${stuck.length === 1 ? 'it' : 'each one'} on its own (row menu ··· → Delete) to choose where ${type === 'category' ? (stuck.length === 1 ? 'they move' : 'its products move') : 'its items move'}.`;
          if (!rest.length) { ctx.toast?.(msg); out0.textContent = msg; out0.classList.add('is-error'); return; }
          if (!(await confirmDialog(ctx, {kicker: 'DELETE ' + (spec?.plural || 'items').toUpperCase(), title: `Delete ${rest.length} of ${list.length} ${spec?.plural}?`, message: `${msg} The other ${rest.length} can be deleted now; anything that uses them is fixed for you. Live site changes only when you publish.`, confirmLabel: `Delete ${rest.length}`, cancelLabel: 'Keep them', danger: true}))) return;
          list.splice(0, list.length, ...rest);
        } else if (!(await confirmDialog(ctx, {kicker: 'DELETE ' + (spec?.plural || 'items').toUpperCase(), title: `Delete ${list.length} ${list.length === 1 ? spec?.label : spec?.plural}?`, message: 'Anything that uses them is fixed for you. Live site changes only when you publish. Version history can bring them back.', confirmLabel: 'Delete', cancelLabel: 'Keep them', danger: true}))) return;
      }
      try {
        const {next, changed, failed} = applyBulk(ctx.data, list, action, {}, {type});
        const out = bar.querySelector('[data-bulk-preview]');
        if (!changed) { const m = failed[0] ? `Nothing changed: ${failed[0].name} – ${failed[0].reason === 'needs-reassign' ? 'it is still in use. Delete it on its own to choose where its items move.' : failed[0].reason}` : 'Nothing to change.'; out.textContent = m; out.classList.add('is-error'); ctx.toast?.(m); return; }
        checkDocument(ctx, next);
        selected.clear();
        try { await ctx.save(next, bulkLabel(ctx.data, action, {}, changed, type)); } catch (e) { list.forEach(id => selected.add(id)); throw e; }
        if (failed.length) ctx.toast?.(`Skipped ${failed.length}: ${failed.slice(0, 2).map(f => `${f.name} (${f.reason})`).join('; ')}`);
        if (box.isConnected) paintBar();
      } catch (err) {
        const out = bar.querySelector('[data-bulk-preview]');
        out.textContent = err?.detail || err?.message || 'Could not apply this change.'; out.classList.add('is-error');
      }
    };
    const onClick = async e => {
      const t = e.target;
      const menu = t.closest('details.row-menu');
      closeMenus(box, menu);
      if (bar && bar.contains(t)) {
        if (t.closest('[data-bulk-all]')) setAll(true);
        else if (t.closest('[data-bulk-none]')) setAll(false);
        else if (t.closest('[data-bulk-apply]')) apply();
        return;
      }
      const row = t.closest('[data-rl-id]');
      if (!row) return;
      const id = row.dataset.rlId;
      if (t.closest('[data-rl-edit]')) { if (box.classList.contains('is-selecting')) toggle(id); else ctx.openEditor?.(type, id); return; }
      const mv = t.closest('[data-rl-move]');
      const act = t.closest('[data-rl-act]');
      const where = mv?.dataset.rlMove || (act && ['top', 'bottom'].includes(act.dataset.rlAct) ? act.dataset.rlAct : '');
      menu?.removeAttribute('open');
      if (where) {
        try {
          const {next, changed} = moveRecord(ctx.data, type, id, where, {within: ids()});
          if (changed) { checkDocument(ctx, next); await ctx.save(next, 'Reordered ' + (COLLECTIONS[type]?.plural || 'items')); }
        } catch (err) { ctx.toast?.(err?.detail || err?.message || 'Could not move this item.'); }
        return;
      }
      if (!act) return;
      if (act.dataset.rlAct === 'duplicate') duplicateFlow(ctx, type, id);
      else if (act.dataset.rlAct === 'delete') deleteFlow(ctx, type, id);
      else if (act.dataset.rlAct === 'add-product') ctx.openEditor?.('product', 'new', {defaults: {category: id}});
      else if (act.dataset.rlAct === 'view-products') showProductsIn(ctx, id);
    };
    const onChange = e => {
      if (e.target.matches('[data-rl-select]')) toggle(e.target.closest('[data-rl-id]').dataset.rlId, e.target.checked);
      else if (bar && e.target.matches('[data-bulk-action]')) paintBar();
    };
    box.addEventListener('click', onClick);
    box.addEventListener('change', onChange);
    const offLong = longPress(rowsEl, '[data-rl-id]', row => { box.classList.add('is-selecting'); toggle(row.dataset.rlId, true); });
    const sort = bindSortable(ctx, box);
    box._rl = true;
    offs.push(() => { box.removeEventListener('click', onClick); box.removeEventListener('change', onChange); offLong(); sort.destroy(); box._rl = false; });
  }
  return {destroy() { offs.forEach(f => f()); }};
}
