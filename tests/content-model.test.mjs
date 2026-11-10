// cms/content-model.mjs: ids, normalise (v1 → v2), layout and the reference scanner.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  slug, subId, fnv1a, normalise, needsNormalise, BUILTINS, PINNED, PINNED_TOP, PINNED_BOTTOM, defaultLayout,
  resolveLayout, references, mediaUsage, findChild, childName, subRef, parseSubRef, newId, isPinned,
} from '../cms/content-model.mjs';
import * as shared from '../supabase/functions/_shared/content-model.mjs';
import {validateContent} from '../supabase/functions/moto-admin/schema.mjs';
import {withContentDefaults} from '../cms/content-defaults.mjs';

const seed = () => JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json', import.meta.url), 'utf8'));
// The document as it is stored today: no sections, layout, brand groups or structural entries.
const legacy = () => {
  const d = seed();
  delete d.sections; delete d.layout; delete d.brandGroups;
  d.content = d.content.filter(c => !['shop-catalog', 'shop-kits', 'shop-partners'].includes(c.id));
  return d;
};
const helmets = d => d.categories.find(c => c.id === 'helmets');

test('the cms module re-exports the shared server module', () => {
  assert.equal(normalise, shared.normalise);
  assert.equal(references, shared.references);
});

test('slug: lowercase runs joined by hyphens, max 60, hash for names without latin letters', () => {
  assert.equal(slug('Helmet Accessories'), 'helmet-accessories');
  assert.equal(slug('  10W-40 / Gear oil!! '), '10w-40-gear-oil');
  assert.equal(slug('Café Racer'), 'cafe-racer');
  assert.equal(slug('𝖼𝖾𝖺𝗍'), 'ceat');
  assert.equal(slug('a'.repeat(70)).length, 60);
  assert.equal(slug('a'.repeat(59) + ' bcd'), 'a'.repeat(59));
  assert(!slug('a'.repeat(59) + ' bcd').endsWith('-'));
  assert.match(slug('হেলমেট'), /^x[0-9a-f]{8}$/);
  assert.equal(slug('হেলমেট'), 'x' + fnv1a('হেলমেট'));
  assert.notEqual(slug('হেলমেট'), slug('টায়ার'));
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('a'), 'e40c292c');
});

test('subId: sub- prefix with -2, -3 on collision', () => {
  assert.equal(subId('Led', []), 'sub-led');
  assert.equal(subId('Led', ['sub-led']), 'sub-led-2');
  assert.equal(subId('LED', new Set(['sub-led', 'sub-led-2'])), 'sub-led-3');
  assert.equal(subRef('helmets', 'sub-led'), 'helmets/sub-led');
  assert.deepEqual(parseSubRef('helmets/sub-led'), {category: 'helmets', sub: 'sub-led'});
  assert.match(newId(), /^[0-9a-f-]{36}$/);
});

test('normalise turns string subcategories into records with stable ids, keeps order and is idempotent', () => {
  const d = legacy(), before = structuredClone(d);
  const n = normalise(d);
  assert.deepEqual(d, before, 'input is not mutated');
  const kids = helmets(n).children;
  assert.deepEqual(kids.map(k => k.name), helmets(before).children);
  assert.deepEqual(kids.slice(0, 3), [
    {id: 'sub-fog-light', name: 'Fog Light', visible: true},
    {id: 'sub-windbreaker', name: 'Windbreaker', visible: true},
    {id: 'sub-led', name: 'Led', visible: true},
  ]);
  assert.deepEqual(normalise(n), n);
  assert.deepEqual(normalise(normalise(legacy())), n, 'the same ids every time (client and server agree)');
  assert.equal(needsNormalise(legacy()), true);
  assert.equal(needsNormalise(n), false);
});

test('case duplicates collapse, Bangla names get hashed ids, existing ids never change', () => {
  const d = legacy();
  helmets(d).children = ['Oil', 'OIL ', 'হেলমেট', 'টায়ার', 'Oil'];
  const kids = helmets(normalise(d)).children;
  assert.deepEqual(kids.map(k => k.name), ['Oil', 'হেলমেট', 'টায়ার']);
  assert.equal(kids[0].id, 'sub-oil');
  assert.equal(kids[1].id, 'sub-x' + fnv1a('হেলমেট'));
  assert.notEqual(kids[1].id, kids[2].id);
  // Mixed: an existing record keeps its id; a new string avoids it.
  helmets(d).children = [{id: 'sub-oil', name: 'Engine oil', visible: false}, 'Oil'];
  const mixed = helmets(normalise(d)).children;
  assert.deepEqual(mixed[0], {id: 'sub-oil', name: 'Engine oil', visible: false});
  assert.equal(mixed[1].id, 'sub-oil-2');
});

