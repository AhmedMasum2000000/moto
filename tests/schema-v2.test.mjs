// Server validation of the v2 content shape (subcategory records, sections, layout, brand groups,
// new product fields) and the public document, with the stored v1 shape still accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateContent, publicDocument, validateRequest, validateStoreSettings, EMAIL, mediaReferences, resolveMedia} from '../supabase/functions/moto-admin/schema.mjs';
import {normalise, defaultLayout} from '../cms/content-model.mjs';

const seed = () => JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json', import.meta.url), 'utf8'));
const legacy = () => {
  const d = seed();
  delete d.sections; delete d.layout; delete d.brandGroups;
  d.content = d.content.filter(c => !['shop-catalog', 'shop-kits', 'shop-partners'].includes(c.id));
  return d;
};
const v2 = () => normalise(seed());
const helmets = d => d.categories.find(c => c.id === 'helmets');
const section = (over = {}) => ({id: 'sec-1', page: 'index', kind: 'carousel', title: 'Engine oil deals', visible: true, limit: 12, sort: 'featured', source: {type: 'category', category: 'oil'}, ...over});
const withSection = (d, s) => { d.sections.push(s); d.layout[s.page].push('section:' + s.id); return d; };
const rejects = (change, pattern) => { const d = v2(); change(d); assert.throws(() => validateContent(d), pattern, String(change)); };

test('existing exports are still there', () => {
  for (const f of [validateContent, publicDocument, validateRequest, validateStoreSettings, mediaReferences, resolveMedia]) assert.equal(typeof f, 'function');
  assert(EMAIL.test('owner@example.com'));
});

test('the stored v1 document and its normalised form both validate', () => {
  const old = legacy(), before = structuredClone(old);
  const out = validateContent(old);
  assert.deepEqual(old, before, 'the input is not rewritten');
  assert.equal(typeof helmets(out).children[0], 'object');
  assert.deepEqual(out.layout, defaultLayout());
  assert.equal(out.brandGroups.length, 3);
  validateContent(out);
  validateContent(seed());
  validateContent(v2());
  // Old-style references with names keep validating.
  const d = legacy(); d.products[0].category = 'helmets'; d.products[0].subcategory = 'Raincoat';
  const card = d.blocks.find(b => b.kind === 'category'); card.target = 'helmets'; card.subcategories = ['Led', 'Intercom'];
  d.products[1].gallery = ['assets/icons/engine-oil.png'];
  const n = validateContent(d);
  assert.equal(n.products[0].subcategory, 'sub-raincoat');
  assert.deepEqual(n.blocks.find(b => b.id === card.id).subcategories, ['sub-led', 'sub-intercom']);
  assert.deepEqual(n.products[1].gallery, [{ref: 'assets/icons/engine-oil.png'}]);
});

test('subcategory records: ids, names and references are checked', () => {
  rejects(d => { helmets(d).children[1].name = 'fog light'; }, /same name/);
  rejects(d => { helmets(d).children[1].id = helmets(d).children[0].id; }, /Duplicate children ID/);
  rejects(d => { helmets(d).children[0].id = 'bad id!'; }, /Invalid children ID/);
  rejects(d => { helmets(d).children[0].visible = 'yes'; }, /visibility/);
  rejects(d => { helmets(d).children[0].image = 'javascript:x'; }, /subcategory picture/);
  rejects(d => { d.products[0].category = 'helmets'; d.products[0].subcategory = 'sub-nope'; }, /subcategory inside/);
  rejects(d => { d.products[0].category = 'oil'; d.products[0].subcategory = 'sub-led'; }, /subcategory inside/);
  rejects(d => { const b = d.blocks.find(b => b.kind === 'category'); b.target = 'helmets'; b.subcategories = ['sub-ghost']; }, /subcategories inside/);
  const d = v2(); Object.assign(helmets(d).children[0], {visible: false, image: 'assets/icons/engine-oil.png', description: 'Bright'});
  d.products[0].category = 'helmets'; d.products[0].subcategory = helmets(d).children[0].id;
  validateContent(d);
});

