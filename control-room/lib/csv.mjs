// Spreadsheet (CSV) export and import for products. Pure: no DOM, no network.
//  toCsv(rows, columns)   → text with a UTF-8 BOM, CRLF line ends and RFC 4180 quoting
//  parseCsv(text)         → [[cell, …], …] (BOM, quotes, CRLF and newlines inside quotes handled)
//  productsCsv(doc)       → the Products export
//  templateCsv()          → header plus one example row
//  planImport(doc, rows)  → {next, report}: what an import would do, for the preview table
// Cells that a spreadsheet would run as a formula (=, +, -, @ first) are written with a leading
// apostrophe and read back without it (CSV injection guard).
import {normalise, slug, subId, findChild, ID, LIMITS} from '../../cms/content-model.mjs';
import {imageRef} from '../../supabase/functions/moto-admin/schema.mjs';
import {units} from '../../supabase/functions/_shared/inventory.mjs';

export const PRODUCT_COLUMNS = Object.freeze(['id', 'name', 'sku', 'brand', 'category', 'subcategory', 'price', 'sale', 'quantity', 'unit', 'stock', 'visible', 'featured', 'tags', 'description', 'image', 'gallery']);
export const LIMITS_IMPORT = Object.freeze({products: 2000, bytes: 1800000, categories: 100, children: LIMITS.children, gallery: LIMITS.gallery, tags: LIMITS.tags});
export const DEFAULT_PRODUCT_IMAGE = 'assets/icons/spare-parts.png';
export const DEFAULT_CATEGORY_IMAGE = 'assets/icons/servicing.png';
const STOCK = ['In stock', 'Out of stock', 'Ask us'];
const BOM = '﻿';