test('product subcategory names map to ids; unmatched names are cleared (or kept for the validator)', () => {
  const d = legacy(), [a, b, c] = d.products;
  a.category = b.category = c.category = 'helmets';
  a.subcategory = 'Led'; b.subcategory = '  hand gloves '; c.subcategory = 'Nope';
  const n = normalise(d);
  assert.equal(n.products[0].subcategory, 'sub-led');
  assert.equal(n.products[1].subcategory, 'sub-hand-gloves');
  assert.equal(n.products[2].subcategory, '');
  assert.equal(normalise(d, {keepUnmatched: true}).products[2].subcategory, 'Nope');
  // An id that already exists is kept as is.
  assert.equal(normalise(n).products[0].subcategory, 'sub-led');
  assert.equal(n.products[0].updatedAt, null);
  assert.equal(findChild(helmets(n), 'LED').id, 'sub-led');
  assert.equal(childName(n, 'helmets', 'sub-led'), 'Led');
  assert.equal(childName(legacy(), 'helmets', 'led'), 'Led');
});

test('block subcategory names map to ids, unmatched are dropped; gallery strings become {ref}', () => {
  const d = legacy();
  const card = d.blocks.find(b => b.kind === 'category');
  card.target = 'helmets'; card.subcategories = ['Led', 'Ghost', 'Raincoat'];
  d.products[0].gallery = ['assets/a.png', {ref: 'assets/b.png', alt: 'Back'}];
  const n = normalise(d);
  assert.deepEqual(n.blocks.find(b => b.id === card.id).subcategories, ['sub-led', 'sub-raincoat']);
  assert.deepEqual(normalise(d, {keepUnmatched: true}).blocks.find(b => b.id === card.id).subcategories, ['sub-led', 'Ghost', 'sub-raincoat']);
  assert.deepEqual(n.products[0].gallery, [{ref: 'assets/a.png'}, {ref: 'assets/b.png', alt: 'Back'}]);
});

test('normalise adds sections, layout and brand groups seeded from the groups in use', () => {
  const n = normalise(legacy());
  assert.deepEqual(n.sections, []);
  assert.deepEqual(n.layout, defaultLayout());
  assert.deepEqual(n.brandGroups.map(g => [g.id, g.name, g.visible, g.shopTarget]), [['tyres', 'Tyres', true, 'tyres'], ['oil', 'Engine oil', true, 'oil'], ['parts', 'Spare parts', true, undefined]]);
  const d = legacy(); d.brands[0].group = 'filters';
  d.content.find(c => c.fields.some(f => f.id === 'index-t66')).fields.find(f => f.id === 'index-t66').value = 'Lubricants';
  const g = normalise(d).brandGroups;
  assert.equal(g.find(x => x.id === 'oil').name, 'Lubricants', 'staff wording is kept');
  assert.deepEqual(g.at(-1), {id: 'filters', name: 'filters', visible: true});
  // Existing structure is left alone.
  const s = seed(); s.layout = {index: ['builtin:index-dealer']};
  assert.deepEqual(normalise(s).layout, {index: ['builtin:index-dealer'], shop: defaultLayout().shop});
  assert.deepEqual(normalise(s).brandGroups, s.brandGroups);
});

