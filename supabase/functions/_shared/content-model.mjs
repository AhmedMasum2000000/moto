// Shared content model: ids, the v1 → v2 normaliser, page layout and the reference scanner.
// Lives in _shared so the moto-admin Edge Function bundle can import it; cms/content-model.mjs
// re-exports it for the storefront and the control room.
// Pure (no DOM, no network). Imported by the server schema (supabase/functions/moto-admin/schema.mjs),
// cms/content-defaults.mjs, the storefront and the control room, so the browser and the server
// always derive the same ids from the same names.
//
// Backward compatibility: documents saved before v2 (subcategories as plain strings, gallery as
// strings, no sections / layout / brandGroups) are upgraded on read by normalise(). Nothing has to
// be migrated in the database; the next save simply stores the normalised shape.

// ── ids ────────────────────────────────────────────────────────────────────────────────────────
export const ID = /^[a-zA-Z0-9_-]{1,100}$/;

// 32-bit FNV-1a over the UTF-8 bytes of s, as 8 lowercase hex digits.
export function fnv1a(s) {
  const bytes = new TextEncoder().encode(String(s ?? ''));
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// Lowercase; runs of [a-z0-9] joined by '-'; at most 60 characters. Accents and styled letters are
// folded first (NFKD), so 'Café' → 'cafe' and '𝖼𝖾𝖺𝗍' → 'ceat'. A name with no latin letters or digits
// (for example a Bangla name) becomes 'x' + the FNV-1a hash of the original text.
export function slug(s) {
  const text = String(s ?? '');
  const runs = text.normalize('NFKD').toLowerCase().match(/[a-z0-9]+/g);
  const out = (runs ? runs.join('-') : '').slice(0, 60).replace(/-+$/, '');
  return out || 'x' + fnv1a(text);
}

const asSet = taken => taken instanceof Set ? taken : new Set(taken ? [...taken] : []);

// 'sub-' + slug(name); '-2', '-3', … when that id is already taken within the category.
export function subId(name, taken) {
  const used = asSet(taken), base = 'sub-' + slug(name);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(base + '-' + n)) return base + '-' + n;
}

// A fresh random id (sections, copies, brand groups …).
export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

// 'catId/subId' ⇄ {category, sub}
export const subRef = (category, sub) => category + '/' + sub;
export function parseSubRef(ref) { const s = String(ref ?? ''), i = s.indexOf('/'); return i < 0 ? {category: s, sub: ''} : {category: s.slice(0, i), sub: s.slice(i + 1)}; }

const key = v => String(v ?? '').trim().toLowerCase();

// The child of a category whose id is `value`, else whose name matches it (trimmed, case-insensitive).
export function findChild(category, value) {
  const children = Array.isArray(category?.children) ? category.children.filter(c => c && typeof c === 'object') : [];
  if (!value) return null;
  return children.find(c => c.id === value) || children.find(c => key(c.name) === key(value)) || null;
}
// The display name of a subcategory id ('' when unknown).
export function childName(doc, categoryId, value) {
  const c = doc?.categories?.find(c => c.id === categoryId);
  if (!c || !value) return '';
  const child = findChild(c, value);
  if (child) return child.name;
  return (c.children || []).find(x => typeof x === 'string' && key(x) === key(value)) || '';
}

