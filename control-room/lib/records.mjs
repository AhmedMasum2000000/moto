// Control-room record operations: delete (with reassign / cascade), duplicate, reorder and image usage.
// Pure: no DOM, no network. Every function works on a normalised clone of the document and never
// mutates its input, so the caller can keep the old document for Undo and make one save(next, label).
// The results are shaped to pass the server's validateContent (tests/records.test.mjs enforces it).
import {normalise, references, mediaUsage, newId, subId, parseSubRef, subRef, findChild, resolveLayout, PAGES, LIMITS} from '../../cms/content-model.mjs';

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const key = v => String(v ?? '').trim().toLowerCase();
const editors = role => role === 'owner' || role === 'editor';
const never = () => false;

// type → {key, label, plural, nameField, maxName, max, canDelete(role, record?), canDuplicate}
// key is the top-level collection in the content document; a subcategory lives in categories[].children
// and is addressed as 'categoryId/subId'.
export const COLLECTIONS = Object.freeze({
  product: {key: 'products', label: 'product', plural: 'products', nameField: 'name', maxName: 150, max: 2000, canDelete: editors, canDuplicate: true},
  category: {key: 'categories', label: 'category', plural: 'categories', nameField: 'name', maxName: 100, max: 100, canDelete: editors, canDuplicate: true},
  subcategory: {key: 'children', parent: 'categories', label: 'subcategory', plural: 'subcategories', nameField: 'name', maxName: 100, max: LIMITS.children, canDelete: editors, canDuplicate: true},
  brand: {key: 'brands', label: 'brand', plural: 'brands', nameField: 'name', maxName: 100, max: 2000, canDelete: editors, canDuplicate: true},
  brandGroup: {key: 'brandGroups', label: 'brand group', plural: 'brand groups', nameField: 'name', maxName: 60, max: LIMITS.brandGroups, canDelete: editors, canDuplicate: true},
  kit: {key: 'kits', label: 'bundle', plural: 'bundles', nameField: 'name', maxName: 150, max: 2000, canDelete: editors, canDuplicate: true},
  vehicle: {key: 'vehicles', label: 'model', plural: 'models', nameField: 'name', maxName: 150, max: 2000, canDelete: editors, canDuplicate: true},
  banner: {key: 'banners', label: 'banner', plural: 'banners', nameField: 'name', maxName: 150, max: 2000, canDelete: editors, canDuplicate: true},
  block: {key: 'blocks', label: 'card', plural: 'cards', nameField: 'name', maxName: 150, max: 2000, canDelete: editors, canDuplicate: true},
  menu: {key: 'menu', label: 'menu link', plural: 'menu links', nameField: 'name', maxName: 100, max: 2000, canDelete: editors, canDuplicate: true},
  // Only custom pages can be removed or copied; index, shop and book are the site's own pages.
  page: {key: 'pages', label: 'page', plural: 'pages', nameField: 'name', maxName: 150, max: 2000, canDelete: (role, r) => editors(role) && (!r || !!r.custom), canDuplicate: true},
  post: {key: 'posts', label: 'post', plural: 'posts', nameField: 'name', maxName: 150, max: 500, canDelete: editors, canDuplicate: true},
  service: {key: 'services', label: 'service', plural: 'services', nameField: 'name', maxName: 150, max: 150, canDelete: editors, canDuplicate: true},
  section: {key: 'sections', label: 'section', plural: 'sections', nameField: 'title', maxName: 150, max: LIMITS.sections, canDelete: editors, canDuplicate: true},
  content: {key: 'content', label: 'page section', plural: 'page sections', nameField: 'name', maxName: 150, max: 200, canDelete: never, canDuplicate: false},
});

const fail = (code, message, extra) => Object.assign(new Error(code), {code, detail: message}, extra);
const spec = type => {
  const s = COLLECTIONS[type];
  if (!s) throw fail('unknown-type', 'This kind of item cannot be changed here.');
  return s;
};
const listOf = (doc, k) => (Array.isArray(doc?.[k]) ? doc[k] : (doc[k] = []));
export const nameOf = (type, r) => String(r?.[COLLECTIONS[type]?.nameField || 'name'] ?? r?.name ?? r?.title ?? r?.id ?? '');

// Works on a normalised clone (normalise always clones).
const work = doc => {
  if (!isObj(doc)) throw fail('invalid-document', 'The website document is missing.');
  return normalise(doc);
};

// The record of `type`/`id` inside doc (a subcategory id is 'categoryId/subId'), or null.
export function getRecord(doc, type, id) {
  const s = spec(type);
  if (type === 'subcategory') {
    const {category, sub} = parseSubRef(id);
    const c = (doc?.categories || []).find(c => c?.id === category);
    return (c?.children || []).find(x => isObj(x) && x.id === sub) || null;
  }
  return (doc?.[s.key] || []).find(x => x?.id === id) || null;
}