test('builtins, pinned and the default layout', () => {
  assert.deepEqual(BUILTINS.index, ['index-fitment', 'index-popular', 'index-brands', 'index-services', 'index-dealer', 'index-brand-partners', 'index-section-5']);
  assert.deepEqual(BUILTINS.shop, ['shop-section-1', 'shop-finder', 'shop-catalog', 'shop-kits', 'shop-partners', 'shop-section-2']);
  for (const id of ['index-fitment', 'index-section-5', 'shop-section-1', 'shop-finder', 'shop-section-2']) assert(PINNED.includes(id) && PINNED.has(id) && isPinned(id), id);
  assert.deepEqual(PINNED.shop, [...PINNED_TOP.shop, ...PINNED_BOTTOM.shop]);
  assert(!isPinned('index-popular'));
  assert.deepEqual(defaultLayout(), {
    index: ['builtin:index-popular', 'builtin:index-brands', 'builtin:index-services', 'builtin:index-dealer', 'builtin:index-brand-partners'],
    shop: ['builtin:shop-catalog', 'builtin:shop-kits', 'builtin:shop-partners'],
  });
  assert.deepEqual(seed().layout, defaultLayout(), 'the seed stores the default layout');
});

test('resolveLayout drops unknown, duplicate and pinned refs and appends missing builtins', () => {
  const d = normalise(seed());
  d.sections = [{id: 's1', page: 'index', kind: 'text', title: 'Hi', body: 'x'}, {id: 's2', page: 'shop', kind: 'text', title: 'Shop', body: 'x'}];
  d.layout.index = ['section:s1', 'builtin:index-dealer', 'builtin:index-fitment', 'builtin:nope', 'section:gone', 'section:s2', 'section:s1', 'junk'];
  const r = resolveLayout(d, 'index');
  assert.deepEqual(r, ['section:s1', 'builtin:index-dealer', 'builtin:index-popular', 'builtin:index-brands', 'builtin:index-services', 'builtin:index-brand-partners']);
  assert(!r.some(x => PINNED.includes(x.slice(8))));
  assert.deepEqual(resolveLayout(legacy(), 'shop'), defaultLayout().shop);
  assert.deepEqual(resolveLayout(d, 'shop'), [...defaultLayout().shop, 'section:s2'], 'a section missing from the layout is still shown');
  assert.deepEqual(resolveLayout(d, 'book'), []);
});

// A v2 document with something pointing at every kind of record.
function wired() {
  const d = normalise(seed());
  const h = helmets(d), led = h.children.find(c => c.name === 'Led');
  const [p0, p1] = d.products;
  p0.category = 'helmets'; p0.subcategory = led.id; p0.brand = 'bajaj'; p0.vehicleIds = [d.vehicles[0].id];
  d.kits[0].productIds = [p0.id, p1.id];
  const card = d.blocks.find(b => b.kind === 'category'); card.target = 'helmets'; card.subcategories = [led.id];
  d.pages.push({id: 'promo', custom: true, name: 'Promo', title: 'Promo', description: '', shareImage: d.settings.logo, slug: 'promo', html: '', css: ''});
  d.menu.push({id: 'menu-t-helmets', name: 'Helmets', target: 'helmets', visible: true}, {id: 'menu-t-promo', name: 'Promo', target: 'page:promo', visible: true});
  d.banners[0].destination = 'page:promo';
  d.sections = [
    {id: 'sec-a', page: 'index', kind: 'carousel', title: 'Led', visible: true, limit: 12, sort: 'featured', source: {type: 'subcategory', category: 'helmets', subcategory: led.id}, button: {label: 'More', target: 'page:promo'}},
    {id: 'sec-b', page: 'shop', kind: 'grid', title: 'Picked', visible: true, source: {type: 'products', productIds: [p0.id]}},
    {id: 'sec-c', page: 'index', kind: 'brands', title: 'Oil brands', group: 'oil'},
    {id: 'sec-d', page: 'index', kind: 'kits', title: 'Bundles', kitIds: [d.kits[0].id]},
    {id: 'sec-e', page: 'shop', kind: 'carousel', title: 'Bajaj', source: {type: 'brand', brand: 'Bajaj'}},
  ];
  d.layout.index.push('section:sec-a', 'section:sec-c', 'section:sec-d');
  d.layout.shop.push('section:sec-b', 'section:sec-e');
  d.blocks.find(b => b.kind === 'service').target = d.services[0].id;
  return {d, led, p0};
}

