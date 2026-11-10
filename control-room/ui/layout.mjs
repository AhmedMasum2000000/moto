// Website > Layout tab and the section editor (plan role I5).
// The Layout tab lists the homepage or shop structure in layout order: pinned built-ins (greyed),
// movable built-ins (lock badge: hide and move, never delete) and generated sections (edit, duplicate,
// delete). Every change is one ctx.save(next, label); the document is validated first.
//
// Exports
//   renderLayout(ctx, page?) → html          the tab body (page chips, rows, Add section, Preview draft)
//   bindLayout(ctx, root)                     wires the tab (chips, visible switches, arrows, drag, actions)
//   openAddSection(ctx, page?, after?)        the kind-card modal ([data-tour="section-kinds"])
//   sectionDefaults(doc, {page, preset})      a new section record (preset: a KIND_PRESETS id)
//   sectionFields(ctx, record, {isNew}) → html  editor body for openEditor('section')
//   bindSectionEditor(ctx, root, record)      live count, source switch, picker, FAQ repeater, preview
//   readSectionForm(ctx, form, record, {isNew}) → {next, section, label}   (pure apart from reading the form)
//   saveSectionForm(ctx, form, record, {isNew}) → Promise                  validate + ctx.save
//   layoutRows(doc, page) → [{ref, type, id, title, summary, visible, pinned, locked, kind}]
//   sourceSummary(doc, section) → "Category: Engine oil · 12 newest"
//   renderStructureCard(ctx) → html           home() "Your website structure" card ([data-tour="home-structure"])
//   layoutPage() / setLayoutPage(page)        the page shown by the tab
import {normalise, resolveLayout, BUILTINS, PINNED_TOP, PINNED_BOTTOM, PAGES, PRODUCT_KINDS, SORTS, LIMITS, newId, childName} from '../../cms/content-model.mjs';
import {selectProducts, markdown} from '../../cms/sections.mjs';
import {deleteRecord, duplicateRecord, reorderLayout, moveLayoutRef} from '../lib/records.mjs';
import {validateContent} from '../../supabase/functions/moto-admin/schema.mjs';

const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const E = ctx => ctx?.esc || escHtml;
const editors = role => role === 'owner' || role === 'editor';
const PAGE_NAMES = {index: 'Homepage', shop: 'Shop'};
const PAGE_FILES = {index: 'index.html', shop: 'shop.html'};

// Friendly names for the built-in parts (the content entry name is used when there is one).
const BUILTIN_INFO = {
  'index-fitment': ['Hero & ride tools', 'Always first on the homepage'],
  'index-popular': ['Popular products', 'Built-in product carousel'],
  'index-brands': ['Homepage categories', 'Built-in category cards'],
  'index-services': ['Servicing', 'Built-in service cards'],
  'index-dealer': ['Official dealer', 'Built-in brand groups'],
  'index-brand-partners': ['Brands we carry', 'Built-in logo strip'],
  'index-section-5': ['Footer', 'Always last'],
  'shop-section-1': ['Shop heading', 'Always first in the shop'],
  'shop-finder': ['Bike & car model search', 'Always near the top'],
  'shop-catalog': ['All products', 'Built-in product grid with filters'],
  'shop-kits': ['Bundles', 'Built-in bundle list'],
  'shop-partners': ['Brand partners', 'Built-in logo strip'],
  'shop-section-2': ['Footer', 'Always last'],
};

export const KIND_LABELS = {carousel: 'Product carousel', grid: 'Product grid', categories: 'Category tiles', kits: 'Bundles', brands: 'Brand strip', promo: 'Promo banner', faq: 'FAQ', text: 'Text'};
// Presets: "Deals", "New arrivals" and "Hand-picked" are a kind plus a source, not separate kinds.
export const KIND_PRESETS = [
  {id: 'carousel', kind: 'carousel', label: 'Product carousel', hint: 'A sliding row of products from a category, brand or your pick.', title: 'Top picks', source: 'category', sort: 'featured'},
  {id: 'grid', kind: 'grid', label: 'Product grid', hint: 'Products in rows of cards.', title: 'Shop the range', source: 'category', sort: 'featured'},
  {id: 'deals', kind: 'carousel', label: 'Deals', hint: 'Everything on sale, biggest saving first.', title: 'Deals', source: 'sale', sort: 'save'},
  {id: 'newest', kind: 'carousel', label: 'New arrivals', hint: 'Your most recently edited products.', title: 'New arrivals', source: 'newest', sort: 'newest'},
  {id: 'handpicked', kind: 'grid', label: 'Hand-picked', hint: 'Choose the exact products and their order.', title: 'Hand-picked for you', source: 'products', sort: 'manual'},
  {id: 'categories', kind: 'categories', label: 'Category tiles', hint: 'Picture tiles linking to categories or subcategories.', title: 'Shop by category'},
  {id: 'kits', kind: 'kits', label: 'Bundles', hint: 'Your product bundles with one price.', title: 'Bundles'},
  {id: 'brands', kind: 'brands', label: 'Brand strip', hint: 'The logos of one brand group.', title: 'Brands we carry'},
  {id: 'promo', kind: 'promo', label: 'Promo banner', hint: 'A picture with a heading, text and a button.', title: 'Special offer'},
  {id: 'faq', kind: 'faq', label: 'FAQ', hint: 'Questions and answers customers can open.', title: 'Questions & answers'},
  {id: 'text', kind: 'text', label: 'Text', hint: 'Paragraphs, headings and lists.', title: 'About us'},
];
const SOURCE_LABELS = {category: 'Category', subcategory: 'Subcategory', brand: 'Brand', products: 'Pick products', sale: 'On sale', featured: 'Featured', newest: 'Newest', all: 'All products'};
const SORT_LABELS = {manual: 'As listed', featured: 'Featured first', low: 'Price: low to high', high: 'Price: high to low', save: 'Biggest saving', newest: 'Newest first'};