// ── writing ────────────────────────────────────────────────────────────────────────────────────
const RISKY = /^[=+\-@\t\r]/;
export function cell(value) {
  let s = value === null || value === undefined ? '' : typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
  if (typeof value === 'string' && RISKY.test(s)) s = "'" + s;
  return /[",\r\n]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// rows: objects (read by column key) or arrays. columns: ['key', …] or [{key, label, value(row)}].
export function toCsv(rows, columns) {
  const cols = (columns || []).map(c => typeof c === 'string' ? {key: c, label: c} : {label: c.key, ...c});
  const lines = [cols.map(c => cell(c.label)).join(',')];
  for (const row of rows || []) {
    lines.push(cols.map((c, i) => cell(c.value ? c.value(row) : Array.isArray(row) ? row[i] : row?.[c.key])).join(','));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

// ── reading ────────────────────────────────────────────────────────────────────────────────────
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false, i = 0, started = false;
  const endField = () => { row.push(field); field = ''; started = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && !started) { quoted = true; started = true; i++; continue; }
    if (ch === ',') { endField(); i++; continue; }
    if (ch === '\r' || ch === '\n') { endRow(); i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1; continue; }
    field += ch; started = true; i++;
  }
  if (field !== '' || started || row.length) endRow();
  // Drop blank lines (a trailing newline, empty spreadsheet rows).
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const unguard = v => /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;

// ── export ─────────────────────────────────────────────────────────────────────────────────────
const list = v => Array.isArray(v) ? v : [];
export function productRows(doc) {
  const d = normalise(doc);
  const cats = new Map(list(d.categories).map(c => [c.id, c]));
  return list(d.products).map(p => {
    const c = cats.get(p.category);
    return {
      id: p.id, name: p.name, sku: p.sku || '', brand: p.brand || '', category: c ? c.name : p.category,
      subcategory: c && p.subcategory ? findChild(c, p.subcategory)?.name || '' : '',
      price: p.price, sale: p.sale ?? '', quantity: p.quantity ?? '', unit: p.unit || 'piece', stock: p.stock,
      visible: p.visible !== false, featured: !!p.featured, tags: list(p.tags).join('|'), description: p.description || '',
      image: p.image || '', gallery: list(p.gallery).map(g => typeof g === 'string' ? g : g.ref).join('|'),
    };
  });
}
export const productsCsv = doc => toCsv(productRows(doc), PRODUCT_COLUMNS);
export const templateCsv = () => toCsv([{
  id: '', name: 'Example: Motul chain lube 400 ml', sku: 'EXAMPLE-001', brand: 'Motul', category: 'Engine oil', subcategory: 'Chain care',
  price: 1500, sale: 1350, quantity: 12, unit: 'bottle', stock: 'In stock', visible: true, featured: false,
  tags: 'chain|lube', description: 'Delete this example row and add your own products.', image: DEFAULT_PRODUCT_IMAGE, gallery: '',
}], PRODUCT_COLUMNS);
export const exportFileName = (now = new Date()) => `moto-market-products-${now.toISOString().slice(0, 10)}.csv`;

// ── import ─────────────────────────────────────────────────────────────────────────────────────
const key = v => String(v ?? '').trim().toLowerCase();
const DIGITS = {'০': 0, '১': 1, '২': 2, '৩': 3, '৪': 4, '৫': 5, '৬': 6, '৭': 7, '৮': 8, '৯': 9};
// "৳1,350", "1350.00", "১৩৫০" → 1350; '' → null; anything else → NaN
export function wholeNumber(v) {
  const s = String(v ?? '').trim().replace(/[০-৯]/g, d => DIGITS[d]).replace(/^(?:৳|tk\.?|bdt)\s*/i, '').replace(/\s*(?:৳|tk\.?|bdt|\/-)$/i, '').replace(/[,\s]/g, '');
  if (s === '') return null;
  if (!/^-?\d+(\.0+)?$/.test(s)) return NaN;
  return Number.parseInt(s, 10);
}
const YES = new Set(['yes', 'y', 'true', '1', 'visible', 'shown', 'show', 'হ্যাঁ']);
const NO = new Set(['no', 'n', 'false', '0', 'hidden', 'hide', 'না']);
const yesNo = v => { const k = key(v); return YES.has(k) ? true : NO.has(k) ? false : undefined; };
const STOCK_WORDS = {'in stock': 'In stock', 'in': 'In stock', 'available': 'In stock', 'out of stock': 'Out of stock', 'out': 'Out of stock', 'sold out': 'Out of stock', 'ask us': 'Ask us', 'ask': 'Ask us'};
const splitList = v => { const s = String(v ?? ''); return (s.includes('|') ? s.split('|') : s.split(',')).map(x => x.trim()).filter(Boolean); };
const uniqueId = (base, taken) => { let id = base.slice(0, 90) || 'x'; if (!taken.has(id)) return id; for (let n = 2; ; n++) if (!taken.has(id + '-' + n)) return id + '-' + n; };

// rows: the output of parseCsv (first row is the header) or an array of objects keyed by column.
// Header names are matched case-insensitively; unknown columns are ignored and reported.
// A column that is missing leaves that field as it is. A blank cell in a present column clears an
// optional field (sku, brand, subcategory, sale, quantity, tags, description, gallery) and keeps a
// required one (name, category, price, image, unit, stock, visible, featured).
// Matching: id, then sku (case-insensitive), then exact name; otherwise a new product is created.
// Rows with errors are skipped; everything else is applied to `next`.
// report: {created, updated, unchanged, errors:[{row, message}], newCategories:[names], newSubs:[
// 'Category › Sub'], rows:[{row, status:'new'|'updated'|'unchanged'|'error', id, name, message?}],
// ignoredColumns, products, bytes, limits, canImport}
// Row numbers are spreadsheet line numbers (the header is row 1).
export function planImport(doc, rows, opts = {}) {
  const now = (opts.now instanceof Date ? opts.now : new Date()).toISOString();
  const next = normalise(doc);
  next.products ||= []; next.categories ||= [];
  const report = {created: 0, updated: 0, unchanged: 0, errors: [], newCategories: [], newSubs: [], rows: [], ignoredColumns: [], products: 0, bytes: 0, limits: LIMITS_IMPORT, canImport: false};
  const err = (row, message) => { report.errors.push({row, message}); };

  // Normalise input into [{row, values}] with lowercased column keys.
  let records = [];
  if (Array.isArray(rows) && rows.length && Array.isArray(rows[0])) {
    const header = rows[0].map(h => key(unguard(h)));
    const known = header.map(h => PRODUCT_COLUMNS.includes(h));
    report.ignoredColumns = rows[0].filter((h, i) => !known[i] && String(h).trim());
    const seen = new Set();
    header.forEach((h, i) => { if (known[i] && seen.has(h)) err(1, `The column "${h}" appears twice.`); seen.add(h); });
    if (!header.includes('name') && !header.includes('id') && !header.includes('sku')) err(1, 'The first row must name the columns (id, name, sku, price …). Download the template to see them.');
    records = rows.slice(1).map((r, i) => ({row: i + 2, values: Object.fromEntries(header.map((h, j) => [h, r[j]]).filter(([h], j) => known[j]))}));
  } else if (Array.isArray(rows)) {
    records = rows.map((r, i) => ({row: i + 2, values: Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [key(k), v]).filter(([k]) => PRODUCT_COLUMNS.includes(k)))}));
  }
  if (report.errors.length) return finish();

  const byId = new Map(next.products.map(p => [p.id, p]));
  const bySku = new Map(next.products.filter(p => p.sku).map(p => [key(p.sku), p]));
  const byName = new Map();
  for (const p of next.products) if (!byName.has(String(p.name).trim())) byName.set(String(p.name).trim(), p);
  const productIds = new Set(byId.keys());
  const matchedRows = new Map();
  const categoryIds = new Set(next.categories.map(c => c.id));
  const findCategory = v => next.categories.find(c => c.id === v) || next.categories.find(c => key(c.name) === key(v)) || null;

  for (const {row, values: raw} of records) {
    const v = Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, unguard(String(x ?? '')).trim()]));
    const has = k => k in v;
    if (!Object.values(v).some(Boolean)) continue;
    const problems = [];
    const no = m => problems.push(m);

    // match
    let existing = null;
    if (v.id) existing = byId.get(v.id) || null;
    if (!existing && v.sku) existing = bySku.get(key(v.sku)) || null;
    if (!existing && v.name) existing = byName.get(v.name) || null;
    if (existing && matchedRows.has(existing.id)) { record(row, 'error', existing.id, existing.name, `This product is already in row ${matchedRows.get(existing.id)}.`); continue; }
    const p = existing ? structuredClone(existing) : {
      id: '', name: '', brand: '', category: '', subcategory: '', price: null, sale: null, image: DEFAULT_PRODUCT_IMAGE, gallery: [], stock: 'In stock',
      quantity: null, unit: 'piece', description: '', badge: '', featured: false, specifications: '', fitment: 'Ask us to confirm', vehicleIds: [], vehicleTypes: [], colors: [], visible: true, updatedAt: null,
    };
    const staged = {category: null, sub: null};

    if (has('name') && v.name) { if (v.name.length > 150) no('Name must be 150 characters or fewer.'); else p.name = v.name; }
    if (!p.name) no('Name is required.');
    if (has('sku')) {
      if (v.sku.length > 60) no('SKU must be 60 characters or fewer.');
      else if (v.sku) p.sku = v.sku; else delete p.sku;
    }
    if (has('brand')) { if (v.brand.length > 100) no('Brand must be 100 characters or fewer.'); else p.brand = v.brand; }
    // category / subcategory (names, or ids; missing ones are created)
    let cat = existing ? next.categories.find(c => c.id === p.category) : null;
    if (has('category') && v.category) {
      cat = findCategory(v.category);
      if (!cat) {
        if (v.category.length > 100) no('Category names can be up to 100 characters.');
        else staged.category = v.category;
      }
    }
    if (!cat && !staged.category) no('Category is required.');
    let subValue = has('subcategory') ? v.subcategory : (cat && cat.id === existing?.category ? p.subcategory : '');
    if (has('category') && v.category && cat && existing && cat.id !== existing.category && !has('subcategory')) {
      // Moved to another category: keep a subcategory with the same name, if there is one.
      const old = findChild(next.categories.find(c => c.id === existing.category), existing.subcategory);
      subValue = old ? old.name : '';
    }
    if (subValue) {
      const child = cat ? findChild(cat, subValue) : null;
      if (!child) { if (subValue.length > 100) no('Subcategory names can be up to 100 characters.'); else staged.sub = subValue; }
      else p.subcategory = child.id;
    } else p.subcategory = '';
    // numbers
    if (has('price') && v.price) { const n = wholeNumber(v.price); if (!Number.isSafeInteger(n) || n <= 0 || n > 100000000) no('Price must be a positive whole BDT amount.'); else p.price = n; }
    if (!(Number.isSafeInteger(p.price) && p.price > 0)) { if (!problems.some(m => m.startsWith('Price'))) no('Price is required.'); }
    if (has('sale')) { if (!v.sale) p.sale = null; else { const n = wholeNumber(v.sale); if (!Number.isSafeInteger(n) || n <= 0) no('Discount price must be a positive whole BDT amount, or empty.'); else p.sale = n; } }
    if (p.sale !== null && p.sale !== '' && p.sale !== undefined && Number.isSafeInteger(p.price) && !(p.sale < p.price)) no('Discount price must be lower than the price.');
    if (has('quantity')) { if (!v.quantity) { if (p.quantity != null) p.quantity = null; } else { const n = wholeNumber(v.quantity); if (!Number.isSafeInteger(n) || n < 0 || n > 999999) no('Quantity must be a whole number from 0 to 999999, or empty.'); else p.quantity = n; } }
    if (has('unit') && v.unit) { const u = key(v.unit).replace(/s$/, '').replace(/^liter$/, 'litre'); if (!units.includes(u)) no(`Unit must be one of: ${units.join(', ')}.`); else if (u !== (p.unit || 'piece')) p.unit = u; }
    if (has('stock') && v.stock) { const st = STOCK_WORDS[key(v.stock)]; if (!st) no(`Stock must be one of: ${STOCK.join(', ')}.`); else p.stock = st; }
    for (const f of ['visible', 'featured']) if (has(f) && v[f]) { const b = yesNo(v[f]); if (b === undefined) no(`${f === 'visible' ? 'Visible' : 'Featured'} must be yes or no.`); else p[f] = b; }
    if (has('tags')) {
      const tags = [...new Set(splitList(v.tags))];
      if (tags.length > LIMITS_IMPORT.tags || tags.some(t => t.length > 40)) no('Use up to 20 tags of 40 characters each.');
      else if (tags.length) p.tags = tags; else delete p.tags;
    }
    if (has('description')) { if (v.description.length > 5000) no('Description must be 5000 characters or fewer.'); else p.description = v.description; }
    if (has('image') && v.image) { if (!imageRef(v.image)) no('Image must be a library photo (media:…) or an assets/ path ending in .png, .webp or .jpg.'); else p.image = v.image; }
    if (has('gallery')) {
      const refs = splitList(v.gallery.replace(/,/g, '|'));
      if (refs.length > LIMITS_IMPORT.gallery) no(`Use up to ${LIMITS_IMPORT.gallery} gallery photos.`);
      else if (refs.some(r => !imageRef(r))) no('Gallery photos must be library photos (media:…) or assets/ paths, separated by |.');
      else { const old = new Map(list(existing?.gallery).map(g => typeof g === 'string' ? [g, {ref: g}] : [g.ref, g])); p.gallery = refs.map(r => old.get(r) ? structuredClone(old.get(r)) : {ref: r}); }
    }
    // id for a new product: the given one when free and valid, else a fresh one
    if (!existing) {
      if (v.id && (!ID.test(v.id) || productIds.has(v.id))) no('This id is not valid or is already used by another product.');
      p.id = v.id || uniqueId('product-' + slug(p.name || 'item'), productIds);
    }
    // SKU unique (case-insensitive)
    if (p.sku) { const other = bySku.get(key(p.sku)); if (other && other.id !== p.id) no(`The SKU ${p.sku} is already used by ${other.name}.`); }
    if (problems.length) { record(row, 'error', existing?.id || '', p.name || v.name || '', problems.join(' ')); continue; }

    // create staged categories and subcategories
    if (staged.category) {
      cat = findCategory(staged.category);
      if (!cat) {
        if (next.categories.length >= LIMITS_IMPORT.categories) { record(row, 'error', existing?.id || '', p.name, `You can have up to ${LIMITS_IMPORT.categories} categories.`); continue; }
        cat = {id: uniqueId(slug(staged.category), categoryIds), name: staged.category, children: [], visible: true, image: DEFAULT_CATEGORY_IMAGE, description: ''};
        categoryIds.add(cat.id); next.categories.push(cat); report.newCategories.push(cat.name);
      }
    }
    if (staged.sub) {
      let child = findChild(cat, staged.sub);
      if (!child) {
        if (cat.children.length >= LIMITS_IMPORT.children) { record(row, 'error', existing?.id || '', p.name, `${cat.name} already has ${LIMITS_IMPORT.children} subcategories.`); continue; }
        child = {id: subId(staged.sub, new Set(cat.children.map(c => c.id))), name: staged.sub, visible: true};
        cat.children.push(child); report.newSubs.push(cat.name + ' › ' + child.name);
      }
      p.subcategory = child.id;
    }
    p.category = cat.id;

    if (existing) {
      matchedRows.set(existing.id, row);
      const before = JSON.stringify({...existing, updatedAt: null}), after = JSON.stringify({...p, updatedAt: null});
      if (before === after) { record(row, 'unchanged', p.id, p.name); report.unchanged++; continue; }
      p.updatedAt = now;
      next.products[next.products.indexOf(existing)] = p;
      byId.set(p.id, p);
      if (existing.sku) bySku.delete(key(existing.sku));
      if (p.sku) bySku.set(key(p.sku), p);
      record(row, 'updated', p.id, p.name); report.updated++;
    } else {
      p.updatedAt = now;
      next.products.push(p);
      productIds.add(p.id); byId.set(p.id, p); matchedRows.set(p.id, row);
      if (p.sku) bySku.set(key(p.sku), p);
      if (!byName.has(p.name)) byName.set(p.name, p);
      record(row, 'new', p.id, p.name, v.id ? `id ${v.id} not found – will be added as a new product.` : undefined); report.created++;
    }
  }
  return finish();

  function record(row, status, id, name, message) {
    report.rows.push(message ? {row, status, id, name, message} : {row, status, id, name});
    if (status === 'error') err(row, message);
  }
  function finish() {
    report.products = next.products.length;
    report.bytes = JSON.stringify(next).length;
    report.overProducts = report.products > LIMITS_IMPORT.products;
    report.overBytes = report.bytes > LIMITS_IMPORT.bytes;
    report.canImport = !report.overProducts && !report.overBytes && report.created + report.updated > 0;
    return {next, report};
  }
}

// "Imported 120 products (18 new)"
export function importLabel(report) {
  const n = report.created + report.updated;
  return `Imported ${n} product${n === 1 ? '' : 's'}${report.created ? ` (${report.created} new)` : ''}`;
}