test('new product fields: sku, tags, lowStock, gallery objects, updatedAt', () => {
  const ok = v2(), p = ok.products[0];
  Object.assign(p, {sku: 'MOT-7100', tags: ['synthetic', '10w-40'], lowStock: 5, updatedAt: '2026-11-10T08:30:00.000Z', gallery: Array.from({length: 12}, (_, i) => ({ref: 'assets/icons/engine-oil.png', alt: 'Side ' + i}))});
  ok.products[1].sku = '';
  validateContent(ok);
  rejects(d => { d.products[0].gallery = Array.from({length: 13}, () => ({ref: 'assets/icons/engine-oil.png'})); }, /gallery/);
  rejects(d => { d.products[0].gallery = [{ref: 'javascript:x'}]; }, /gallery/);
  rejects(d => { d.products[0].gallery = [{ref: 'assets/icons/engine-oil.png', alt: 'x'.repeat(151)}]; }, /gallery/);
  rejects(d => { d.products[0].sku = 'abc-1'; d.products[1].sku = 'ABC-1'; }, /same SKU/);
  rejects(d => { d.products[0].sku = 'x'.repeat(61); }, /SKU/);
  rejects(d => { d.products[0].tags = Array.from({length: 21}, (_, i) => 't' + i); }, /tags/);
  rejects(d => { d.products[0].tags = ['x'.repeat(41)]; }, /tags/);
  rejects(d => { d.products[0].lowStock = -1; }, /Low-stock/);
  rejects(d => { d.products[0].lowStock = 1.5; }, /Low-stock/);
  rejects(d => { d.products[0].updatedAt = 'yesterday'; }, /edit time/);
});

test('brand groups: brands must use an existing group; groups need names and valid shop targets', () => {
  rejects(d => { d.brands[0].group = 'filters'; }, /existing brand group/);
  rejects(d => { d.brandGroups[0].name = ''; }, /Brand group name/);
  rejects(d => { d.brandGroups[0].shopTarget = 'nowhere'; }, /shop page/);
  rejects(d => { d.brandGroups.push({...d.brandGroups[0]}); }, /Duplicate brandGroups ID/);
  rejects(d => { d.brandGroups = Array.from({length: 31}, (_, i) => ({id: 'g' + i, name: 'G' + i, visible: true})); }, /brandGroups/);
  const d = v2(); d.brandGroups.push({id: 'filters', name: 'Filters', visible: false, shopTarget: 'parts'}); d.brands[0].group = 'filters';
  validateContent(d);
});

test('sections: every kind validates with its fields', () => {
  const d = v2(), led = helmets(d).children[2].id;
  withSection(d, section());
  withSection(d, section({id: 'sec-2', page: 'shop', kind: 'grid', source: {type: 'subcategory', category: 'helmets', subcategory: led}, sort: 'low', button: {label: 'All helmets', target: 'helmets'}}));
  withSection(d, section({id: 'sec-3', kind: 'carousel', source: {type: 'products', productIds: d.products.slice(0, 3).map(p => p.id)}, sort: 'manual'}));
  withSection(d, section({id: 'sec-4', source: {type: 'brand', brand: 'motul'}}));
  for (const type of ['sale', 'featured', 'newest', 'all']) withSection(d, section({id: 'sec-' + type, source: {type}}));
  withSection(d, {id: 'sec-cat', page: 'index', kind: 'categories', title: 'Shop by part', category: 'helmets'});
  withSection(d, {id: 'sec-kits', page: 'shop', kind: 'kits', title: 'Bundles', kitIds: [d.kits[0].id]});
  withSection(d, {id: 'sec-brands', page: 'index', kind: 'brands', title: 'Oil brands', group: 'oil'});
  withSection(d, {id: 'sec-promo', page: 'index', kind: 'promo', title: 'Promo', heading: 'Free check-up', text: 'This week', image: 'assets/icons/engine-oil.png', button: {label: 'Book', target: 'Services'}});
  withSection(d, {id: 'sec-faq', page: 'index', kind: 'faq', title: 'Questions', items: [{q: 'Do you fit tyres?', a: 'Yes, while you wait.'}]});
  withSection(d, {id: 'sec-text', page: 'shop', kind: 'text', title: 'About', body: '## Hello\n\n- one\n- two'});
  validateContent(d);
  // The popular products builtin may carry its own product source.
  const pop = v2(); pop.content.find(c => c.id === 'index-popular').source = {type: 'featured', limit: 16};
  validateContent(pop);
});