// Can `role` delete / duplicate this record? (UI hint; the server re-validates the whole document.)
export const canDelete = (type, role, record) => !!COLLECTIONS[type]?.canDelete(role, record);
export const canDuplicate = (type, role, record) => !!COLLECTIONS[type]?.canDuplicate && editors(role) && (type !== 'page' || !record || !!record.custom);

// ── delete ─────────────────────────────────────────────────────────────────────────────────────
const removeLayoutRef = (d, id) => { for (const page of PAGES) if (Array.isArray(d.layout?.[page])) d.layout[page] = d.layout[page].filter(r => r !== 'section:' + id); };
const removeSection = (d, id) => { d.sections = (d.sections || []).filter(s => s.id !== id); removeLayoutRef(d, id); };
const pull = (arr, v) => Array.isArray(arr) ? arr.filter(x => x !== v) : arr;

// What a reference fix did, in words the owner understands.
const RESULT = {remove: 'removed', clear: 'cleared', reassign: 'moved', block: 'moved'};

// Clears a link target ('page:x', a category id …) wherever it is used: menu links are removed,
// banners are pointed at Home and hidden, brand-group shop buttons and section buttons are cleared.
function applyTargetFix(d, r) {
  if (r.type === 'menu') d.menu = d.menu.filter(m => m.id !== r.id);
  else if (r.type === 'banner') { const b = d.banners.find(b => b.id === r.id); if (b) { b.destination = 'Home'; b.visible = false; } }
  else if (r.type === 'brandGroup') { const g = d.brandGroups.find(g => g.id === r.id); if (g) delete g.shopTarget; }
  else if (r.type === 'section' && r.field === 'button.target') { const s = d.sections.find(s => s.id === r.id); if (s) delete s.button; }
  else return false;
  return true;
}

