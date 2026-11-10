// control-room/lib/bulk.mjs: every bulk action, price rounding, failures and delete with reassign.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyBulk, previewBulk, priceSummary, bulkLabel, newPrice, salePrice, actionsFor, PRODUCT_ACTIONS, ACTION_LABELS} from '../control-room/lib/bulk.mjs';
import {normalise} from '../cms/content-model.mjs';
import {validateContent} from '../supabase/functions/moto-admin/schema.mjs';

const seed = () => JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json', import.meta.url), 'utf8'));
const valid = d => validateContent(structuredClone(d));
const NOW = new Date('2026-11-10T08:00:00.000Z');
const SECTION = '00000000-0000-4000-8000-000000000001';
const doc = () => {
  const d = normalise(seed());
  d.sections = [{id: SECTION, page: 'index', kind: 'grid', title: 'Picks', visible: true, limit: 12, sort: 'manual', source: {type: 'products', productIds: []}}];
  d.layout.index.push('section:' + SECTION);
  return d;
};
const P = (d, id) => d.products.find(p => p.id === id);
const run = (d, ids, action, value, opts) => applyBulk(d, ids, action, value, {now: NOW, ...opts});

test('every product action has a label', () => {
  for (const a of PRODUCT_ACTIONS) assert.ok(ACTION_LABELS[a], a);
  assert.deepEqual(actionsFor('category'), ['show', 'hide', 'duplicate', 'delete']);
  assert.throws(() => run(doc(), [], 'price', {mode: 'pct', delta: 5}, {type: 'category'}), /not available/);
});

test('move to another category and subcategory', () => {
  const d = doc(), ids = d.products.filter(p => p.category === 'oil').slice(0, 3).map(p => p.id);
  const helmets = d.categories.find(c => c.id === 'helmets'), sub = helmets.children[0];
  const before = JSON.stringify(d);
  const r = run(d, ids, 'move', {category: 'helmets', subcategory: sub.id});
  assert.equal(JSON.stringify(d), before, 'input untouched');
  assert.equal(r.changed, 3);
  for (const id of ids) { assert.equal(P(r.next, id).category, 'helmets'); assert.equal(P(r.next, id).subcategory, sub.id); assert.equal(P(r.next, id).updatedAt, NOW.toISOString()); }
  valid(r.next);
  // By subcategory name too.
  assert.equal(P(run(d, ids, 'move', {category: 'helmets', subcategory: sub.name.toUpperCase()}).next, ids[0]).subcategory, sub.id);
  assert.throws(() => run(d, ids, 'move', {category: 'nope'}), /existing category/);
  assert.throws(() => run(d, ids, 'move', {category: 'oil', subcategory: 'nope'}), /subcategory/);
  assert.match(bulkLabel(d, 'move', {category: 'helmets', subcategory: sub.id}, 3), /^Moved 3 products to .+ › /);
});

test('show / hide / feature / unfeature count only real changes', () => {
  const d = doc(), ids = d.products.slice(0, 4).map(p => p.id);
  const hidden = run(d, ids, 'hide');
  assert.equal(hidden.changed, 4);
  assert.ok(ids.every(id => P(hidden.next, id).visible === false));
  assert.equal(run(hidden.next, ids, 'hide').changed, 0);
  assert.equal(run(hidden.next, ids, 'show').changed, 4);
  const f = run(d, ids, 'feature');
  assert.ok(ids.every(id => P(f.next, id).featured === true));
  assert.equal(run(f.next, ids, 'unfeature').changed, 4);
  valid(hidden.next); valid(f.next);
});

test('price change: percent and amount, rounded to a whole taka of at least 1', () => {
  assert.equal(newPrice(1000, {mode: 'pct', delta: 10}), 1100);
  assert.equal(newPrice(999, {mode: 'pct', delta: 5}), 1049);
  assert.equal(newPrice(1001, {mode: 'pct', delta: -0.05}), 1000);
  assert.equal(newPrice(50, {mode: 'amount', delta: -100}), 1);
  assert.equal(newPrice(50, {mode: 'pct', delta: -99.9}), 1);
  assert.equal(salePrice(1000, 15), 850);
  const d = doc();
  const plain = d.products.filter(p => p.sale == null || p.sale === '').slice(0, 2).map(p => p.id);
  const r = run(d, plain, 'price', {mode: 'pct', delta: 10});
  for (const id of plain) assert.equal(P(r.next, id).price, Math.round(P(d, id).price * 1.1));
  valid(r.next);
  assert.throws(() => run(d, plain, 'price', {mode: 'pct', delta: -100}), /100%/);
  assert.throws(() => run(d, plain, 'price', {mode: 'x', delta: 1}), /price change/);
});