test('references() finds every place that points at a record, with the fix for each', () => {
  const {d, led, p0} = wired();
  validateContent(d);
  const pick = (type, id) => references(d, type, id).map(r => [r.type, r.id, r.field, r.fix]);
  const cat = pick('category', 'helmets');
  assert(cat.some(r => r[0] === 'product' && r[1] === p0.id && r[3] === 'block'));
  assert(cat.some(r => r[0] === 'block' && r[3] === 'remove'));
  assert(cat.some(r => r[0] === 'menu' && r[1] === 'menu-t-helmets' && r[3] === 'remove'));
  assert(cat.some(r => r[0] === 'section' && r[1] === 'sec-a' && r[3] === 'remove'));
  assert.deepEqual(pick('subcategory', 'helmets/' + led.id).map(r => r.slice(0, 2).concat(r[3])).sort(), [['block', d.blocks.find(b => b.target === 'helmets').id, 'remove'], ['product', p0.id, 'reassign'], ['section', 'sec-a', 'remove']].sort());
  assert.deepEqual(pick('product', p0.id), [['kit', d.kits[0].id, 'productIds', 'remove'], ['section', 'sec-b', 'source.productIds', 'remove']]);
  const brand = pick('brand', 'bajaj');
  assert(brand.some(r => r[0] === 'product' && r[1] === p0.id && r[3] === 'clear'), 'brand name matches case-insensitively');
  assert(brand.some(r => r[0] === 'section' && r[1] === 'sec-e' && r[3] === 'remove'));
  const group = pick('brandGroup', 'oil');
  assert(group.some(r => r[0] === 'brand' && r[3] === 'block'));
  assert(group.some(r => r[0] === 'section' && r[1] === 'sec-c' && r[3] === 'remove'));
  assert.deepEqual(pick('vehicle', d.vehicles[0].id), [['product', p0.id, 'vehicleIds', 'remove']]);
  const page = pick('page', 'promo');
  assert.deepEqual(page.map(r => [r[0], r[3]]).sort(), [['banner', 'clear'], ['menu', 'remove'], ['section', 'clear']]);
  assert(pick('service', d.services[0].id).every(r => r[0] === 'block' && r[3] === 'remove'));
  assert.deepEqual(pick('kit', d.kits[0].id), [['section', 'sec-d', 'kitIds', 'remove']]);
  assert.deepEqual(pick('section', 'sec-b'), [['layout', 'shop', 'layout.shop', 'remove']]);
  assert.deepEqual(pick('post', 'nothing'), []);
  assert.deepEqual(references(d, 'unknown-type', 'x'), []);
  // Legacy documents are scanned too.
  const old = legacy(); old.products[0].category = 'helmets'; old.products[0].subcategory = 'Led';
  assert.equal(references(old, 'subcategory', 'helmets/sub-led')[0].id, old.products[0].id);
});

test('media references name each location', () => {
  const d = normalise(seed()), id = '123e4567-e89b-12d3-a456-426614174000', ref = 'media:' + id;
  d.products[0].image = ref; d.products[1].gallery = [{ref: 'assets/x.png'}, {ref}];
  helmets(d).children[0].image = ref; d.settings.logo = ref;
  d.content[0].fields.push({id: 'pic', kind: 'image', label: 'Pic', value: ref});
  const hits = mediaUsage(d, id).map(r => [r.type, r.field, r.fix]);
  assert.deepEqual(hits, [
    ['product', 'image', 'clear'], ['product', 'gallery[1].ref', 'remove'],
    ['category', 'children[sub-fog-light].image', 'clear'], ['content', 'fields.pic', 'clear'], ['settings', 'logo', 'clear'],
  ]);
  assert.deepEqual(references(d, 'media', ref), mediaUsage(d, ref));
  assert(mediaUsage(seed(), 'assets/icons/engine-oil.png').length > 1);
});

test('withContentDefaults normalises in place and adds the structural shop entries', () => {
  const d = legacy(), same = withContentDefaults(d);
  assert.equal(same, d);
  assert.equal(typeof helmets(d).children[0], 'object');
  const ids = d.content.map(c => c.id);
  assert(ids.indexOf('shop-partners') === ids.indexOf('shop-section-2') - 1);
  assert.deepEqual(d.content.find(c => c.id === 'shop-kits').fields.map(f => f.id), ['shop-kits-label', 'shop-kits-title', 'shop-kits-intro']);
  assert(!d.content.find(c => c.id === 'shop-section-1').fields.some(f => f.id.startsWith('shop-kits')));
  const again = structuredClone(d);
  withContentDefaults(d);
  assert.deepEqual(d, again, 'idempotent');
  validateContent(d);
});