const KIND_SVG = {
  carousel: '<rect x="6" y="6" width="12" height="12"/><path d="M3 8v8M21 8v8"/>',
  grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  deals: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7" cy="7" r="1"/>',
  newest: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  handpicked: '<path d="m4 12 5 5L20 6"/>',
  categories: '<path d="M3 6h7l2 3h9v11H3z"/>',
  kits: '<path d="m3 7 9-4 9 4v11l-9 4-9-4zM3 7l9 4 9-4M12 11v11"/>',
  brands: '<rect x="3" y="8" width="5" height="8"/><rect x="10" y="8" width="5" height="8"/><rect x="17" y="8" width="4" height="8"/>',
  promo: '<rect x="3" y="5" width="18" height="14"/><path d="m3 15 5-5 4 4 3-3 6 6"/>',
  faq: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17v.5"/>',
  text: '<path d="M4 6h16M4 10h16M4 14h10M4 18h12"/>',
  builtin: '<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18"/>',
  lock: '<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true">${KIND_SVG[name] || KIND_SVG.builtin}</svg>`;

let currentPage = 'index';
export const layoutPage = () => currentPage;
export function setLayoutPage(page) { if (PAGES.includes(page)) currentPage = page; return currentPage; }

// ── pure helpers ──────────────────────────────────────────────────────────────────────────────
// doc0: a fresh normalised clone (safe to change and save). view: a cached read-only copy for
// rendering and live counts, so typing in the editor does not clone a large document per keystroke.
const doc0 = ctx => normalise(ctx.data);
let viewMemo = {src: null, doc: null};
const view = ctx => { const src = ctx.data; if (viewMemo.src !== src) viewMemo = {src, doc: normalise(src)}; return viewMemo.doc; };
const contentEntry = (doc, id) => (doc.content || []).find(c => c.id === id);
const brandLabel = (doc, name) => (doc.brands || []).find(b => b.name.trim().toLowerCase() === String(name || '').trim().toLowerCase())?.name || name || '';
const categoryLabel = (doc, id) => (doc.categories || []).find(c => c.id === id)?.name || '';

export function sourceSummary(doc, section) {
  const s = section?.source;
  const n = Number(section?.limit) || LIMITS.defaultLimit;
  const sort = section?.sort && section.sort !== 'manual' ? ' · ' + SORT_LABELS[section.sort].toLowerCase() : '';
  if (!PRODUCT_KINDS.includes(section?.kind)) {
    if (section?.kind === 'categories') return section.category ? 'Subcategories of ' + (categoryLabel(doc, section.category) || 'a category') : 'All categories';
    if (section?.kind === 'kits') return section.kitIds?.length ? section.kitIds.length + ' chosen bundles' : 'All bundles';
    if (section?.kind === 'brands') return section.group ? 'Logos: ' + ((doc.brandGroups || []).find(g => g.id === section.group)?.name || 'a group') : 'All brand logos';
    if (section?.kind === 'faq') { const k = (section.items || []).length; return k + (k === 1 ? ' question' : ' questions'); }
    if (section?.kind === 'promo') return section.button?.label ? 'Button: ' + section.button.label : 'Picture and text';
    return 'Text';
  }
  if (!s) return 'Nothing chosen yet';
  let what;
  switch (s.type) {
    case 'category': what = 'Category: ' + (categoryLabel(doc, s.category) || 'missing'); break;
    case 'subcategory': what = 'Subcategory: ' + (childName(doc, s.category, s.subcategory) || 'missing'); break;
    case 'brand': what = 'Brand: ' + brandLabel(doc, s.brand); break;
    case 'products': return (s.productIds || []).length + ' hand-picked products';
    default: what = SOURCE_LABELS[s.type] || 'Products';
  }
  return `${what} · up to ${n}${sort}`;
}

export function layoutRows(input, page) {
  const doc = normalise(input);
  const row = (ref, extra) => ({ref, ...extra});
  const builtin = (id, pinned) => {
    const entry = contentEntry(doc, id), [name, hint] = BUILTIN_INFO[id] || [id, 'Built-in'];
    return row('builtin:' + id, {type: 'builtin', id, kind: 'builtin', title: entry?.name || name, summary: hint, visible: entry ? entry.visible !== false : true, pinned, locked: true, hasEntry: !!entry});
  };
  const top = PINNED_TOP[page].map(id => builtin(id, true));
  const bottom = PINNED_BOTTOM[page].map(id => builtin(id, true));
  const middle = resolveLayout(doc, page).map(ref => {
    const i = ref.indexOf(':'), type = ref.slice(0, i), id = ref.slice(i + 1);
    if (type === 'builtin') return builtin(id, false);
    const s = doc.sections.find(x => x.id === id);
    return row(ref, {type: 'section', id, kind: s.kind, title: s.title || KIND_LABELS[s.kind], summary: (KIND_LABELS[s.kind] || 'Section') + ' · ' + sourceSummary(doc, s), visible: s.visible !== false, pinned: false, locked: false, count: PRODUCT_KINDS.includes(s.kind) ? selectProducts(doc, s).length : null});
  });
  return [...top, ...middle, ...bottom];
}

export function sectionDefaults(input, {page = 'index', preset = 'carousel'} = {}) {
  const doc = normalise(input || {});
  const p = KIND_PRESETS.find(x => x.id === preset) || KIND_PRESETS[0];
  const firstCat = (doc.categories || [])[0]?.id || '';
  const s = {id: newId(), page: PAGES.includes(page) ? page : 'index', kind: p.kind, title: p.title, visible: true};
  if (PRODUCT_KINDS.includes(p.kind)) {
    s.limit = LIMITS.defaultLimit; s.sort = p.sort || 'featured';
    s.source = p.source === 'category' ? {type: 'category', category: firstCat} : p.source === 'products' ? {type: 'products', productIds: []} : {type: p.source};
    if (p.source === 'category' && !firstCat) s.source = {type: 'all'};
  }
  if (p.kind === 'brands') { const g = (doc.brandGroups || [])[0]; if (g) s.group = g.id; }
  if (p.kind === 'faq') s.items = []; // the editor starts with one blank question row
  if (p.kind === 'text') s.body = '';
  if (p.kind === 'promo') { s.heading = ''; s.text = ''; }
  return s;
}

// ── shared save ───────────────────────────────────────────────────────────────────────────────
let busy = false;
async function commit(ctx, next, label) {
  if (busy) return false;
  busy = true;
  try {
    validateContent(structuredClone(next));
    await ctx.save(next, label);
    return true;
  } catch (e) {
    ctx.toast?.(e?.detail || e?.message || 'Unable to save. Please try again.');
    return false;
  } finally { busy = false; }
}
// After a save the app re-renders the tab, so keyboard focus would fall back to <body>. Put it back
// on the same control of the same row (or the row's drag handle when that arrow is now disabled).
function refocus(ref, how, dir) {
  const find = () => {
    const row = [...document.querySelectorAll('[data-lay-root] [data-lay-row]')].find(r => r.dataset.layRow === ref);
    if (!row) return null;
    if (how === 'move') { const b = row.querySelector(`[data-lay-move][data-dir="${dir}"]`); if (b && !b.disabled) return b; }
    if (how === 'visible') { const v = row.querySelector('[data-lay-visible]'); if (v) return v; }
    return row.querySelector('[data-lay-handle]') || row.querySelector('[data-lay-move]:not([disabled])');
  };
  const go = () => { const el = find(); if (el) { el.focus({preventScroll: false}); return true; } return false; };
  if (!go()) requestAnimationFrame(() => { if (!go()) setTimeout(go, 60); });
}
const closeDialog = el => { const d = el?.closest?.('dialog'); if (d?.open) d.close(); };

// ── Layout tab ────────────────────────────────────────────────────────────────────────────────
export function renderLayout(ctx, page = currentPage) {
  const esc = E(ctx), doc = view(ctx), canEdit = editors(ctx.role);
  setLayoutPage(page);
  const rows = layoutRows(doc, page);
  let firstMovable = true;
  const list = rows.map((r, i) => {
    const movable = !r.pinned && canEdit;
    const marks = movable && firstMovable ? (firstMovable = false, true) : false;
    const pos = rows.filter(x => !x.pinned).indexOf(r), last = rows.filter(x => !x.pinned).length - 1;
    const visibleSwitch = r.pinned || (r.type === 'builtin' && !r.hasEntry) ? '' : `<label class="lay-switch" title="Show on the website"><span class="sr-only">Show ${esc(r.title)} on the website</span><input type="checkbox" data-lay-visible="${esc(r.ref)}" ${r.visible ? 'checked' : ''} ${canEdit ? '' : 'disabled'}></label>`;
    const actions = r.pinned
      ? (r.hasEntry && canEdit ? `<button class="btn tiny ghost" type="button" data-lay-edit="${esc(r.ref)}">Edit</button>` : '')
      : `<button class="icon-button lay-arrow" type="button" data-lay-move="${esc(r.ref)}" data-dir="up" aria-label="Move ${esc(r.title)} up" ${pos <= 0 || !canEdit ? 'disabled' : ''}>↑</button><button class="icon-button lay-arrow" type="button" data-lay-move="${esc(r.ref)}" data-dir="down" aria-label="Move ${esc(r.title)} down" ${pos >= last || !canEdit ? 'disabled' : ''}>↓</button>${canEdit && (r.type === 'section' || r.hasEntry) ? `<button class="btn tiny ghost" type="button" data-lay-edit="${esc(r.ref)}">Edit</button>` : ''}${r.type === 'section' && canEdit ? `<button class="btn tiny ghost" type="button" data-lay-duplicate="${esc(r.id)}">Duplicate</button><button class="btn tiny ghost lay-danger" type="button" data-lay-delete="${esc(r.id)}">Delete</button>` : ''}`;
    const badge = r.pinned ? `<span class="lay-badge">${svg('lock')} Fixed</span>` : r.locked ? `<span class="lay-badge">${svg('lock')} Built-in</span>` : '';
    const empty = r.count === 0 ? ' <span class="lay-warn">Nothing to show yet</span>' : '';
    return `<div class="lay-row${r.pinned ? ' is-pinned' : ''}${r.visible ? '' : ' is-hidden'}" data-lay-row="${esc(r.ref)}" ${movable ? 'data-lay-movable' : ''}>${movable ? `<button class="lay-handle" type="button" data-lay-handle aria-label="Drag ${esc(r.title)}" ${marks ? 'data-tour="drag-handle"' : ''}>${svg('grip')}</button>` : '<span class="lay-handle is-off" aria-hidden="true"></span>'}<span class="lay-kind" aria-hidden="true">${svg(r.type === 'builtin' ? 'builtin' : r.kind)}</span><div class="lay-text"><h3>${esc(r.title)} ${badge}</h3><p>${esc(r.summary)}${r.visible ? '' : ' · Hidden'}${empty}</p></div><div class="lay-actions" ${marks ? 'data-tour="row-actions"' : ''}>${visibleSwitch}${actions}</div></div>`;
  }).join('');
  const count = doc.sections.length;
  return `<div class="lay" data-lay-root data-page="${esc(page)}">
 <div class="lay-top"><div class="lay-chips" role="group" aria-label="Choose a page" data-tour="layout-pages">${PAGES.map(p => `<button type="button" class="lay-chip${p === page ? ' active' : ''}" data-lay-page="${p}" aria-pressed="${p === page}">${PAGE_NAMES[p]}</button>`).join('')}</div>
 <div class="lay-tools"><button class="btn ghost" type="button" data-lay-preview data-tour="layout-preview">${svg('builtin')} Preview draft</button>${canEdit ? `<button class="btn primary" type="button" data-lay-add data-tour="layout-add" ${count >= LIMITS.sections ? 'disabled title="You have reached 60 sections"' : ''}>+ Add section</button>` : ''}</div></div>
 <p class="small-note">Top to bottom, this is your ${esc(PAGE_NAMES[page].toLowerCase())}. Drag a row or use the arrows to move it. Built-in parts can be hidden and moved; your own sections can also be edited, copied or deleted. Customers see changes after you publish.</p>
 <div class="lay-list" data-tour="layout-list" data-tour-list>${list}</div>
 ${canEdit ? `<button class="lay-add-wide" type="button" data-lay-add>+ Add section</button>` : ''}
</div>`;
}

export function renderStructureCard(ctx) {
  const esc = E(ctx), rows = layoutRows(view(ctx), 'index');
  return `<section class="panel lay-outline" data-tour="home-structure"><div class="panel-head"><h2>Your website structure</h2></div><ol>${rows.map(r => `<li class="${r.visible ? '' : 'is-hidden'}${r.pinned ? ' is-pinned' : ''}"><span>${esc(r.title)}</span><small>${r.type === 'section' ? esc(KIND_LABELS[r.kind] || '') : 'Built-in'}${r.visible ? '' : ' · Hidden'}</small></li>`).join('')}</ol><div class="lay-outline-actions">${editors(ctx.role) ? '<button class="btn tiny primary" type="button" data-lay-add data-page="index">+ Add section</button>' : ''}<button class="btn tiny ghost" type="button" data-lay-open>Open layout</button></div></section>`;
}

const rowsRoot = root => root?.matches?.('[data-lay-root]') ? root : root?.querySelector?.('[data-lay-root]');

export function bindLayout(ctx, root) {
  bindGlobal(ctx);
  const lay = rowsRoot(root);
  if (!lay || lay.dataset.bound) return;
  lay.dataset.bound = '1';
  const rerender = page => { const html = renderLayout(ctx, page); lay.outerHTML = html; bindLayout(ctx, root); };
  lay.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !lay.contains(b)) return;
    const page = lay.dataset.page;
    if (b.dataset.layPage) { rerender(b.dataset.layPage); return; }
    if (b.dataset.layMove) {
      const ref = b.dataset.layMove, dir = b.dataset.dir;
      const r = moveLayoutRef(doc0(ctx), page, ref, dir);
      if (r.changed) commit(ctx, r.next, `Reordered ${PAGE_NAMES[page].toLowerCase()}`).then(() => refocus(ref, 'move', dir));
      return;
    }
  });
  lay.addEventListener('change', e => {
    const input = e.target.closest('[data-lay-visible]');
    if (!input) return;
    const ref = input.dataset.layVisible, on = input.checked, d = doc0(ctx);
    const i = ref.indexOf(':'), type = ref.slice(0, i), id = ref.slice(i + 1);
    let name = id;
    if (type === 'builtin') { const c = d.content.find(c => c.id === id); if (!c) return; c.visible = on; name = c.name; }
    else { const s = d.sections.find(s => s.id === id); if (!s) return; s.visible = on; name = s.title; }
    commit(ctx, d, `${on ? 'Showed' : 'Hid'} ${name}`).then(ok => { if (!ok && input.isConnected) input.checked = !on; refocus(ref, 'visible'); });
  });
  bindDrag(ctx, lay);
}