test('sections: each rule rejects bad input', () => {
  const bad = (over, pattern) => rejects(d => withSection(d, section(over)), pattern);
  rejects(d => { d.sections.push(section({page: 'book'})); d.layout.index.push('section:sec-1'); }, /homepage or the shop/);
  bad({kind: 'html'}, /section type/);
  bad({title: ''}, /Section title/);
  bad({label: 'x'.repeat(61)}, /Section label/);
  bad({intro: 'x'.repeat(501)}, /introduction/);
  bad({limit: 0}, /between 1 and 24/);
  bad({limit: 25}, /between 1 and 24/);
  bad({sort: 'random'}, /sorted/);
  bad({source: undefined}, /what the section shows/);
  bad({source: {type: 'popular'}}, /what the section shows/);
  bad({source: {type: 'category'}}, /existing category/);
  bad({source: {type: 'category', category: 'nope'}}, /existing category/);
  bad({source: {type: 'subcategory', category: 'helmets'}}, /subcategory inside/);
  bad({source: {type: 'subcategory', category: 'oil', subcategory: 'sub-led'}}, /subcategory inside/);
  bad({source: {type: 'brand', brand: 'Nobody'}}, /existing brand/);
  bad({source: {type: 'products'}}, /products for the section/);
  bad({source: {type: 'products', productIds: ['ghost']}}, /48 different existing/);
  rejects(d => withSection(d, section({source: {type: 'products', productIds: Array.from({length: 49}, (_, i) => d.products[i % d.products.length].id)}})), /48 different/);
  rejects(d => withSection(d, section({source: {type: 'products', productIds: [d.products[0].id, d.products[0].id]}})), /48 different/);
  bad({button: {label: 'Go', target: 'javascript:alert(1)'}}, /button destination/);
  bad({image: 'https://evil.example/x.png'}, /section picture/);
  bad({kind: 'kits', kitIds: ['ghost']}, /existing bundles/);
  bad({kind: 'brands', group: 'ghost'}, /existing brand group/);
  bad({kind: 'categories', category: 'ghost'}, /existing category/);
  bad({kind: 'faq', items: [{q: '', a: 'x'}]}, /Question/);
  bad({kind: 'faq', items: Array.from({length: 31}, () => ({q: 'q', a: 'a'}))}, /30 questions/);
  bad({kind: 'text', body: 'x'.repeat(5001)}, /Section text/);
  bad({kind: 'text', html: '<script>alert(1)</script>'}, /cannot contain code/);
  bad({visible: 'yes'}, /visibility/);
  rejects(d => { withSection(d, section()); withSection(d, section()); }, /Duplicate sections ID/);
  rejects(d => { d.content.find(c => c.id === 'index-popular').source = {type: 'featured', limit: 49}; }, /between 1 and 48/);
});

test('layout: refs must be known, unique, unpinned and cover every section exactly once', () => {
  rejects(d => { d.layout.index.push('builtin:nope'); }, /built-in/);
  rejects(d => { d.layout.index.push('builtin:index-fitment'); }, /built-in/);
  rejects(d => { d.layout.shop.push('builtin:index-dealer'); }, /built-in/);
  rejects(d => { d.layout.index.push('section:ghost'); }, /missing section/);
  rejects(d => { d.layout.index.push(d.layout.index[0]); }, /twice/);
  rejects(d => { d.layout.index.push('javascript:alert(1)'); }, /layout entry/);
  rejects(d => { d.sections.push(section()); }, /placed in its page layout/);
  rejects(d => { d.sections.push(section()); d.layout.shop.push('section:sec-1'); }, /missing section/);
  rejects(d => { d.layout.index = Array.from({length: 81}, (_, i) => 'section:s' + i); }, /Invalid page layout/);
  rejects(d => { d.layout = []; }, /Invalid page layout/);
  // Builtins may be left out (they come back appended) and reordered.
  const d = v2(); d.layout.index = ['builtin:index-dealer', 'builtin:index-popular']; d.layout.shop = [];
  validateContent(d);
});