// Deletes one record and repairs everything that pointed at it.
// opts.reassignTo: where required references move to (another category id for products, a sibling
// subcategory id ('' = none) for products of a subcategory, another brand id for products of a
// brand, another brand group id for brands of a group).
// Returns {next, summary}; throws Error('needs-reassign') (err.refs = the blocking references) when
// something requires a new home and none was given, Error('cannot-delete') for protected records and
// Error('not-found') when the record is gone.
export function deleteRecord(doc, type, id, opts = {}) {
  return deleteRecordIn(work(doc), type, id, opts);
}
// Same, but changes `d` (an already normalised document the caller owns) in place. Every refusal
// is thrown before anything is changed.
export function deleteRecordIn(d, type, id, {reassignTo} = {}) {
  const s = spec(type);
  const record = getRecord(d, type, id);
  if (!record) throw fail('not-found', 'This item could not be found. It may already be deleted.');
  if (type === 'content' || (type === 'page' && !record.custom)) throw fail('cannot-delete', 'This part of the website cannot be deleted. You can hide it instead.');
  const name = nameOf(type, record);
  const refs = references(d, type, id);
  const blocking = refs.filter(r => r.fix === 'block');
  const hasTarget = reassignTo !== undefined && reassignTo !== null;
  if (blocking.length && !hasTarget) throw fail('needs-reassign', `Choose where the ${blocking.length} ${blocking.length === 1 ? 'item' : 'items'} using this ${s.label} should go.`, {refs: blocking});
  const items = [];
  const done = (r, result) => items.push({type: r.type, id: r.id, name: r.name, field: r.field, fix: r.fix, result: result || RESULT[r.fix]});

  switch (type) {
    case 'category': {
      let target = null;
      if (blocking.length) {
        if (reassignTo === '') throw fail('needs-reassign', 'Products need a category. Choose where they should go.', {refs: blocking});
        target = d.categories.find(c => c.id === reassignTo);
        if (!target || target.id === id) throw fail('bad-reassign', 'Choose another existing category.');
      }
      for (const r of refs) {
        if (r.type === 'product') {
          const p = d.products.find(p => p.id === r.id);
          if (!p) continue;
          // Keep the subcategory when the new category has one with the same name.
          const oldChild = findChild(record, p.subcategory);
          const match = oldChild ? findChild(target, oldChild.name) : null;
          p.category = target.id; p.subcategory = match ? match.id : '';
          done(r, 'moved to ' + target.name);
        } else if (r.type === 'block') { d.blocks = d.blocks.filter(b => b.id !== r.id); done(r); }
        else if (r.type === 'section' && r.field !== 'button.target') { removeSection(d, r.id); done(r); }
        else if (r.type === 'content') { const c = d.content.find(c => c.id === r.id); if (c) delete c.source; done(r); }
        else if (applyTargetFix(d, r)) done(r, r.type === 'banner' ? 'hidden (destination was this category)' : undefined);
      }
      d.categories = d.categories.filter(c => c.id !== id);
      break;
    }
    case 'subcategory': {
      const {category, sub} = parseSubRef(id);
      const cat = d.categories.find(c => c.id === category);
      let to = '';
      if (hasTarget && reassignTo !== '') {
        const sib = findChild(cat, reassignTo);
        if (!sib || sib.id === sub) throw fail('bad-reassign', 'Choose another subcategory in the same category.');
        to = sib.id;
      }
      const toName = to ? findChild(cat, to).name : '';
      for (const r of refs) {
        if (r.type === 'product') { const p = d.products.find(p => p.id === r.id); if (p) p.subcategory = to; done(r, to ? 'moved to ' + toName : 'no subcategory'); }
        else if (r.type === 'block') { const b = d.blocks.find(b => b.id === r.id); if (b) b.subcategories = pull(b.subcategories, sub); done(r); }
        else if (r.type === 'section') { removeSection(d, r.id); done(r); }
        else if (r.type === 'content') { const c = d.content.find(c => c.id === r.id); if (c) delete c.source; done(r); }
      }
      cat.children = cat.children.filter(x => x.id !== sub);
      break;
    }
    case 'product': {
      for (const r of refs) {
        if (r.type === 'kit') {
          const k = d.kits.find(k => k.id === r.id);
          if (k) {
            k.productIds = pull(k.productIds, id);
            // An empty bundle would show "0 items · ৳0" on the website: hide it instead.
            if (!k.productIds.length) { k.visible = false; done(r, 'hidden (no products left)'); continue; }
          }
        }
        else if (r.type === 'section') { const x = d.sections.find(x => x.id === r.id); if (x?.source) x.source.productIds = pull(x.source.productIds, id); }
        else if (r.type === 'content') { const c = d.content.find(c => c.id === r.id); if (c?.source) c.source.productIds = pull(c.source.productIds, id); }
        done(r);
      }
      d.products = d.products.filter(p => p.id !== id);
      break;
    }
    case 'brand': {
      let to = null;
      if (hasTarget && reassignTo !== '') {
        to = d.brands.find(b => b.id === reassignTo);
        if (!to || to.id === id) throw fail('bad-reassign', 'Choose another existing brand.');
      }
      for (const r of refs) {
        if (r.type === 'product') { const p = d.products.find(p => p.id === r.id); if (p) p.brand = to ? to.name : ''; done(r, to ? 'moved to ' + to.name : 'cleared'); }
        else if (r.type === 'section') { removeSection(d, r.id); done(r); }
        else if (r.type === 'content') { const c = d.content.find(c => c.id === r.id); if (c) delete c.source; done(r); }
      }
      d.brands = d.brands.filter(b => b.id !== id);
      break;
    }
    case 'brandGroup': {
      let to = null;
      if (hasTarget && reassignTo !== '') {
        to = d.brandGroups.find(g => g.id === reassignTo);
        if (!to || to.id === id) throw fail('bad-reassign', 'Choose another existing brand group.');
      }
      for (const r of refs) {
        if (r.type === 'brand') { const b = d.brands.find(b => b.id === r.id); if (b) { if (to) b.group = to.id; else delete b.group; } done(r, to ? 'moved to ' + to.name : 'no group'); }
        else if (r.type === 'section') { removeSection(d, r.id); done(r); }
      }
      d.brandGroups = d.brandGroups.filter(g => g.id !== id);
      break;
    }
    case 'vehicle': {
      for (const r of refs) {
        const p = d.products.find(p => p.id === r.id);
        if (!p) continue;
        p.vehicleIds = pull(p.vehicleIds, id);
        // A product limited to selected models needs at least one; otherwise customers ask us.
        if (p.fitment === 'Selected vehicles' && !p.vehicleIds.length) { p.fitment = 'Ask us to confirm'; done(r, 'removed (now "Ask us to confirm")'); }
        else done(r);
      }
      d.vehicles = d.vehicles.filter(v => v.id !== id);
      break;
    }
    case 'page': case 'post': {
      for (const r of refs) if (applyTargetFix(d, r)) done(r, r.type === 'banner' ? 'hidden (destination was this ' + type + ')' : undefined);
      d[s.key] = d[s.key].filter(x => x.id !== id);
      break;
    }
    case 'service': {
      for (const r of refs) if (r.type === 'block') { d.blocks = d.blocks.filter(b => b.id !== r.id); done(r); }
      d.services = d.services.filter(x => x.id !== id);
      break;
    }
    case 'kit': {
      for (const r of refs) if (r.type === 'section') { const x = d.sections.find(x => x.id === r.id); if (x) x.kitIds = pull(x.kitIds, id); done(r); }
      d.kits = d.kits.filter(k => k.id !== id);
      break;
    }
    case 'section': {
      for (const r of refs) done(r);
      removeSection(d, id);
      break;
    }
    default:
      d[s.key] = listOf(d, s.key).filter(x => x.id !== id);
  }
  const counts = {moved: 0, cleared: 0, removed: 0};
  for (const it of items) {
    if (it.fix === 'block' || it.fix === 'reassign') counts.moved++;
    else if (it.fix === 'clear') counts.cleared++;
    else counts.removed++;
  }
  const summary = {type, id, name, label: `Deleted ${s.label} ${name}`.trim(), items, ...counts};
  return {next: d, summary};
}