// ── page structure ──────────────────────────────────────────────────────────────────────────────
// Built-in page sections, in page order (data-cms-section ids in index.html / shop.html).
export const BUILTINS = Object.freeze({
  index: Object.freeze(['index-fitment', 'index-popular', 'index-brands', 'index-services', 'index-dealer', 'index-brand-partners', 'index-section-5']),
  shop: Object.freeze(['shop-section-1', 'shop-finder', 'shop-catalog', 'shop-kits', 'shop-partners', 'shop-section-2']),
});
export const PINNED_TOP = Object.freeze({index: Object.freeze(['index-fitment']), shop: Object.freeze(['shop-section-1', 'shop-finder'])});
export const PINNED_BOTTOM = Object.freeze({index: Object.freeze(['index-section-5']), shop: Object.freeze(['shop-section-2'])});
// The pinned subset of BUILTINS. Usable as a list (PINNED.includes(id)), as a set (PINNED.has(id))
// or per page (PINNED.index, PINNED.shop).
const pinnedList = [...PINNED_TOP.index, ...PINNED_BOTTOM.index, ...PINNED_TOP.shop, ...PINNED_BOTTOM.shop];
export const PINNED = Object.freeze(Object.assign(pinnedList, {
  index: Object.freeze([...PINNED_TOP.index, ...PINNED_BOTTOM.index]),
  shop: Object.freeze([...PINNED_TOP.shop, ...PINNED_BOTTOM.shop]),
  has: id => pinnedList.includes(id),
}));
export const PAGES = Object.freeze(['index', 'shop']);
export const isPinned = id => pinnedList.includes(id);
export const REF = /^(builtin|section):[a-zA-Z0-9_-]+$/;

// The non-pinned builtins of each page, in page order, as 'builtin:<id>'.
export function defaultLayout() {
  return Object.fromEntries(PAGES.map(page => [page, BUILTINS[page].filter(id => !isPinned(id)).map(id => 'builtin:' + id)]));
}

