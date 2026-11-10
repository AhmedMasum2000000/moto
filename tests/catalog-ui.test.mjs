// Pure parts of the control-room catalog UI (control-room/ui/*.mjs, role I4).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalise} from '../cms/content-model.mjs';
import {validateContent} from '../supabase/functions/moto-admin/schema.mjs';
import {stockState, parseListHash, listHash, filterProducts, sortProducts, canDragProducts, defaultListState} from '../control-room/ui/product-list.mjs';
import {createPending, stageRecord, flushPending, hasPending} from '../control-room/ui/quick-create.mjs';
import {applySubcategoryEdits, productCounts} from '../control-room/ui/subcategories.mjs';
import {normaliseGallery, makeMain, moveGalleryItem, removeGalleryItem, addGalleryRefs} from '../control-room/ui/gallery.mjs';
import {searchProducts} from '../control-room/ui/product-picker.mjs';
import {matchBrands, linkedBrand, refOf} from '../control-room/ui/brand-picker.mjs';
import {moveIds} from '../control-room/ui/sortable.mjs';
import {reassignOptions} from '../control-room/ui/confirm.mjs';

const raw = JSON.parse(readFileSync(new URL('../cms/initial-content.json', import.meta.url)));
function fixture() {
  const d = structuredClone(raw);
  d.categories.find(c => c.id === 'oil').children = ['Synthetic', 'Mineral', 'Gear oil'];
  const oil = d.products.filter(p => p.category === 'oil');
  oil[0].subcategory = 'synthetic'; oil[1].subcategory = 'Mineral'; oil[2].subcategory = 'Mineral';
  oil[0].quantity = 2; oil[1].quantity = 0; oil[2].quantity = 50; oil[2].lowStock = 60;
  oil[0].sku = 'MT-7100'; oil[1].tags = ['racing'];
  oil[0].updatedAt = '2026-11-09T10:00:00.000Z'; oil[2].updatedAt = '2026-11-10T10:00:00.000Z';
  return normalise(d);
}

test('stockState: out, low (default 3 and own level), in', () => {
  assert.equal(stockState({stock: 'Out of stock', quantity: 5}), 'out');
  assert.equal(stockState({stock: 'In stock', quantity: 0}), 'out');
  assert.equal(stockState({stock: 'In stock', quantity: 3}), 'low');
  assert.equal(stockState({stock: 'In stock', quantity: 4}), 'in');
  assert.equal(stockState({stock: 'In stock', quantity: 9, lowStock: 10}), 'low');
  assert.equal(stockState({stock: 'In stock', quantity: null}), 'in');
});

