// Bulk actions for the control-room lists. Pure: no DOM, no network; never mutates its input.
// applyBulk(doc, ids, action, value) → {next, changed, failed:[{id, name, reason}]}
// Products get every action; the other lists (categories, brands, vehicles, banners, menu …) get
// show / hide / duplicate / delete through opts.type. Rows that cannot take the change are listed in
// `failed` and left as they were; the rest is applied, so the caller makes one save with Undo.
import {normalise, findChild, LIMITS} from '../../cms/content-model.mjs';
import {COLLECTIONS, getRecord, nameOf, deleteRecordIn, duplicateRecordIn} from './records.mjs';

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const STOCK = ['In stock', 'Out of stock', 'Ask us'];
const KIT_MAX = 20;
const PRICE_MAX = 100000000;
const bad = message => Object.assign(new Error(message), {code: 'invalid-value'});

// Actions offered per list type (label is the bulk-bar button text).
export const PRODUCT_ACTIONS = Object.freeze(['move', 'show', 'hide', 'feature', 'unfeature', 'price', 'sale', 'stock', 'brand', 'addToKit', 'addToSection', 'duplicate', 'delete']);
export const LIST_ACTIONS = Object.freeze(['show', 'hide', 'duplicate', 'delete']);
export const ACTION_LABELS = Object.freeze({
  move: 'Move to…', show: 'Show', hide: 'Hide', feature: 'Feature', unfeature: 'Unfeature', price: 'Change price…', sale: 'Discount…',
  stock: 'Stock…', brand: 'Set brand…', addToKit: 'Add to bundle…', addToSection: 'Add to section…', duplicate: 'Duplicate', delete: 'Delete…',
});
export const actionsFor = type => type === 'product' ? PRODUCT_ACTIONS : LIST_ACTIONS;

// New price for a price change: {mode:'pct'|'amount', delta}. Rounded to a whole taka, at least 1.
export function newPrice(price, {mode, delta}) {
  const n = Number(price), d = Number(delta);
  const raw = mode === 'pct' ? n * (1 + d / 100) : n + d;
  return Math.min(PRICE_MAX, Math.max(1, Math.round(raw)));
}
// Sale price for a discount percentage (rounded; at least 1).
export const salePrice = (price, pct) => Math.max(1, Math.round(Number(price) * (1 - Number(pct) / 100)));

function checkValue(doc, action, value) {
  const v = isObj(value) ? value : {};
  switch (action) {
    case 'move': {
      const cat = doc.categories.find(c => c.id === v.category);
      if (!cat) throw bad('Choose an existing category.');
      if (v.subcategory && !findChild(cat, v.subcategory)) throw bad('Choose a subcategory inside the selected category.');
      return {cat, sub: v.subcategory ? findChild(cat, v.subcategory).id : ''};
    }
    case 'price':
      if (!['pct', 'amount'].includes(v.mode) || !Number.isFinite(Number(v.delta)) || v.delta === '' || v.delta === null) throw bad('Enter the price change.');
      if (v.mode === 'pct' && Number(v.delta) <= -100) throw bad('A price cannot go down by 100% or more.');
      return v;
    case 'sale': {
      const pct = value === null || v.pct === null || v.pct === undefined || v.pct === '' ? null : Number(v.pct);
      if (pct !== null && !(pct > 0 && pct < 100)) throw bad('Enter a discount between 1 and 99%.');
      return {pct};
    }
    case 'stock': {
      if (!STOCK.includes(v.status)) throw bad('Choose an availability.');
      const q = v.quantity;
      if (q !== undefined && q !== null && q !== '' && !(Number.isSafeInteger(Number(q)) && Number(q) >= 0 && Number(q) <= 999999)) throw bad('Stock quantity must be a whole number from 0 to 999999.');
      return {status: v.status, quantity: q === undefined || q === '' ? undefined : q === null ? null : Number(q)};
    }
    case 'brand': {
      const name = String(v.name ?? '').trim();
      if (name.length > 100) throw bad('Brand names can be up to 100 characters.');
      return {name};
    }
    case 'addToKit': {
      const kit = doc.kits.find(k => k.id === v.kitId);
      if (!kit) throw bad('Choose an existing bundle.');
      return {kit};
    }
    case 'addToSection': {
      const section = (doc.sections || []).find(s => s.id === v.sectionId);
      if (!section) throw bad('Choose an existing section.');
      if (section.source?.type !== 'products') throw bad('This section picks its products automatically. Choose a hand-picked section.');
      return {section};
    }
    default: return v;
  }
}