// Drag to reorder: pointer events on the handle only (touch-action:none), auto-scroll near the
// viewport edges, one save on drop.
function bindDrag(ctx, lay) {
  const list = lay.querySelector('.lay-list');
  if (!list) return;
  list.addEventListener('pointerdown', e => {
    const handle = e.target.closest('[data-lay-handle]');
    if (!handle || e.button > 0) return;
    const row = handle.closest('[data-lay-row]');
    if (!row) return;
    e.preventDefault();
    const before = [...list.querySelectorAll('[data-lay-movable]')].map(r => r.dataset.layRow);
    row.classList.add('is-dragging');
    let lastY = e.clientY, scroller = 0;
    const place = y => {
      const rows = [...list.querySelectorAll('[data-lay-movable]')].filter(r => r !== row);
      let target = null;
      for (const r of rows) { const b = r.getBoundingClientRect(); if (y < b.top + b.height / 2) { target = r; break; } }
      if (target) { if (target.previousElementSibling !== row) target.before(row); }
      else { const lastMovable = rows[rows.length - 1]; if (lastMovable && lastMovable.nextElementSibling !== row) lastMovable.after(row); }
    };
    const tick = () => {
      const edge = 70, h = window.innerHeight;
      const dy = lastY < edge ? -12 : lastY > h - edge ? 12 : 0;
      if (dy) { window.scrollBy(0, dy); place(lastY); }
      scroller = requestAnimationFrame(tick);
    };
    scroller = requestAnimationFrame(tick);
    const move = ev => { lastY = ev.clientY; place(ev.clientY); };
    const up = () => {
      cancelAnimationFrame(scroller);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      row.classList.remove('is-dragging');
      const after = [...list.querySelectorAll('[data-lay-movable]')].map(r => r.dataset.layRow);
      if (after.join() === before.join()) return;
      const page = lay.dataset.page, r = reorderLayout(doc0(ctx), page, after);
      if (r.changed) commit(ctx, r.next, `Reordered ${PAGE_NAMES[page].toLowerCase()}`).then(() => refocus(row.dataset.layRow, 'handle'));
    };
    // Listen on window: moving the row in the DOM releases pointer capture on the handle.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  // Keyboard: Alt+ArrowUp / Alt+ArrowDown on a handle moves the row.
  list.addEventListener('keydown', e => {
    const handle = e.target.closest('[data-lay-handle]');
    if (!handle || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const ref = handle.closest('[data-lay-row]').dataset.layRow, page = lay.dataset.page;
    const r = moveLayoutRef(doc0(ctx), page, ref, e.key === 'ArrowUp' ? 'up' : 'down');
    if (r.changed) commit(ctx, r.next, `Reordered ${PAGE_NAMES[page].toLowerCase()}`).then(() => refocus(ref, 'handle'));
  });
}

// One document-level listener for buttons that also live in modals (kind cards, confirms) and on
// home(). The latest ctx is kept so it follows the Integrator's re-renders.
let globalCtx = null;
function bindGlobal(ctx) {
  const first = !globalCtx;
  globalCtx = ctx;
  if (!first || typeof document === 'undefined') return;
  document.addEventListener('click', e => {
    const b = e.target.closest?.('button,[data-lay-kind]');
    if (!b) return;
    const ctx = globalCtx, d = b.dataset;
    if (d.layAdd !== undefined) { e.preventDefault(); openAddSection(ctx, d.page || b.closest('[data-lay-root]')?.dataset.page || currentPage); return; }
    if (d.layOpen !== undefined) { setLayoutPage('index'); ctx.go('website', 'layout'); return; }
    if (d.layKind) {
      const page = d.page || currentPage, rec = sectionDefaults(ctx.data, {page, preset: d.layKind});
      closeDialog(b);
      ctx.openEditor('section', 'new', {defaults: rec, after: d.after || ''});
      return;
    }
    if (d.layPreview !== undefined) { openPreview(ctx, b.closest('[data-lay-root]')?.dataset.page || currentPage, d.layPreview); return; }
    if (d.layEdit) {
      const ref = d.layEdit, i = ref.indexOf(':'), type = ref.slice(0, i), id = ref.slice(i + 1);
      ctx.openEditor(type === 'builtin' ? 'content' : 'section', id);
      return;
    }
    if (d.layDuplicate) {
      try {
        const {next, copy} = duplicateRecord(doc0(ctx), 'section', d.layDuplicate);
        commit(ctx, next, `Duplicated section ${copy.title}`).then(ok => { if (ok) ctx.openEditor('section', copy.id, {duplicated: true}); });
      } catch (err) { ctx.toast?.(err.detail || err.message); }
      return;
    }
    if (d.layDelete) { confirmDelete(ctx, d.layDelete); return; }
    if (d.layConfirmDelete) {
      try {
        const {next} = deleteRecord(doc0(ctx), 'section', d.layConfirmDelete);
        const title = doc0(ctx).sections.find(s => s.id === d.layConfirmDelete)?.title || 'section';
        closeDialog(b);
        commit(ctx, next, `Deleted section ${title}`);
      } catch (err) { ctx.toast?.(err.detail || err.message); }
      return;
    }
    if (d.layCancel !== undefined) { closeDialog(b); return; }
  });
}

function confirmDelete(ctx, id) {
  const esc = E(ctx), s = view(ctx).sections.find(s => s.id === id);
  if (!s) return;
  ctx.modal({
    title: 'Delete this section?',
    mascot: true,
    body: `<h2>Delete “${esc(s.title)}”?</h2><p>The ${esc(KIND_LABELS[s.kind] || 'section').toLowerCase()} is removed from the ${esc(PAGE_NAMES[s.page].toLowerCase())}. The products in it are not touched.</p><p class="small-note">Live site changes only when you publish. Version history can bring it back.</p><div class="modal-footer"><button class="btn ghost" type="button" data-lay-cancel>Keep it</button><button class="btn primary lay-danger-fill" type="button" data-lay-confirm-delete="${esc(id)}">Delete section</button></div>`,
  });
}

export function openAddSection(ctx, page = currentPage, after = '') {
  bindGlobal(ctx);
  const esc = E(ctx);
  if (view(ctx).sections.length >= LIMITS.sections) { ctx.toast?.('You have reached 60 sections. Delete one before adding another.'); return; }
  ctx.modal({
    title: 'Add a section',
    mascot: true,
    body: `<h2>What should the new section show?</h2><p class="small-note">Pick one. I'll fill in sensible settings and you can change everything before saving. It goes on the ${esc(PAGE_NAMES[page].toLowerCase())}.</p><div class="lay-kinds" data-tour="section-kinds">${KIND_PRESETS.map(p => `<button type="button" class="lay-kind-card" data-lay-kind="${p.id}" data-page="${esc(page)}" data-after="${esc(after)}"><span class="lay-kind-icon">${svg(p.id === 'deals' || p.id === 'newest' || p.id === 'handpicked' ? p.id : p.kind)}</span><b>${esc(p.label)}</b><small>${esc(p.hint)}</small></button>`).join('')}</div>`,
  });
}

function openPreview(ctx, page, anchor = '') {
  const esc = E(ctx), file = PAGE_FILES[page] || 'index.html';
  const src = `../${file}?preview=draft${anchor ? '#' + encodeURIComponent(anchor) : ''}`;
  ctx.modal({title: 'Saved draft preview', body: `<h2>Your ${esc(PAGE_NAMES[page].toLowerCase())}, as saved.</h2><p class="small-note">This uses your saved draft. Unsaved form edits are not included.</p><div class="preview-window lay-preview"><iframe title="Saved draft of the ${esc(PAGE_NAMES[page])}" src="${esc(src)}"></iframe></div><a class="btn ghost" href="${esc(src)}" target="_blank" rel="noopener">Open in a new tab ↗</a>`});
}

// ── section editor ────────────────────────────────────────────────────────────────────────────
const targetsOf = doc => [
  ['', 'No button'], ['Home', 'Home'], ['Services', 'Services'], ['Contact', 'Contact'], ['Posts', 'Posts'],
  ...(doc.categories || []).map(c => [c.id, 'Shop · ' + c.name]),
  ...(doc.pages || []).map(p => ['page:' + p.id, 'Page · ' + p.name]),
  ...(doc.posts || []).map(p => ['post:' + p.id, 'Post · ' + p.name]),
];
const opts = (esc, list, value) => list.map(([v, t]) => `<option value="${esc(v)}" ${String(value ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');
const fieldHtml = (esc, name, label, value = '', extra = '') => `<div class="field"><label for="field-${name}">${esc(label)}</label><input id="field-${name}" name="${name}" value="${esc(value ?? '')}" ${extra}></div>`;
const areaHtml = (esc, name, label, value = '', extra = '') => `<div class="field"><label for="field-${name}">${esc(label)}</label><textarea id="field-${name}" name="${name}" rows="4" ${extra}>${esc(value ?? '')}</textarea></div>`;
const selectHtml = (esc, name, label, value, list, extra = '') => `<div class="field"><label for="field-${name}">${esc(label)}</label><select id="field-${name}" name="${name}" ${extra}>${opts(esc, list, value)}</select></div>`;
const subOptions = (doc, category) => visibleChildrenAll(doc, category).map(c => [c.id, c.name]);
const visibleChildrenAll = (doc, category) => ((doc.categories || []).find(c => c.id === category)?.children || []).filter(c => c && typeof c === 'object');
const faqRow = (esc, it = {}) => `<div class="lay-faq-row" data-faq-row><div class="field"><label>Question</label><input name="faq-q" maxlength="200" placeholder="For example: How long does an oil change take?" value="${esc(it.q || '')}"></div><div class="field"><label>Answer</label><textarea name="faq-a" rows="3" maxlength="1000" placeholder="The answer customers see when they open the question.">${esc(it.a || '')}</textarea></div><button class="btn tiny ghost" type="button" data-faq-remove>Remove question</button></div>`;
const pickRow = (ctx, p, i, n) => {
  const esc = E(ctx);
  return `<li data-pick-id="${esc(p.id)}"><img src="${esc(ctx.imageUrl ? ctx.imageUrl(p.image) : '')}" alt="" loading="lazy"><span>${esc(p.name)}<small>${esc(p.brand || '')}${p.sku ? ' · ' + esc(p.sku) : ''}</small></span><button class="icon-button" type="button" data-pick-move="-1" aria-label="Move ${esc(p.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-button" type="button" data-pick-move="1" aria-label="Move ${esc(p.name)} down" ${i === n - 1 ? 'disabled' : ''}>↓</button><button class="icon-button" type="button" data-pick-remove aria-label="Remove ${esc(p.name)}">×</button></li>`;
};

// "Position on the page" choices for one page. keep: offer "Keep its place" (an existing section that
// already sits on this page). value: the default for a new section (the bottom, or just before the
// bundles on the shop).
function afterChoices(doc, page, id, {keep = false} = {}) {
  const refs = resolveLayout(doc, page).filter(r => r !== 'section:' + id);
  const rowsNow = layoutRows(doc, page), refName = ref => rowsNow.find(x => x.ref === ref)?.title || ref;
  const list = [...(keep ? [['', 'Keep its place']] : []), ['__top', 'At the top'], ...refs.map(r => [r, 'After ' + refName(r)]), ['__bottom', 'At the bottom']];
  const k = refs.indexOf('builtin:shop-kits');
  const value = page === 'shop' && k >= 0 ? (k === 0 ? '__top' : refs[k - 1]) : '__bottom';
  return {list, value};
}

export function sectionFields(ctx, record, {isNew = false, after = ''} = {}) {
  const esc = E(ctx), doc = view(ctx), s = record || sectionDefaults(doc);
  const src = s.source || {type: 'category', category: doc.categories[0]?.id || ''};
  const cat = src.category || doc.categories[0]?.id || '';
  const page = s.page || currentPage;
  const {list: afterOpts, value: defaultAfter} = afterChoices(doc, page, s.id, {keep: !isNew});
  const afterValue = after || (isNew ? defaultAfter : '');
  const ids = src.productIds || [];
  const byId = new Map(doc.products.map(p => [p.id, p]));
  const picked = ids.map(id => byId.get(id)).filter(Boolean);
  const only = kinds => `data-sec-kinds="${kinds}"`;
  const types = ['category', 'subcategory', 'brand', 'products', 'sale', 'featured', 'newest', 'all'];
  return `<div class="sec-editor" data-sec-editor data-id="${esc(s.id)}">
 <input type="hidden" name="sectionId" value="${esc(s.id)}">
 <div class="sec-grid">${selectHtml(esc, 'kind', 'Section type', s.kind, Object.entries(KIND_LABELS))}${selectHtml(esc, 'page', 'Show on', page, PAGES.map(p => [p, PAGE_NAMES[p]]))}</div>
 ${fieldHtml(esc, 'title', 'Title', s.title, 'maxlength="150" required')}
 <div class="sec-grid">${fieldHtml(esc, 'label', 'Small label above the title (optional)', s.label, 'maxlength="60"')}${selectHtml(esc, 'after', 'Position on the page', afterValue, afterOpts)}</div>
 ${areaHtml(esc, 'intro', 'Introduction (optional)', s.intro, 'maxlength="500"')}
 <fieldset class="sec-group" ${only('carousel grid')}><legend>Products</legend>
  <div class="sec-source" role="radiogroup" aria-label="What the section shows" data-tour="section-source">${types.map(t => `<label class="sec-seg"><input type="radio" name="sourceType" value="${t}" ${src.type === t ? 'checked' : ''}><span>${SOURCE_LABELS[t]}</span></label>`).join('')}</div>
  <div class="sec-grid">
   <div data-src-for="category subcategory">${selectHtml(esc, 'sourceCategory', 'Category', cat, doc.categories.map(c => [c.id, c.name + (c.visible === false ? ' (hidden)' : '')]))}</div>
   <div data-src-for="subcategory">${selectHtml(esc, 'sourceSubcategory', 'Subcategory', src.subcategory || '', subOptions(doc, cat).length ? subOptions(doc, cat) : [['', 'This category has no subcategories']])}</div>
   <div data-src-for="brand">${selectHtml(esc, 'sourceBrand', 'Brand', brandLabel(doc, src.brand), doc.brands.map(b => [b.name, b.name]))}</div>
  </div>
  <div data-src-for="products" class="sec-picker" data-sec-picker>
   <input type="hidden" name="productIds" value="${esc(ids.join(','))}">
   <label class="search-box">${ctx.icon ? ctx.icon('search') : ''}<input type="search" data-pick-search aria-label="Find products to add" placeholder="Search name, brand or SKU…"></label>
   <ul class="sec-pick-results" data-pick-results></ul>
   <p class="sec-pick-count"><b data-pick-count>${picked.length}</b> of ${LIMITS.productIds} chosen. The order here is the order on the site.</p>
   <ol class="sec-picked" data-picked>${picked.map((p, i) => pickRow(ctx, p, i, picked.length)).join('')}</ol>
  </div>
  <div class="sec-grid"><div class="field"><label for="field-limit">How many products: <output data-limit-out>${esc(s.limit || LIMITS.defaultLimit)}</output></label><input id="field-limit" name="limit" type="range" min="1" max="${LIMITS.sectionLimit}" value="${esc(s.limit || LIMITS.defaultLimit)}"></div>${selectHtml(esc, 'sort', 'Order', s.sort || 'featured', SORTS.map(k => [k, SORT_LABELS[k]]))}</div>
  <p class="sec-count" data-sec-count data-tour="section-count" aria-live="polite"></p>
 </fieldset>
 <fieldset class="sec-group" ${only('categories')}><legend>Tiles</legend>${selectHtml(esc, 'tilesCategory', 'Show', s.category || '', [['', 'All categories'], ...doc.categories.map(c => [c.id, 'Subcategories of ' + c.name])])}</fieldset>
 <fieldset class="sec-group" ${only('kits')}><legend>Bundles</legend>${doc.kits.length ? `<p class="small-note">Tick the bundles to show. Leave all unticked to show every visible bundle.</p><div class="sec-checks">${doc.kits.map(k => `<label class="sec-check"><input type="checkbox" name="kitIds" value="${esc(k.id)}" ${(s.kitIds || []).includes(k.id) ? 'checked' : ''}> ${esc(k.name)}</label>`).join('')}</div>` : '<p class="small-note">No bundles yet. Add one under Products → Bundles; this section shows them automatically.</p>'}</fieldset>
 <fieldset class="sec-group" ${only('brands')}><legend>Logos</legend>${selectHtml(esc, 'group', 'Brand group', s.group || '', [['', 'All brands'], ...(doc.brandGroups || []).map(g => [g.id, g.name + (g.visible === false ? ' (hidden)' : '')])])}</fieldset>
 <fieldset class="sec-group" ${only('promo')}><legend>Banner</legend>${ctx.photoField ? ctx.photoField('image', 'Picture', s.image || '') : ''}${fieldHtml(esc, 'heading', 'Heading', s.heading, 'maxlength="150"')}${areaHtml(esc, 'text', 'Text', s.text, 'maxlength="500"')}</fieldset>
 <fieldset class="sec-group" ${only('carousel grid promo categories kits brands')}><legend>Button (optional)</legend><div class="sec-grid">${fieldHtml(esc, 'buttonLabel', 'Button text', s.button?.label, 'maxlength="40"')}${selectHtml(esc, 'buttonTarget', 'Button opens', s.button?.target || '', targetsOf(doc))}</div></fieldset>
 <fieldset class="sec-group" ${only('faq')}><legend>Questions</legend><div data-faq-list>${(s.items?.length ? s.items : [{}]).map(it => faqRow(esc, it)).join('')}</div><button class="btn ghost" type="button" data-faq-add>+ Add question</button><p class="small-note">Plain text only. Up to ${LIMITS.faqItems} questions.</p></fieldset>
 <fieldset class="sec-group" ${only('text')}><legend>Text</legend>${areaHtml(esc, 'body', 'Text', s.body, 'maxlength="5000" rows="8"')}<p class="small-note">Leave an empty line between paragraphs. Start a line with “## ” for a heading or “- ” for a list.</p><div class="sec-md" data-md-preview aria-live="polite"></div></fieldset>
 <label class="switch-row"><span>Show on the website<small>Hidden sections stay in the layout but customers don't see them.</small></span><input type="checkbox" name="visible" ${s.visible !== false ? 'checked' : ''}></label>
</div>`;
}

// A <form> (or an element inside one) or a ready FormData.
const fd = form => typeof FormData !== 'undefined' && form instanceof FormData ? form : new FormData(form.closest?.('form') || form);
// The section described by the form (no layout changes). Missing fields keep the record's values.
function sectionFromForm(doc, form, record) {
  const f = fd(form), get = k => f.has(k) ? String(f.get(k) ?? '') : null, t = k => (get(k) ?? '').trim();
  const kind = get('kind') || record.kind;
  const s = {id: record.id || get('sectionId') || newId(), page: PAGES.includes(get('page')) ? get('page') : record.page || 'index', kind, title: t('title') || record.title || '', visible: f.has('visible') || (!form.querySelector?.('[name=visible]') && record.visible !== false)};
  for (const k of ['label', 'intro']) if (t(k)) s[k] = t(k);
  const label = t('buttonLabel'), target = get('buttonTarget');
  if (PRODUCT_KINDS.includes(kind)) {
    const type = get('sourceType') || record.source?.type || 'all';
    const src = {type};
    if (type === 'category' || type === 'subcategory') src.category = get('sourceCategory') || record.source?.category || '';
    if (type === 'subcategory') src.subcategory = get('sourceSubcategory') || '';
    if (type === 'brand') src.brand = get('sourceBrand') || '';
    if (type === 'products') src.productIds = [...new Set((get('productIds') || '').split(',').filter(Boolean))].filter(id => doc.products.some(p => p.id === id)).slice(0, LIMITS.productIds);
    s.source = src;
    s.limit = Math.max(1, Math.min(LIMITS.sectionLimit, Math.round(Number(get('limit')) || LIMITS.defaultLimit)));
    s.sort = SORTS.includes(get('sort')) ? get('sort') : 'featured';
  }
  if (kind === 'categories' && get('tilesCategory')) s.category = get('tilesCategory');
  if (kind === 'kits') { const ids = f.getAll('kitIds').map(String).filter(id => doc.kits.some(k => k.id === id)); if (ids.length) s.kitIds = ids; }
  if (kind === 'brands' && get('group')) s.group = get('group');
  if (kind === 'promo') { if (record.image) s.image = record.image; if (t('heading')) s.heading = t('heading'); if (t('text')) s.text = t('text'); }
  if (kind === 'faq') {
    const qs = f.getAll('faq-q').map(v => String(v).trim()), as = f.getAll('faq-a').map(v => String(v).trim());
    s.items = qs.map((q, i) => ({q, a: as[i] || ''})).filter(it => it.q && it.a).slice(0, LIMITS.faqItems);
    s.unanswered = qs.filter((q, i) => q && !as[i]).length;
  }
  if (kind === 'text') s.body = (get('body') ?? record.body ?? '').trim();
  if (target && kind !== 'faq' && kind !== 'text') s.button = {label: label || 'Shop now', target};
  return s;
}

export function readSectionForm(ctx, form, record, {isNew = false} = {}) {
  const doc = doc0(ctx), base = record || sectionDefaults(doc);
  const s = sectionFromForm(doc, form, base);
  const unanswered = s.unanswered || 0;
  delete s.unanswered;
  const stop = msg => { throw Object.assign(new Error(msg), {detail: msg}); };
  if (s.kind === 'faq' && unanswered) stop(unanswered === 1 ? 'Add an answer to the question, or remove it.' : `Add answers to ${unanswered} questions, or remove them.`);
  if (s.kind === 'faq' && !s.items.length) stop('Add at least one question with its answer.');
  if (s.kind === 'text' && !s.body) stop('Write some text for this section first.');
  if (s.kind === 'promo' && !s.heading && !s.text && !s.image) stop('Add a heading, some text or a picture first.');
  const ref = 'section:' + s.id;
  const i = doc.sections.findIndex(x => x.id === s.id);
  const oldPage = i >= 0 ? doc.sections[i].page : null;
  const oldIndex = oldPage ? resolveLayout(doc, oldPage).indexOf(ref) : -1;
  if (i >= 0) doc.sections[i] = s; else doc.sections.push(s);
  for (const p of PAGES) doc.layout[p] = resolveLayout(doc, p).filter(r => r !== ref);
  const list = doc.layout[s.page];
  const after = String(fd(form).get('after') ?? '');
  let at;
  if (after === '__top') at = 0;
  else if (after === '__bottom') at = list.length;
  else if (after && list.includes(after)) at = list.indexOf(after) + 1;
  // A position from the other page (a stale choice) is ignored: keep its place, else the default.
  else if (after && !list.includes(after) && (isNew || oldPage !== s.page)) {
    const k = list.indexOf('builtin:shop-kits');
    at = s.page === 'shop' && k >= 0 ? k : list.length;
  }
  else if (!isNew && oldPage === s.page && oldIndex >= 0) at = Math.min(oldIndex, list.length);
  else at = list.length;
  list.splice(at, 0, ref);
  const label = (isNew || i < 0 ? 'Added section ' : 'Updated section ') + (s.title || KIND_LABELS[s.kind]);
  return {next: doc, section: s, label};
}

export async function saveSectionForm(ctx, form, record, opts = {}) {
  const {next, label} = readSectionForm(ctx, form, record, opts);
  validateContent(structuredClone(next));
  await ctx.save(next, label);
  return next;
}

export function bindSectionEditor(ctx, root, record) {
  const ed = root?.matches?.('[data-sec-editor]') ? root : root?.querySelector?.('[data-sec-editor]');
  if (!ed || ed.dataset.bound) return;
  ed.dataset.bound = '1';
  const esc = E(ctx), form = ed.closest('form') || ed;
  const $ = s => ed.querySelector(s);
  const kindSel = $('[name=kind]');
  const update = () => {
    const doc = view(ctx), kind = kindSel.value;
    ed.querySelectorAll('[data-sec-kinds]').forEach(g => { g.hidden = !g.dataset.secKinds.split(' ').includes(kind); g.disabled = g.hidden; });
    const type = ed.querySelector('[name=sourceType]:checked')?.value || 'all';
    ed.querySelectorAll('[data-src-for]').forEach(el => { el.hidden = !el.dataset.srcFor.split(' ').includes(type); });
    const out = $('[data-limit-out]'), lim = $('[name=limit]');
    if (out && lim) out.textContent = lim.value;
    if (PRODUCT_KINDS.includes(kind)) {
      const s = sectionFromForm(doc, form, record || {});
      const n = selectProducts(doc, s).length;
      const c = $('[data-sec-count]');
      if (c) { c.textContent = n ? `Will show ${n} product${n === 1 ? '' : 's'}.` : 'Nothing to show yet. The section stays off the site until it has visible products.'; c.classList.toggle('is-empty', !n); }
    }
    const md = $('[data-md-preview]');
    if (md && kind === 'text') md.innerHTML = markdown($('[name=body]')?.value || '', escHtml) || '<p class="small-note">Your text preview appears here.</p>';
  };
  // "Position on the page" follows "Show on".
  const pageSel = $('[name=page]'), afterSel = $('[name=after]');
  pageSel?.addEventListener('change', () => {
    if (!afterSel) return;
    const doc = view(ctx), id = $('[name=sectionId]')?.value || record?.id || '';
    const onPage = (doc.sections || []).some(x => x.id === id && x.page === pageSel.value);
    const {list, value} = afterChoices(doc, pageSel.value, id, {keep: onPage});
    afterSel.innerHTML = opts(esc, list, onPage ? '' : value);
  });
  // Subcategory options follow the category.
  const cat = $('[name=sourceCategory]'), sub = $('[name=sourceSubcategory]');
  cat?.addEventListener('change', () => {
    const list = subOptions(view(ctx), cat.value);
    sub.innerHTML = opts(esc, list.length ? list : [['', 'This category has no subcategories']], '');
  });
  // FAQ repeater.
  ed.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !ed.contains(b)) return;
    if (b.matches('[data-faq-add]')) { const listEl = $('[data-faq-list]'); if (listEl.children.length >= LIMITS.faqItems) { ctx.toast?.(`Up to ${LIMITS.faqItems} questions.`); return; } listEl.insertAdjacentHTML('beforeend', faqRow(esc)); listEl.lastElementChild.querySelector('input')?.focus(); return; }
    if (b.matches('[data-faq-remove]')) { b.closest('[data-faq-row]').remove(); return; }
    if (b.matches('[data-pick-add]')) { pick(b.dataset.pickAdd); return; }
    if (b.matches('[data-pick-remove]')) { const li = b.closest('[data-pick-id]'); setPicked(picked().filter(id => id !== li.dataset.pickId)); return; }
    if (b.matches('[data-pick-move]')) { const id = b.closest('[data-pick-id]').dataset.pickId, ids = picked(), i = ids.indexOf(id), j = i + Number(b.dataset.pickMove); if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; setPicked(ids); return; }
  });
  // Product picker (search over name, brand, SKU and tags; up to 48 in a chosen order).
  const hidden = $('[name=productIds]');
  const picked = () => (hidden?.value || '').split(',').filter(Boolean);
  const setPicked = ids => {
    const doc = view(ctx), byId = new Map(doc.products.map(p => [p.id, p]));
    const list = ids.filter(id => byId.has(id)).slice(0, LIMITS.productIds);
    hidden.value = list.join(',');
    $('[data-picked]').innerHTML = list.map((id, i) => pickRow(ctx, byId.get(id), i, list.length)).join('');
    $('[data-pick-count]').textContent = String(list.length);
    search();
    update();
  };
  const pick = id => { const ids = picked(); if (ids.includes(id)) return; if (ids.length >= LIMITS.productIds) { ctx.toast?.(`A section can hold up to ${LIMITS.productIds} products.`); return; } setPicked([...ids, id]); };
  const search = () => {
    const box = $('[data-pick-search]'), res = $('[data-pick-results]');
    if (!box || !res) return;
    const q = box.value.trim().toLowerCase(), chosen = new Set(picked());
    if (!q) { res.innerHTML = ''; return; }
    const hits = view(ctx).products.filter(p => [p.name, p.brand, p.sku, ...(p.tags || [])].join(' ').toLowerCase().includes(q)).slice(0, 20);
    res.innerHTML = hits.length ? hits.map(p => `<li><img src="${esc(ctx.imageUrl ? ctx.imageUrl(p.image) : '')}" alt="" loading="lazy"><span>${esc(p.name)}<small>${esc(p.brand || '')}${p.sku ? ' · ' + esc(p.sku) : ''}</small></span>${chosen.has(p.id) ? '<span class="sec-pick-added">Added</span>' : `<button class="btn tiny ghost" type="button" data-pick-add="${esc(p.id)}">Add</button>`}</li>`).join('') : '<li class="small-note">No products match.</li>';
  };
  $('[data-pick-search]')?.addEventListener('input', search);
  ed.addEventListener('input', update);
  ed.addEventListener('change', update);
  update();
}