test('price cut below the sale price fails that row and leaves it unchanged', () => {
  const d = doc(), onSale = d.products.find(p => p.sale > 0), plain = d.products.find(p => !(p.sale > 0));
  const r = run(d, [onSale.id, plain.id], 'price', {mode: 'amount', delta: -(onSale.price - onSale.sale)});
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].id, onSale.id);
  assert.equal(r.failed[0].name, onSale.name);
  assert.match(r.failed[0].reason, /would not be lower/);
  assert.equal(P(r.next, onSale.id).price, onSale.price);
  assert.equal(r.changed, 1);
  valid(r.next);
  const preview = previewBulk(d, [onSale.id, plain.id], 'price', {mode: 'amount', delta: -(onSale.price - onSale.sale)}, {now: NOW});
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].before.price, plain.price);
  assert.match(priceSummary(previewBulk(d, [plain.id], 'price', {mode: 'pct', delta: 10})), /^1 product: ৳[\d,]+ → ৳[\d,]+$/);
});

test('sale: set a percentage, clear it, and reject impossible ones', () => {
  const d = doc(), ids = d.products.slice(0, 5).map(p => p.id);
  const r = run(d, ids, 'sale', {pct: 20});
  for (const id of ids) assert.equal(P(r.next, id).sale, Math.round(P(d, id).price * 0.8));
  valid(r.next);
  const cleared = run(r.next, ids, 'sale', null);
  assert.ok(ids.every(id => P(cleared.next, id).sale === null));
  valid(cleared.next);
  assert.equal(run(r.next, ids, 'sale', {pct: null}).changed, 5);
  assert.throws(() => run(d, ids, 'sale', {pct: 100}), /between 1 and 99/);
  const cheap = doc(); cheap.products[0].price = 1; cheap.products[0].sale = null;
  const one = run(cheap, [cheap.products[0].id], 'sale', {pct: 10});
  assert.equal(one.failed.length, 1);
  assert.match(bulkLabel(d, 'sale', {pct: 20}, 5), /20% discount on 5 products/);
});

test('stock status and quantity', () => {
  const d = doc(), ids = d.products.slice(0, 3).map(p => p.id);
  const r = run(d, ids, 'stock', {status: 'Out of stock', quantity: 0});
  assert.ok(ids.every(id => P(r.next, id).stock === 'Out of stock' && P(r.next, id).quantity === 0));
  valid(r.next);
  const q = run(d, ids, 'stock', {status: 'In stock', quantity: '25'});
  assert.ok(ids.every(id => P(q.next, id).quantity === 25));
  assert.throws(() => run(d, ids, 'stock', {status: 'Maybe'}), /availability/);
  assert.throws(() => run(d, ids, 'stock', {status: 'In stock', quantity: -1}), /whole number/);
});

test('brand, add to bundle and add to a hand-picked section', () => {
  const d = doc(), ids = d.products.slice(0, 3).map(p => p.id);
  const b = run(d, ids, 'brand', {name: '  Motul '});
  assert.ok(ids.every(id => P(b.next, id).brand === 'Motul'));
  valid(b.next);

  const kit = d.kits[0];
  const k = run(d, ids, 'addToKit', {kitId: kit.id});
  const got = k.next.kits.find(x => x.id === kit.id).productIds;
  assert.ok(ids.every(id => got.includes(id)));
  assert.equal(new Set(got).size, got.length, 'no duplicates');
  valid(k.next);
  assert.throws(() => run(d, ids, 'addToKit', {kitId: 'nope'}), /bundle/);

  const many = d.products.map(p => p.id);
  const full = run(d, many, 'addToKit', {kitId: kit.id});
  assert.equal(full.next.kits.find(x => x.id === kit.id).productIds.length, 20);
  assert.ok(full.failed.length > 0 && full.failed.every(f => /20 products/.test(f.reason)));
  valid(full.next);

  const s = run(d, ids, 'addToSection', {sectionId: SECTION});
  assert.deepEqual(s.next.sections[0].source.productIds, ids);
  valid(s.next);
  const big = doc();
  for (let i = 0; i < 60; i++) big.products.push({...structuredClone(big.products[0]), id: 'clone-' + i, name: 'Clone ' + i, sku: undefined});
  const capped = run(big, big.products.map(p => p.id), 'addToSection', {sectionId: SECTION});
  assert.equal(capped.next.sections[0].source.productIds.length, 48);
  assert.ok(capped.failed.length > 0);
  valid(capped.next);
  const auto = doc(); auto.sections[0].source = {type: 'featured'};
  assert.throws(() => run(auto, ids, 'addToSection', {sectionId: SECTION}), /hand-picked/);
});

test('duplicate many', () => {
  const d = doc(), ids = d.products.slice(0, 3).map(p => p.id);
  const r = run(d, ids, 'duplicate');
  assert.equal(r.changed, 3);
  assert.equal(r.copies.length, 3);
  assert.equal(r.next.products.length, d.products.length + 3);
  assert.equal(new Set(r.next.products.map(p => p.id)).size, r.next.products.length);
  valid(r.next);
});