// opts: {type = 'product', now = new Date()}
export function applyBulk(doc, ids, action, value, opts = {}) {
  const type = opts.type || 'product';
  const spec = COLLECTIONS[type];
  if (!spec) throw bad('This list cannot be changed in bulk.');
  if (!actionsFor(type).includes(action)) throw bad('This action is not available here.');
  if (!isObj(doc)) throw bad('The website document is missing.');
  const stamp = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
  const unique = [...new Set(Array.isArray(ids) ? ids : [])];
  const next = normalise(doc);
  const failed = [], copies = [], summaries = [];
  let changed = 0, stopped = false;
  const touch = r => { if (type === 'product') r.updatedAt = stamp; changed++; };
  const v = checkValue(next, action, value);

  for (const id of unique) {
    const r = getRecord(next, type, id);
    if (!r) { failed.push({id, name: '', reason: 'Not found. It may already be deleted.'}); continue; }
    const name = nameOf(type, r);
    const no = reason => failed.push({id, name, reason});
    switch (action) {
      case 'show': case 'hide': {
        const vis = action === 'show';
        if ((r.visible !== false) === vis) break;
        r.visible = vis; touch(r); break;
      }
      case 'feature': case 'unfeature': {
        const f = action === 'feature';
        if (!!r.featured === f) break;
        r.featured = f; touch(r); break;
      }
      case 'move': {
        if (r.category === v.cat.id && (r.subcategory || '') === v.sub) break;
        r.category = v.cat.id; r.subcategory = v.sub; touch(r); break;
      }
      case 'price': {
        const price = newPrice(r.price, v);
        // Guard against typos such as −1450 on a ৳1,500 part: a cut of more than 90% is refused.
        if (price < Number(r.price) * 0.1) { no(`৳${Number(r.price).toLocaleString('en-US')} → ৳${price.toLocaleString('en-US')} would cut the price by more than 90%. Change this one on its own if that is right.`); break; }
        const sale = r.sale === '' || r.sale == null ? null : Number(r.sale);
        if (sale !== null && sale >= price) { no(`The discount price ৳${sale} would not be lower than the new price ৳${price}.`); break; }
        if (price === r.price) break;
        r.price = price; touch(r); break;
      }
      case 'sale': {
        if (v.pct === null) { if (r.sale == null || r.sale === '') break; r.sale = null; touch(r); break; }
        const sale = salePrice(r.price, v.pct);
        if (!(sale < r.price)) { no(`A ${v.pct}% discount on ৳${r.price} would not lower the price.`); break; }
        if (sale === r.sale) break;
        r.sale = sale; touch(r); break;
      }
      case 'stock': {
        const same = r.stock === v.status && (v.quantity === undefined || (r.quantity ?? null) === v.quantity);
        if (same) break;
        r.stock = v.status;
        if (v.quantity !== undefined) r.quantity = v.quantity;
        touch(r); break;
      }
      case 'brand': {
        if ((r.brand || '') === v.name) break;
        r.brand = v.name; touch(r); break;
      }
      case 'addToKit': {
        const kit = next.kits.find(k => k.id === v.kit.id);
        kit.productIds ||= [];
        if (kit.productIds.includes(id)) break;
        if (kit.productIds.length >= KIT_MAX) { no(`The bundle already has ${KIT_MAX} products.`); break; }
        kit.productIds.push(id); touch(r); break;
      }
      case 'addToSection': {
        const section = next.sections.find(s => s.id === v.section.id);
        const list = section.source.productIds ||= [];
        if (list.includes(id)) break;
        if (list.length >= LIMITS.productIds) { no(`A section can show up to ${LIMITS.productIds} hand-picked products.`); break; }
        list.push(id); touch(r); break;
      }
      case 'duplicate': {
        try {
          copies.push(duplicateRecordIn(next, type, id).copy); changed++;
        } catch (err) { no(err.detail || err.message); }
        break;
      }
      case 'delete': {
        if (stopped) { no('Not deleted: stopped at an item that needs a new home.'); break; }
        try {
          summaries.push(deleteRecordIn(next, type, id, isObj(value) ? {reassignTo: value.reassignTo} : {}).summary); changed++;
        } catch (err) {
          if (err.message === 'needs-reassign') { stopped = true; failed.push({id, name, reason: 'needs-reassign', refs: err.refs}); }
          else no(err.detail || err.message);
        }
        break;
      }
    }
  }
  const out = {next, changed, failed};
  if (action === 'duplicate') out.copies = copies;
  if (action === 'delete') { out.summaries = summaries; out.stopped = stopped; }
  return out;
}