// ── duplicate ──────────────────────────────────────────────────────────────────────────────────
// 'Name (copy)', 'Name (copy 2)' … unique (case-insensitive) among `taken`, cut to fit `max`.
export function copyName(name, taken, max = 150) {
  const used = new Set([...taken].map(key));
  const base = String(name ?? '').trim();
  for (let n = 1; ; n++) {
    const tail = n === 1 ? ' (copy)' : ` (copy ${n})`;
    const out = base.slice(0, Math.max(1, max - tail.length)).trimEnd() + tail;
    if (!used.has(key(out))) return out;
  }
}
const uniqueSlug = (slugValue, taken) => {
  const base = String(slugValue || 'page').slice(0, 90);
  for (let n = 1; ; n++) { const s = base + (n === 1 ? '-copy' : '-copy-' + n); if (!taken.has(s)) return s; }
};

// Copies one record. The copy gets a new random id, the name plus " (copy)" and visible:false, and
// is inserted right after the original. A category copy gets fresh subcategory ids and no products;
// a product copy drops its SKU (SKUs are unique); a section copy is placed after the original in
// its page layout. Returns {next, copy} (copy is the object inside next).
export function duplicateRecord(doc, type, id) {
  return duplicateRecordIn(work(doc), type, id);
}
// Same, in place on a normalised document the caller owns.
export function duplicateRecordIn(d, type, id) {
  const s = spec(type);
  if (!s.canDuplicate) throw fail('cannot-duplicate', 'This item cannot be copied.');
  const original = getRecord(d, type, id);
  if (!original) throw fail('not-found', 'This item could not be found.');
  if (type === 'page' && !original.custom) throw fail('cannot-duplicate', 'Only your own pages can be copied.');
  const copy = structuredClone(original);
  const nf = s.nameField;

  if (type === 'subcategory') {
    const {category} = parseSubRef(id);
    const cat = d.categories.find(c => c.id === category);
    if (cat.children.length >= s.max) throw fail('limit', `A category can have up to ${s.max} subcategories.`);
    copy.name = copyName(original.name, cat.children.map(c => c.name), s.maxName);
    copy.id = subId(copy.name, new Set(cat.children.map(c => c.id)));
    copy.visible = false;
    cat.children.splice(cat.children.indexOf(original) + 1, 0, copy);
    return {next: d, copy};
  }

  const list = listOf(d, s.key);
  if (list.length >= s.max) throw fail('limit', `You can have up to ${s.max} ${s.plural}.`);
  copy.id = newId();
  copy[nf] = copyName(original[nf] ?? '', list.map(x => x[nf] ?? ''), s.maxName);
  if (type === 'page' || type === 'post') {
    // Pages and posts show their title; keep it in step with the copy's name.
    if (typeof copy.title === 'string' && nf !== 'title') copy.title = copyName(original.title, list.map(x => x.title ?? ''), 200);
    const slugs = new Set([...(d.pages || []), ...(d.posts || [])].map(x => x.slug).filter(Boolean));
    if (copy.slug) copy.slug = uniqueSlug(copy.slug, slugs);
  }
  if (type !== 'content') copy.visible = false;
  if (type === 'category') {
    const taken = new Set();
    copy.children = (original.children || []).map(ch => { const c = {...structuredClone(ch), id: subId(ch.name, taken)}; taken.add(c.id); return c; });
  }
  if (type === 'product') {
    delete copy.sku;
    copy.featured = false;
    copy.updatedAt = new Date().toISOString();
  }
  list.splice(list.indexOf(original) + 1, 0, copy);
  if (type === 'section') {
    const page = copy.page;
    const refs = resolveLayout(d, page).filter(r => r !== 'section:' + copy.id);
    if (refs.length >= LIMITS.layout) { list.splice(list.indexOf(copy), 1); throw fail('limit', `A page can have up to ${LIMITS.layout} sections.`); }
    const at = refs.indexOf('section:' + original.id);
    refs.splice(at < 0 ? refs.length : at + 1, 0, 'section:' + copy.id);
    d.layout[page] = refs;
  }
  return {next: d, copy};
}