test('delete products, and categories stop at the first one that needs a new home', () => {
  const d = doc(), ids = d.products.slice(0, 5).map(p => p.id);
  const r = run(d, ids, 'delete');
  assert.equal(r.changed, 5);
  assert.equal(r.next.products.length, d.products.length - 5);
  assert.equal(r.summaries.length, 5);
  valid(r.next);

  // 'after' has products, so deleting [emptyCategory, 'after', 'tyres'] deletes the first and stops.
  d.categories.push({id: 'empty', name: 'Empty', children: [], visible: true, image: 'assets/icons/servicing.png', description: ''});
  const c = run(d, ['empty', 'after', 'tyres'], 'delete', undefined, {type: 'category'});
  assert.equal(c.changed, 1);
  assert.equal(c.stopped, true);
  assert.equal(c.failed[0].id, 'after');
  assert.equal(c.failed[0].reason, 'needs-reassign');
  assert.ok(c.failed[0].refs.length > 0);
  assert.equal(c.failed[1].id, 'tyres');
  assert.ok(c.next.categories.some(x => x.id === 'after'));
  assert.ok(!c.next.categories.some(x => x.id === 'empty'));
  valid(c.next);

  const moved = run(d, ['after'], 'delete', {reassignTo: 'parts'}, {type: 'category'});
  assert.equal(moved.changed, 1);
  valid(moved.next);
});

test('lists: show/hide and duplicate for categories, brands, vehicles, banners and menu', () => {
  const d = doc();
  for (const [type, key] of [['category', 'categories'], ['brand', 'brands'], ['vehicle', 'vehicles'], ['banner', 'banners'], ['menu', 'menu']]) {
    const ids = d[key].slice(0, 2).map(x => x.id);
    const h = run(d, ids, 'hide', undefined, {type});
    assert.equal(h.changed, 2, type);
    valid(h.next);
    const dup = run(d, ids, 'duplicate', undefined, {type});
    assert.equal(dup.next[key].length, d[key].length + 2, type);
    valid(dup.next);
  }
  assert.equal(bulkLabel(d, 'hide', undefined, 2, 'category'), 'Hid 2 categories');
});

test('missing rows are reported, not thrown', () => {
  const d = doc();
  const r = run(d, ['nope', d.products[0].id], 'hide');
  assert.equal(r.changed, 1);
  assert.deepEqual(r.failed.map(f => f.id), ['nope']);
});

test('undo stack: push, pop, peek, clear and the limit', async () => {
  const {createUndo} = await import('../control-room/lib/undo.mjs');
  const u = createUndo(3), seen = [];
  const off = u.subscribe(n => seen.push(n));
  assert.equal(u.pop(), null);
  assert.equal(u.peek(), null);
  for (const n of [1, 2, 3, 4]) u.push('Save ' + n, {n});
  assert.equal(u.size, 3);
  assert.equal(u.peek().label, 'Save 4');
  assert.deepEqual(u.pop().before, {n: 4});
  assert.deepEqual(u.pop().before, {n: 3});
  assert.deepEqual(u.pop().before, {n: 2});
  assert.equal(u.pop(), null, 'the oldest fell off');
  u.push('x', {}); u.push('ignored', null);
  assert.equal(u.size, 1);
  u.clear();
  assert.equal(u.size, 0);
  off();
  u.push('y', {});
  assert.deepEqual(seen, [1, 2, 3, 3, 2, 1, 0, 1, 0]);
  assert.equal(createUndo().limit, 20);
});

test('bulk on a 2000-product document stays fast', () => {
  const d = doc();
  while (d.products.length < 2000) d.products.push({...structuredClone(d.products[0]), id: 'big-' + d.products.length, name: 'Big ' + d.products.length, sku: undefined});
  const ids = d.products.map(p => p.id);
  let t = Date.now();
  const del = run(d, ids.slice(0, 1500), 'delete');
  assert.equal(del.changed, 1500);
  const hide = run(d, ids, 'hide');
  assert.equal(hide.changed, 2000);
  assert.ok(Date.now() - t < 5000, 'took ' + (Date.now() - t) + 'ms');
  valid(del.next);
});

test('a bulk price cut of more than 90% fails that row instead of setting ৳1', () => {
  const d = doc();
  const plain = d.products.filter(p => (p.sale == null || p.sale === '') && p.price > 100).slice(0, 2);
  const r = run(d, plain.map(p => p.id), 'price', {mode: 'amount', delta: -(plain[0].price - 1)});
  assert.ok(r.failed.some(f => f.id === plain[0].id && /90%/.test(f.reason)));
  assert.equal(P(r.next, plain[0].id).price, plain[0].price);
});