// What a bulk change will do before it is applied (the bulk bar shows this before Apply):
// {changed, failed, rows:[{id, name, before, after}]} where before/after hold the fields the action
// touches (price/sale for price changes, category/subcategory for moves …).
const FIELDS = {move: ['category', 'subcategory'], show: ['visible'], hide: ['visible'], feature: ['featured'], unfeature: ['featured'], price: ['price', 'sale'], sale: ['price', 'sale'], stock: ['stock', 'quantity'], brand: ['brand']};
export function previewBulk(doc, ids, action, value, opts = {}) {
  const type = opts.type || 'product';
  const {next, changed, failed} = applyBulk(doc, ids, action, value, opts);
  const fields = FIELDS[action] || [];
  const rows = [];
  for (const id of new Set(ids)) {
    const a = getRecord(doc, type, id), b = getRecord(next, type, id);
    if (!a || !b || failed.some(f => f.id === id)) continue;
    const pick = r => Object.fromEntries(fields.map(f => [f, r[f] ?? null]));
    const before = pick(a), after = pick(b);
    if (fields.length && fields.every(f => before[f] === after[f])) continue;
    rows.push({id, name: nameOf(type, b), before, after});
  }
  return {changed, failed, rows};
}

const money = n => '৳' + Number(n || 0).toLocaleString('en-US');
const plural = (n, type) => `${n} ${n === 1 ? COLLECTIONS[type]?.label || 'item' : COLLECTIONS[type]?.plural || 'items'}`;
// The one-line preview of a price change: "12 products: ৳1,200 → ৳1,320" (totals of the rows).
export function priceSummary(preview) {
  const rows = preview.rows.filter(r => r.before.price !== r.after.price || r.before.sale !== r.after.sale);
  const total = k => rows.reduce((n, r) => n + Number((k === 'before' ? r.before : r.after).sale || (k === 'before' ? r.before : r.after).price || 0), 0);
  return `${plural(rows.length, 'product')}: ${money(total('before'))} → ${money(total('after'))}`;
}

// The save label / toast text: "Moved 12 products to Engine oil".
export function bulkLabel(doc, action, value, n, type = 'product') {
  const what = plural(n, type);
  const v = isObj(value) ? value : {};
  switch (action) {
    case 'move': {
      const cat = doc?.categories?.find(c => c.id === v.category);
      const sub = cat && v.subcategory ? findChild(cat, v.subcategory) : null;
      return `Moved ${what} to ${cat ? cat.name : 'another category'}${sub ? ' › ' + sub.name : ''}`;
    }
    case 'show': return `Showed ${what}`;
    case 'hide': return `Hid ${what}`;
    case 'feature': return `Featured ${what}`;
    case 'unfeature': return `Unfeatured ${what}`;
    case 'price': return `Changed the price of ${what} (${v.mode === 'pct' ? (v.delta > 0 ? '+' : '') + v.delta + '%' : (v.delta > 0 ? '+' : '−') + money(Math.abs(v.delta))})`;
    case 'sale': return v.pct == null ? `Removed the discount from ${what}` : `Set a ${v.pct}% discount on ${what}`;
    case 'stock': return `Set ${what} to ${v.status}`;
    case 'brand': return v.name ? `Set the brand of ${what} to ${v.name}` : `Cleared the brand of ${what}`;
    case 'addToKit': return `Added ${what} to ${doc?.kits?.find(k => k.id === v.kitId)?.name || 'a bundle'}`;
    case 'addToSection': return `Added ${what} to ${doc?.sections?.find(s => s.id === v.sectionId)?.title || 'a section'}`;
    case 'duplicate': return `Duplicated ${what}`;
    case 'delete': return `Deleted ${what}`;
    default: return `Updated ${what}`;
  }
}

export {STOCK};