// Ordered refs for a page: unknown, deleted, duplicate and pinned refs are dropped; non-pinned
// builtins (and sections of this page) missing from the saved layout are appended, so a layout
// saved today keeps working when a builtin is added later.
export function resolveLayout(doc, page) {
  if (!PAGES.includes(page)) return [];
  const saved = Array.isArray(doc?.layout?.[page]) ? doc.layout[page] : defaultLayout()[page];
  const sections = new Map((Array.isArray(doc?.sections) ? doc.sections : []).filter(s => s && s.page === page).map(s => [s.id, s]));
  const ok = ref => {
    if (typeof ref !== 'string' || !REF.test(ref)) return false;
    const [kind, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
    return kind === 'builtin' ? BUILTINS[page].includes(id) && !isPinned(id) : sections.has(id);
  };
  const out = [];
  for (const ref of saved) if (ok(ref) && !out.includes(ref)) out.push(ref);
  for (const id of BUILTINS[page]) if (!isPinned(id) && !out.includes('builtin:' + id)) out.push('builtin:' + id);
  for (const id of sections.keys()) if (!out.includes('section:' + id)) out.push('section:' + id);
  return out;
}

// ── section vocabulary (validated in schema.mjs, rendered by cms/sections.mjs) ─────────────────
export const SECTION_KINDS = Object.freeze(['carousel', 'grid', 'categories', 'kits', 'brands', 'promo', 'faq', 'text']);
export const PRODUCT_KINDS = Object.freeze(['carousel', 'grid']);
export const SOURCE_TYPES = Object.freeze(['category', 'subcategory', 'brand', 'products', 'sale', 'featured', 'newest', 'all']);
export const SORTS = Object.freeze(['manual', 'featured', 'low', 'high', 'save', 'newest']);
export const LIMITS = Object.freeze({
  sections: 60, layout: 80, sectionLimit: 24, defaultLimit: 12, productIds: 48, faqItems: 30,
  brandGroups: 30, children: 100, gallery: 12, tags: 20, kitIds: 50,
});

// Brand groups that existed before they became editable, with the labels the homepage shows.
export const LEGACY_BRAND_GROUPS = Object.freeze([
  Object.freeze({id: 'tyres', name: 'Tyres', label: 'index-t65', shop: 'tyres'}),
  Object.freeze({id: 'oil', name: 'Engine oil', label: 'index-t66', shop: 'oil'}),
  Object.freeze({id: 'parts', name: 'Spare parts', label: 'index-dealer-parts-label', shop: ''}),
]);

// ── normalise ───────────────────────────────────────────────────────────────────────────────────
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const fieldText = (doc, id) => {
  for (const s of Array.isArray(doc.content) ? doc.content : []) for (const f of Array.isArray(s?.fields) ? s.fields : []) if (f?.id === id && typeof f.value === 'string' && f.value.trim()) return f.value.trim();
  return '';
};

// Upgrades a content document to the v2 shape. Idempotent; never changes an id that already
// exists; works on a clone and returns it.
//  1. String subcategories become {id, name, visible:true} in array order (case-insensitive
//     duplicates, which the old editor allowed, collapse into the first).
//  2. product.subcategory holding a name becomes the child id; unmatched values become ''.
//  3. blocks[].subcategories names become ids; unmatched names are dropped.
//  4. Gallery strings become {ref}.
//  5–8. sections [], brandGroups (seeded from the brand group values in use), layout and
//     products[].updatedAt null are added when missing.
// opts.keepUnmatched (used by the server validator): unmatched values are kept as they are, so
// validation reports them instead of silently clearing them.
export function normalise(doc, opts = {}) {
  if (!isObj(doc)) return doc;
  const d = structuredClone(doc), keep = !!opts.keepUnmatched;
  const legacy = new Set();
  for (const c of Array.isArray(d.categories) ? d.categories : []) {
    if (!isObj(c) || !Array.isArray(c.children)) continue;
    if (!c.children.some(x => typeof x === 'string')) continue;
    legacy.add(c.id);
    const taken = new Set(c.children.filter(isObj).map(x => x.id)), names = new Set(c.children.filter(isObj).map(x => key(x.name)));
    const out = [];
    for (const x of c.children) {
      if (typeof x !== 'string') { out.push(x); continue; }
      const name = x.trim();
      if (!name || names.has(key(name))) continue;
      const id = subId(name, taken);
      taken.add(id); names.add(key(name));
      out.push({id, name, visible: true});
    }
    c.children = out;
  }
  const cats = new Map((Array.isArray(d.categories) ? d.categories : []).filter(isObj).map(c => [c.id, c]));
  // A legacy category's products hold names: match by name first. Otherwise ids come first.
  const resolve = (categoryId, value) => {
    const c = cats.get(categoryId);
    if (!c || !Array.isArray(c.children)) return null;
    const kids = c.children.filter(isObj);
    const byId = kids.find(x => x.id === value), byName = kids.find(x => key(x.name) === key(value));
    return (legacy.has(categoryId) ? byName || byId : byId || byName) || null;
  };
  for (const p of Array.isArray(d.products) ? d.products : []) {
    if (!isObj(p)) continue;
    if (typeof p.subcategory === 'string' && p.subcategory) {
      const child = resolve(p.category, p.subcategory);
      if (child) p.subcategory = child.id;
      else if (!keep && cats.has(p.category)) p.subcategory = '';
    }
    if (Array.isArray(p.gallery)) p.gallery = p.gallery.map(g => typeof g === 'string' ? {ref: g} : g);
    if (!('updatedAt' in p)) p.updatedAt = null;
  }
  for (const b of Array.isArray(d.blocks) ? d.blocks : []) {
    if (!isObj(b) || !Array.isArray(b.subcategories) || b.kind !== 'category' || !cats.has(b.target)) continue;
    const ids = [];
    for (const n of b.subcategories) {
      const child = typeof n === 'string' ? resolve(b.target, n) : null;
      const v = child ? child.id : keep ? n : null;
      if (v != null && !ids.includes(v)) ids.push(v);
    }
    b.subcategories = ids;
  }
  if (!Array.isArray(d.sections)) d.sections = [];
  if (!Array.isArray(d.brandGroups)) {
    const used = [...new Set((Array.isArray(d.brands) ? d.brands : []).map(b => b?.group).filter(g => typeof g === 'string' && g))];
    const groups = LEGACY_BRAND_GROUPS.map(g => ({id: g.id, name: fieldText(d, g.label) || g.name, visible: true, ...(g.shop && cats.has(g.shop) ? {shopTarget: g.shop} : {})}));
    for (const g of used) if (!groups.some(x => x.id === g) && ID.test(g)) groups.push({id: g, name: g.slice(0, 60), visible: true});
    d.brandGroups = groups;
  }
  const def = defaultLayout();
  if (d.layout == null || (!keep && !isObj(d.layout))) d.layout = def;
  else if (isObj(d.layout)) for (const page of PAGES) if (!Array.isArray(d.layout[page])) d.layout[page] = def[page];
  return d;
}

// True when normalise() would upgrade something structural (cheap check, no clone).
export function needsNormalise(doc) {
  if (!isObj(doc)) return false;
  if (!Array.isArray(doc.sections) || !Array.isArray(doc.brandGroups) || !isObj(doc.layout) || !PAGES.every(p => Array.isArray(doc.layout[p]))) return true;
  if ((doc.categories || []).some(c => (c?.children || []).some(x => typeof x === 'string'))) return true;
  return (doc.products || []).some(p => !('updatedAt' in (p || {})) || (p?.gallery || []).some(g => typeof g === 'string'));
}
const ready = doc => needsNormalise(doc) ? normalise(doc) : doc;

// ── references ──────────────────────────────────────────────────────────────────────────────────
// Every place that points at the record `type`/`id`, as [{type, id, name, field, fix}] where
// type/id/name identify the record holding the reference and fix says what deleting does to it:
//   'block'    the reference is required; deleting is refused unless the caller reassigns it
//   'reassign' it may be moved to another record (a sibling, another brand…), otherwise cleared
//   'clear'    the value is emptied
//   'remove'   the id is removed from the list, or the holding record (menu link, card, section) is removed
// Types: category, subcategory ('catId/subId'), product, brand, brandGroup, vehicle, page, post,
// service, kit, section, media (a 'media:<uuid>' ref, a bare uuid, or an 'assets/…' path).
const nameOf = r => r?.name || r?.title || r?.label || r?.id || '';
const ref = (type, r, field, fix) => ({type, id: r.id, name: nameOf(r), field, fix});
const list = (doc, k) => Array.isArray(doc?.[k]) ? doc[k] : [];

export function references(input, type, id) {
  const doc = ready(input), out = [];
  if (!isObj(doc) || id == null || id === '') return out;
  const sections = list(doc, 'sections'), content = list(doc, 'content').filter(c => isObj(c?.source));
  const targetRefs = target => {
    for (const m of list(doc, 'menu')) if (m.target === target) out.push(ref('menu', m, 'target', 'remove'));
    for (const b of list(doc, 'banners')) if (b.destination === target) out.push(ref('banner', b, 'destination', 'clear'));
    for (const g of list(doc, 'brandGroups')) if (g.shopTarget === target) out.push(ref('brandGroup', g, 'shopTarget', 'clear'));
    for (const s of sections) if (s.button?.target === target) out.push(ref('section', s, 'button.target', 'clear'));
  };
  switch (type) {
    case 'category': {
      for (const p of list(doc, 'products')) if (p.category === id) out.push(ref('product', p, 'category', 'block'));
      for (const b of list(doc, 'blocks')) if (b.kind !== 'service' && b.target === id) out.push(ref('block', b, 'target', 'remove'));
      targetRefs(id);
      for (const s of sections) if (s.source?.category === id || (s.kind === 'categories' && s.category === id)) out.push(ref('section', s, s.source?.category === id ? 'source.category' : 'category', 'remove'));
      for (const c of content) if (c.source.category === id) out.push(ref('content', c, 'source', 'clear'));
      break;
    }
    case 'subcategory': {
      const {category, sub} = parseSubRef(id);
      for (const p of list(doc, 'products')) if (p.category === category && p.subcategory === sub) out.push(ref('product', p, 'subcategory', 'reassign'));
      for (const b of list(doc, 'blocks')) if (b.kind === 'category' && b.target === category && (b.subcategories || []).includes(sub)) out.push(ref('block', b, 'subcategories', 'remove'));
      for (const s of sections) if (s.source?.category === category && s.source?.subcategory === sub) out.push(ref('section', s, 'source.subcategory', 'remove'));
      for (const c of content) if (c.source.category === category && c.source.subcategory === sub) out.push(ref('content', c, 'source', 'clear'));
      break;
    }
    case 'product': {
      for (const k of list(doc, 'kits')) if ((k.productIds || []).includes(id)) out.push(ref('kit', k, 'productIds', 'remove'));
      for (const s of sections) if ((s.source?.productIds || []).includes(id)) out.push(ref('section', s, 'source.productIds', 'remove'));
      for (const c of content) if ((c.source.productIds || []).includes(id)) out.push(ref('content', c, 'source.productIds', 'remove'));
      break;
    }
    case 'brand': {
      const brand = list(doc, 'brands').find(b => b.id === id), n = key(brand?.name ?? id);
      if (!n) break;
      for (const p of list(doc, 'products')) if (key(p.brand) === n) out.push(ref('product', p, 'brand', 'clear'));
      for (const s of sections) if (s.source?.type === 'brand' && key(s.source.brand) === n) out.push(ref('section', s, 'source.brand', 'remove'));
      for (const c of content) if (key(c.source.brand) === n) out.push(ref('content', c, 'source', 'clear'));
      break;
    }
    case 'brandGroup': {
      for (const b of list(doc, 'brands')) if (b.group === id) out.push(ref('brand', b, 'group', 'block'));
      for (const s of sections) if (s.group === id) out.push(ref('section', s, 'group', 'remove'));
      break;
    }
    case 'vehicle': {
      for (const p of list(doc, 'products')) if ((p.vehicleIds || []).includes(id)) out.push(ref('product', p, 'vehicleIds', 'remove'));
      break;
    }
    case 'page': case 'post': targetRefs(type + ':' + id); break;
    case 'service': {
      for (const b of list(doc, 'blocks')) if (b.kind === 'service' && b.target === id) out.push(ref('block', b, 'target', 'remove'));
      break;
    }
    case 'kit': {
      for (const s of sections) if ((s.kitIds || []).includes(id)) out.push(ref('section', s, 'kitIds', 'remove'));
      break;
    }
    case 'section': {
      for (const page of PAGES) if ((doc.layout?.[page] || []).includes('section:' + id)) out.push({type: 'layout', id: page, name: page === 'index' ? 'Homepage layout' : 'Shop layout', field: 'layout.' + page, fix: 'remove'});
      break;
    }
    case 'media': case 'image': return mediaUsage(doc, id);
  }
  return out;
}

// Every location of an image or document ref: [{type, id, name, field, fix}] with field a path
// inside the record ('image', 'gallery[2].ref', 'fields.index-t1', 'children[sub-led].image' …).
const COLLECTION_TYPES = {products: 'product', categories: 'category', banners: 'banner', services: 'service', blocks: 'block', kits: 'kit', brands: 'brand', vehicles: 'vehicle', content: 'content', pages: 'page', posts: 'post', menu: 'menu', sections: 'section', brandGroups: 'brandGroup'};
export function mediaUsage(input, value) {
  const doc = ready(input), out = [];
  const raw = String(value ?? '');
  const wanted = new Set(raw.startsWith('media:') ? [raw, raw.slice(6)] : /^[0-9a-f-]{36}$/i.test(raw) ? ['media:' + raw, raw] : [raw]);
  if (!raw || !isObj(doc)) return out;
  const walk = (v, path, hit) => {
    if (typeof v === 'string') { if (wanted.has(v)) hit(path); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + '[' + (isObj(x) && x.id ? x.id : i) + ']', hit)); return; }
    if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? path + '.' + k : k, hit);
  };
  for (const [k, type] of Object.entries(COLLECTION_TYPES)) for (const r of list(doc, k)) {
    if (!isObj(r)) continue;
    if (type === 'content') {
      for (const f of r.fields || []) if (wanted.has(f?.value)) out.push({type, id: r.id, name: nameOf(r), field: 'fields.' + f.id, fix: 'clear'});
      continue;
    }
    walk(r, '', path => out.push({type, id: r.id, name: nameOf(r), field: path.replace(/^\./, ''), fix: /^gallery\[/.test(path) ? 'remove' : 'clear'}));
  }
  if (isObj(doc.settings)) walk(doc.settings, '', path => out.push({type: 'settings', id: 'settings', name: 'Store settings', field: path, fix: 'clear'}));
  return out;
}