test('publicDocument strips hidden subcategories, sections, refs and products; order email stays private', () => {
  const d = v2(), kids = helmets(d).children, hidden = kids[0], shown = kids[1];
  hidden.visible = false;
  const [p0, p1, p2] = d.products;
  p0.category = p1.category = 'helmets'; p0.subcategory = hidden.id; p1.subcategory = shown.id; p2.visible = false;
  const card = d.blocks.find(b => b.kind === 'category'); card.target = 'helmets'; card.subcategories = [hidden.id, shown.id];
  d.brandGroups.find(g => g.id === 'tyres').visible = false;
  withSection(d, section({id: 'off', visible: false}));
  withSection(d, section({id: 'gone-sub', source: {type: 'subcategory', category: 'helmets', subcategory: hidden.id}}));
  withSection(d, section({id: 'gone-brand', source: {type: 'brand', brand: d.brands.find(b => b.group === 'tyres').name}}));
  withSection(d, {id: 'gone-group', page: 'index', kind: 'brands', title: 'Tyres', group: 'tyres'});
  withSection(d, section({id: 'picked', page: 'shop', source: {type: 'products', productIds: [p0.id, p2.id, p1.id]}}));
  d.content.find(c => c.id === 'index-popular').source = {type: 'products', productIds: [p2.id, p1.id]};
  d.settings.orderEmail = 'owner@example.com';
  p1.gallery = [{ref: 'assets/icons/engine-oil.png', alt: 'Box'}];
  validateContent(d);
  p1.gallery.push({ref: ''});
  const pub = publicDocument(d);
  assert(!('orderEmail' in pub.settings));
  assert.deepEqual(helmets(pub).children.map(c => c.id), kids.filter(c => c.visible !== false).map(c => c.id));
  assert.equal(pub.products.find(p => p.id === p0.id).subcategory, '', 'product stays in its category');
  assert.equal(pub.products.find(p => p.id === p0.id).category, 'helmets');
  assert.equal(pub.products.find(p => p.id === p1.id).subcategory, shown.id);
  assert.deepEqual(pub.blocks.find(b => b.id === card.id).subcategories, [shown.id]);
  assert.deepEqual(pub.sections.map(s => s.id), ['picked']);
  assert.deepEqual(pub.sections[0].source.productIds, [p0.id, p1.id]);
  assert.deepEqual(pub.content.find(c => c.id === 'index-popular').source.productIds, [p1.id]);
  for (const id of ['off', 'gone-sub', 'gone-brand', 'gone-group']) for (const page of ['index', 'shop']) assert(!pub.layout[page].includes('section:' + id), id);
  assert(pub.layout.shop.includes('section:picked'));
  assert(!pub.brandGroups.some(g => g.id === 'tyres'));
  assert(!pub.brands.some(b => b.group === 'tyres'));
  assert.deepEqual(pub.products.find(p => p.id === p1.id).gallery, [{ref: 'assets/icons/engine-oil.png', alt: 'Box'}]);
  // The published document is itself valid and stays the same when published again.
  validateContent(structuredClone(pub));
  assert.deepEqual(d.settings.orderEmail, 'owner@example.com', 'the draft keeps its private settings');
});

test('publicDocument upgrades a stored v1 document; requests still validate against it', () => {
  const pub = publicDocument(legacy());
  assert.deepEqual(pub.layout, defaultLayout());
  assert.deepEqual(pub.sections, []);
  assert.equal(typeof helmets(pub).children[0], 'object');
  const p = pub.products.find(p => p.stock !== 'Out of stock' && !p.colors?.length);
  const r = validateRequest({key: crypto.randomUUID(), name: 'Test', phone: '01700000000', address: 'Kushtia 7000', delivery: 'inside', kind: 'order', items: [{id: p.id, qty: 1}], expectedTotalMinor: (p.sale || p.price) * 100}, pub);
  assert.equal(r.details.items[0].id, p.id);
});

test('media refs inside gallery objects and sections are found and resolved', () => {
  const d = v2(), id = '123e4567-e89b-12d3-a456-426614174000';
  d.products[0].gallery = [{ref: 'media:' + id, alt: 'Front'}];
  withSection(d, {id: 'promo', page: 'index', kind: 'promo', title: 'Promo', image: 'media:' + id});
  validateContent(d);
  assert(mediaReferences(d).has(id));
  const pub = resolveMedia(publicDocument(d), {[id]: 'https://example.com/p.webp'});
  assert.equal(pub.products[0].gallery[0].ref, 'https://example.com/p.webp');
  assert.equal(pub.sections[0].image, 'https://example.com/p.webp');
});

test('a 2000-product catalogue with 12 photos each stays under the 1.8 MB limit', () => {
  const d = v2(), ref = 'media:123e4567-e89b-12d3-a456-426614174000';
  d.products = Array.from({length: 2000}, (_, i) => ({
    id: 'p-' + i, name: 'Motul 7100 4T 10W-40 1L ' + i, category: 'oil', price: 1500, sale: null, image: ref,
    stock: 'In stock', visible: true, gallery: Array.from({length: 12}, () => ({ref})),
  }));
  d.kits = [];
  const out = validateContent(d);
  assert(JSON.stringify(out).length < 1800000, String(JSON.stringify(out).length));
  d.products.push({...d.products[0], id: 'p-extra'});
  assert.throws(() => validateContent(d), /products/);
});