test('list hash round trip keeps only non-default values and rejects junk', () => {
  const s = {...defaultListState(), cat: 'oil', sub: 'sub-mineral', sort: 'price-low', featured: true, q: 'brake pads'};
  const h = listHash(s);
  assert.match(h, /^#products\?/);
  assert.deepEqual(parseListHash(h), s);
  assert.equal(listHash(defaultListState()), '#products');
  const bad = parseListHash('#products?sort=evil&stock=nope&sub=x');
  assert.equal(bad.sort, 'manual'); assert.equal(bad.stock, ''); assert.equal(bad.sub, '', 'sub without cat is dropped');
});

test('filterProducts: category, subcategory id, stock, search over sku, tags and subcategory name', () => {
  const d = fixture();
  const oil = d.products.filter(p => p.category === 'oil');
  assert.equal(filterProducts(d, {cat: 'oil'}).length, oil.length);
  assert.deepEqual(filterProducts(d, {cat: 'oil', sub: 'sub-mineral'}).map(p => p.id), [oil[1].id, oil[2].id]);
  assert.deepEqual(filterProducts(d, {stock: 'out', cat: 'oil'}).map(p => p.id).includes(oil[1].id), true);
  assert.deepEqual(filterProducts(d, {stock: 'low', cat: 'oil'}).map(p => p.id), [oil[0].id, oil[2].id]);
  assert.deepEqual(filterProducts(d, {q: 'mt-7100'}).map(p => p.id), [oil[0].id]);
  assert.deepEqual(filterProducts(d, {q: 'racing'}).map(p => p.id), [oil[1].id]);
  assert.ok(filterProducts(d, {q: 'mineral'}).some(p => p.id === oil[2].id), 'subcategory name is searchable');
  assert.ok(filterProducts(d, {sale: true}).every(p => p.sale > 0 && p.sale < p.price));
  d.categories.find(c => c.id === 'oil').visible = false;
  assert.ok(filterProducts(d, {vis: 'hidden'}).some(p => p.id === oil[0].id), 'products in a hidden category count as hidden');
});

test('sortProducts: price, recent and manual order', () => {
  const d = fixture();
  const list = filterProducts(d, {cat: 'oil'});
  const low = sortProducts(d, list, 'price-low').map(p => p.sale > 0 ? p.sale : p.price);
  assert.deepEqual(low, [...low].sort((a, b) => a - b));
  assert.equal(sortProducts(d, list, 'recent')[0].updatedAt, '2026-11-10T10:00:00.000Z');
  assert.deepEqual(sortProducts(d, [...list].reverse(), 'manual').map(p => p.id), list.map(p => p.id));
  assert.equal(canDragProducts({cat: 'oil', sort: 'manual'}), true);
  assert.equal(canDragProducts({cat: '', sort: 'manual'}), false);
  assert.equal(canDragProducts({cat: 'oil', sort: 'name'}), false);
});

test('quick-create stages records, refuses duplicates and flushes into a valid document', () => {
  const d = fixture();
  const pending = createPending();
  assert.equal(hasPending(pending), false);
  const cat = stageRecord(d, pending, 'category', {name: 'Chains & Sprockets'});
  assert.equal(cat.id, 'chains-sprockets');
  assert.throws(() => stageRecord(d, pending, 'category', {name: 'engine oil'}), /already/);
  const sub = stageRecord(d, pending, 'subcategory', {name: 'O-ring', category: cat.id});
  const sub2 = stageRecord(d, pending, 'subcategory', {name: 'Synthetic 2', category: 'oil'});
  assert.throws(() => stageRecord(d, pending, 'subcategory', {name: 'mineral', category: 'oil'}), /already/);
  assert.throws(() => stageRecord(d, pending, 'subcategory', {name: 'X'}), /category first/);
  const group = stageRecord(d, pending, 'brandGroup', {name: 'Helmets'});
  const brand = stageRecord(d, pending, 'brand', {name: 'Zeta Lube', group: group.id});
  assert.throws(() => stageRecord(d, pending, 'brand', {name: 'motul'}), /already/);
  const page = stageRecord(d, pending, 'page', {name: 'Warranty & returns'});
  assert.equal(page.slug, 'warranty-returns');
  stageRecord(d, pending, 'serviceCategory', {name: 'Tyre fitting'});
  assert.throws(() => stageRecord(d, pending, 'serviceCategory', {name: 'polish'}), /already/);
  assert.throws(() => stageRecord(d, pending, 'category', {name: '   '}), /Type a name/);
  const bangla = stageRecord(d, pending, 'category', {name: 'ইঞ্জিন'});
  assert.match(bangla.id, /^x[0-9a-f]{8}$/);
  const next = flushPending(structuredClone(d), pending);
  assert.equal(next.categories.find(c => c.id === cat.id).children[0].id, sub.id);
  assert.ok(next.categories.find(c => c.id === 'oil').children.some(c => c.id === sub2.id));
  assert.equal(next.brands.find(b => b.id === brand.id).group, group.id);
  assert.ok(next.serviceCategories.includes('Tyre fitting'));
  validateContent(structuredClone(next));
  const twice = flushPending(structuredClone(next), pending);
  assert.equal(twice.categories.length, next.categories.length, 'flush is idempotent');
});

test('applySubcategoryEdits: reorder, rename, add, delete with move and validate', () => {
  const d = fixture();
  const oil = d.categories.find(c => c.id === 'oil');
  assert.deepEqual(productCounts(d, 'oil'), {'sub-synthetic': 1, 'sub-mineral': 2});
  const block = d.blocks.find(b => b.kind === 'category') || null;
  if (block) { block.target = 'oil'; block.subcategories = ['sub-mineral']; }
  const next = structuredClone(d);
  const result = {
    children: [{id: 'sub-gear-oil', name: 'Gear oil', visible: false}, {id: 'sub-synthetic', name: 'Full synthetic', visible: true}, {id: 'sub-fork-oil', name: 'Fork oil', visible: true}],
    removed: [{id: 'sub-mineral', name: 'Mineral', moveTo: 'sub-fork-oil', count: 2}],
  };
  const {children, summary} = applySubcategoryEdits(next, 'oil', result);
  assert.deepEqual(next.categories.find(c => c.id === 'oil').children.map(c => c.name), ['Gear oil', 'Full synthetic', 'Fork oil']);
  assert.equal(children.length, 3);
  assert.equal(summary.length, 1);
  assert.equal(next.products.filter(p => p.subcategory === 'sub-fork-oil').length, 2);
  assert.ok(!next.products.some(p => p.subcategory === 'sub-mineral'));
  if (block) assert.deepEqual(next.blocks.find(b => b.id === block.id).subcategories, []);
  validateContent(structuredClone(next));
  assert.equal(oil.children.length, 3, 'input untouched');
  // A new category only gets its children back.
  assert.deepEqual(applySubcategoryEdits(structuredClone(d), 'nope', {children: [{id: 'sub-a', name: 'A', visible: true}], removed: []}).children, [{id: 'sub-a', name: 'A', visible: true}]);
});

test('gallery helpers: legacy strings, make main, move, remove, limit', () => {
  assert.deepEqual(normaliseGallery(['assets/a.png', {ref: 'assets/b.png', alt: ' Side '}, '', null, {alt: 'x'}]), [{ref: 'assets/a.png'}, {ref: 'assets/b.png', alt: 'Side'}]);
  const p = {image: 'assets/main.png', gallery: ['assets/a.png', 'assets/b.png']};
  makeMain(p, 1);
  assert.equal(p.image, 'assets/b.png');
  assert.deepEqual(p.gallery, [{ref: 'assets/a.png'}, {ref: 'assets/main.png'}]);
  moveGalleryItem(p, 1, 0);
  assert.deepEqual(p.gallery.map(g => g.ref), ['assets/main.png', 'assets/a.png']);
  removeGalleryItem(p, 0);
  assert.deepEqual(p.gallery.map(g => g.ref), ['assets/a.png']);
  const many = {gallery: []};
  assert.deepEqual(addGalleryRefs(many, Array.from({length: 14}, (_, i) => `assets/${i}.png`)), {added: 12, skipped: 2});
});

test('picker, brand matching, refOf, moveIds, reassign options', () => {
  const d = fixture();
  assert.deepEqual(searchProducts(d, 'mt-7100').map(p => p.sku), ['MT-7100']);
  assert.ok(searchProducts(d, '', {limit: 5}).length === 5);
  assert.equal(matchBrands(d.brands, 'mo')[0].name.toLowerCase().startsWith('mo'), true);
  assert.equal(linkedBrand(d.brands, ' motul ').name, 'Motul');
  assert.equal(linkedBrand(d.brands, 'Unknown Oils'), null);
  assert.equal(refOf({media: {id: 'abc'}}), 'media:abc');
  assert.equal(refOf('media:x'), 'media:x');
  assert.deepEqual(moveIds(['a', 'b', 'c'], 'a', 'bottom'), ['b', 'c', 'a']);
  assert.deepEqual(moveIds(['a', 'b', 'c'], 'c', 'up'), ['a', 'c', 'b']);
  const cat = reassignOptions(d, 'category', 'oil');
  assert.equal(cat.required, true);
  assert.ok(!cat.options.some(([id]) => id === 'oil'));
  const sub = reassignOptions(d, 'subcategory', 'oil/sub-mineral');
  assert.equal(sub.required, false);
  assert.equal(sub.options[0][0], '');
  assert.ok(!sub.options.some(([id]) => id === 'sub-mineral'));
  assert.equal(reassignOptions(d, 'subcategory', 'oil/sub-gear-oil'), null);
});

test('ui modules never interpolate raw record text into html', () => {
  for (const f of ['product-list', 'subcategories', 'brand-picker', 'gallery', 'product-picker', 'quick-create', 'confirm']) {
    const src = readFileSync(new URL(`../control-room/ui/${f}.mjs`, import.meta.url), 'utf8');
    // Every ${x.name}/${p.brand}/${c.name}… inside a template goes through esc().
    // (Plain-text messages for textContent / toast / Error have no markup on their line.)
    const raw = src.split('\n').filter(line => /<[a-z]/.test(line)).flatMap(line => line.match(/\$\{(?:[a-z]+\.)(?:name|brand|title|alt|sku|label)\}/g) || []);
    assert.deepEqual(raw, [], f + ' has unescaped interpolations');
  }
});