// ── order ──────────────────────────────────────────────────────────────────────────────────────
// Reorders a subset in place: the records `ids` (in their new order) take back the positions they
// held, so a list filtered to one category can be dragged without disturbing the others.
function reorderList(list, ids, getId = x => x.id) {
  const wanted = ids.filter((id, i) => ids.indexOf(id) === i);
  const slots = [], byId = new Map();
  list.forEach((x, i) => { if (wanted.includes(getId(x))) { slots.push(i); byId.set(getId(x), x); } });
  const order = wanted.filter(id => byId.has(id));
  const out = list.slice();
  slots.forEach((slot, i) => { out[slot] = byId.get(order[i]); });
  return {out, changed: out.some((x, i) => x !== list[i])};
}

// opts.category: for type 'subcategory', the category whose children are reordered (ids are child ids).
// Returns {next, changed}.
export function reorderRecords(doc, type, ids, opts = {}) {
  const s = spec(type), d = work(doc);
  if (type === 'subcategory') {
    const cat = d.categories.find(c => c.id === opts.category);
    if (!cat) throw fail('not-found', 'This category could not be found.');
    const {out, changed} = reorderList(cat.children, ids);
    cat.children = out;
    return {next: d, changed};
  }
  const {out, changed} = reorderList(listOf(d, s.key), ids);
  d[s.key] = out;
  return {next: d, changed};
}

// Moves one record 'up' | 'down' | 'top' | 'bottom' | <index>, within opts.within (the ids shown
// in the list, in their current order; default: the whole collection). Returns {next, changed}.
export function moveRecord(doc, type, id, where, opts = {}) {
  const s = spec(type);
  let ids;
  if (type === 'subcategory') {
    const {category, sub} = parseSubRef(id);
    const cat = (doc.categories || []).find(c => c.id === category);
    ids = opts.within || (cat?.children || []).map(c => typeof c === 'string' ? c : c.id);
    return reorderRecords(doc, type, moved(ids, sub, where), {category});
  }
  ids = opts.within || (doc[s.key] || []).map(x => x.id);
  return reorderRecords(doc, type, moved(ids, id, where), opts);
}
function moved(ids, id, where) {
  const list = ids.slice(), i = list.indexOf(id);
  if (i < 0) return list;
  list.splice(i, 1);
  const j = where === 'top' ? 0 : where === 'bottom' ? list.length : where === 'up' ? Math.max(0, i - 1) : where === 'down' ? Math.min(list.length, i + 1) : Math.max(0, Math.min(list.length, Number(where) || 0));
  list.splice(j, 0, id);
  return list;
}

// Page layout order. refs: the new order of (some of) the page's refs; pinned and unknown refs are
// ignored. Returns {next, changed}.
export function reorderLayout(doc, page, refs) {
  if (!PAGES.includes(page)) throw fail('not-found', 'Unknown page.');
  const d = work(doc);
  const current = resolveLayout(d, page);
  const {out} = reorderList(current, refs.filter(r => current.includes(r)), r => r);
  const before = Array.isArray(d.layout[page]) ? d.layout[page] : [];
  d.layout[page] = out;
  return {next: d, changed: out.length !== before.length || out.some((r, i) => r !== before[i])};
}
export function moveLayoutRef(doc, page, ref, where) {
  return reorderLayout(doc, page, moved(resolveLayout(normalise(doc), page), ref, where));
}

// ── images ─────────────────────────────────────────────────────────────────────────────────────
// Every place a picture or document is used: [{type, id, name, field, fix}] (replaces the old
// JSON-string scan in the Photos details sheet). ref: 'media:<uuid>', a bare uuid or an assets/ path.
export function findImageUsage(doc, ref) {
  return isObj(doc) ? mediaUsage(doc, ref) : [];
}
// Short "Product A, Banner B, +3 more" text for a usage list.
export function usageText(usages, max = 5) {
  const names = [...new Set(usages.map(u => u.name || u.type))];
  return names.length > max ? names.slice(0, max).join(', ') + `, +${names.length - max} more` : names.join(', ');
}

// Subcategory ref helper re-exported for the UI ('catId/subId').
export {subRef};
