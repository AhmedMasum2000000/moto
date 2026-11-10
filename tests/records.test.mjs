// control-room/lib/records.mjs: delete with cascade / reassign, duplicate, reorder, image usage.
// Every changed document must still pass the server's validateContent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  COLLECTIONS, deleteRecord, duplicateRecord, getRecord, canDelete, canDuplicate, copyName,
  reorderRecords, moveRecord, reorderLayout, moveLayoutRef, findImageUsage, usageText,
} from '../control-room/lib/records.mjs';
import {normalise, resolveLayout} from '../cms/content-model.mjs';
import {validateContent} from '../supabase/functions/moto-admin/schema.mjs';

const seed = () => JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json', import.meta.url), 'utf8'));
const valid = d => validateContent(structuredClone(d));
const S = n => '00000000-0000-4000-8000-00000000000' + n;
const MEDIA = 'media:11111111-2222-4333-8444-555555555555';

// The seed plus one of everything that can point at something else.
export function fixture() {
  const d = normalise(seed());
  d.pages.push({id: 'promo', name: 'Promo', title: 'Promo page', slug: 'promo', custom: true, html: '<p>Hi</p>', css: '', description: 'Promo', shareImage: 'assets/icons/servicing.png', visible: true});
  d.menu.push({id: 'menu-promo', name: 'Promo', target: 'page:promo', visible: true});
  d.banners[0].destination = 'page:promo';
  d.products[0].sku = 'MOT-7100';
  d.products[0].gallery = [{ref: MEDIA, alt: 'Bottle'}];
  const helmetSub = d.categories.find(c => c.id === 'helmets').children.find(c => c.name === 'Helmets').id;
  const bike = d.vehicles[0].id;
  Object.assign(d.products.find(p => p.id === 'hel-agv-k1'), {fitment: 'Selected vehicles', vehicleIds: [bike]});
  d.sections = [
    {id: S(1), page: 'index', kind: 'carousel', title: 'Helmets', visible: true, limit: 12, sort: 'featured', source: {type: 'subcategory', category: 'helmets', subcategory: helmetSub}},
    {id: S(2), page: 'index', kind: 'grid', title: 'Picks', visible: true, limit: 12, sort: 'manual', source: {type: 'products', productIds: [d.products[0].id, 'hel-agv-k1']}},
    {id: S(3), page: 'shop', kind: 'kits', title: 'Bundles', visible: true, kitIds: [d.kits[0].id]},
    {id: S(4), page: 'index', kind: 'brands', title: 'Oils', visible: true, group: 'oil'},
    {id: S(5), page: 'index', kind: 'promo', title: 'Promo', visible: true, heading: 'Big sale', image: MEDIA, button: {label: 'See', target: 'page:promo'}},
    {id: S(6), page: 'shop', kind: 'carousel', title: 'Motul', visible: true, source: {type: 'brand', brand: 'Motul'}},
    {id: S(7), page: 'shop', kind: 'carousel', title: 'Oil', visible: true, source: {type: 'category', category: 'oil'}, button: {label: 'Shop oil', target: 'oil'}},
  ];
  d.layout.index.splice(1, 0, 'section:' + S(1), 'section:' + S(2), 'section:' + S(4), 'section:' + S(5));
  d.layout.shop.push('section:' + S(3), 'section:' + S(6), 'section:' + S(7));
  if (!d.brands.some(b => b.name === 'Motul')) d.brands.push({id: 'motul', name: 'Motul', image: 'assets/brands/bajaj.webp', group: 'oil', visible: true});
  return d;
}

test('the fixture and the seed are valid', () => { valid(seed()); valid(fixture()); });

test('COLLECTIONS: every type, roles and protected records', () => {
  for (const t of ['product', 'category', 'subcategory', 'brand', 'brandGroup', 'kit', 'vehicle', 'banner', 'block', 'menu', 'page', 'post', 'service', 'section', 'content'])
    assert.ok(COLLECTIONS[t], t);
  for (const t of Object.keys(COLLECTIONS)) {
    assert.equal(typeof COLLECTIONS[t].canDelete, 'function');
    assert.equal(COLLECTIONS[t].canDelete('service'), false, t + ' service role');
  }
  assert.equal(canDelete('product', 'owner'), true);
  assert.equal(canDelete('product', 'editor'), true);
  assert.equal(canDelete('content', 'owner'), false);
  assert.equal(canDelete('page', 'owner', {id: 'index'}), false);
  assert.equal(canDelete('page', 'owner', {id: 'x', custom: true}), true);
  assert.equal(canDuplicate('content', 'owner'), false);
  assert.equal(canDuplicate('product', 'service'), false);
  assert.throws(() => deleteRecord(fixture(), 'content', 'index-fitment'), /cannot-delete/);
  assert.throws(() => deleteRecord(fixture(), 'page', 'index'), /cannot-delete/);
  assert.throws(() => deleteRecord(fixture(), 'product', 'nope'), /not-found/);
  assert.throws(() => deleteRecord(fixture(), 'thing', 'x'), /unknown-type/);
});

test('category delete is blocked without a new home, then moves products and cleans up', () => {
  const d = fixture(), before = JSON.stringify(d);
  const err = (() => { try { deleteRecord(d, 'category', 'oil'); } catch (e) { return e; } })();
  assert.equal(err.message, 'needs-reassign');
  assert.ok(err.refs.length > 0 && err.refs.every(r => r.fix === 'block' && r.type === 'product'));
  assert.throws(() => deleteRecord(d, 'category', 'oil', {reassignTo: 'oil'}), /bad-reassign/);
  assert.throws(() => deleteRecord(d, 'category', 'oil', {reassignTo: 'nope'}), /bad-reassign/);
  assert.throws(() => deleteRecord(d, 'category', 'oil', {reassignTo: ''}), /needs-reassign/);
  const oilProducts = d.products.filter(p => p.category === 'oil').map(p => p.id);
  const {next, summary} = deleteRecord(d, 'category', 'oil', {reassignTo: 'parts'});
  assert.equal(JSON.stringify(d), before, 'input untouched');
  assert.ok(!next.categories.some(c => c.id === 'oil'));
  for (const id of oilProducts) assert.equal(next.products.find(p => p.id === id).category, 'parts');
  assert.ok(!next.menu.some(m => m.target === 'oil'), 'menu link removed');
  assert.ok(!next.blocks.some(b => b.kind === 'category' && b.target === 'oil'), 'card removed');
  assert.ok(!next.sections.some(s => s.id === S(7)), 'oil carousel removed');
  assert.ok(!next.layout.shop.includes('section:' + S(7)), 'layout ref removed');
  assert.ok(!next.brandGroups.some(g => g.shopTarget === 'oil'), 'shop button cleared');
  assert.equal(summary.label, 'Deleted category ' + d.categories.find(c => c.id === 'oil').name);
  assert.equal(summary.moved, oilProducts.length);
  assert.ok(summary.items.some(i => i.type === 'menu' && i.result === 'removed'));
  valid(next);
});

test('category delete keeps a matching subcategory and hides banners pointing at it', () => {
  const d = fixture();
  d.categories.push({id: 'gear', name: 'Gear', children: [{id: 'sub-gloves', name: 'Hand gloves', visible: true}], visible: true, image: 'assets/icons/servicing.png', description: ''});
  const {next} = deleteRecord(d, 'category', 'helmets', {reassignTo: 'gear'});
  assert.equal(next.products.find(p => p.id === 'hel-gloves').subcategory, 'sub-gloves');
  assert.equal(next.products.find(p => p.id === 'hel-agv-k1').subcategory, '');
  assert.ok(!next.sections.some(s => s.id === S(1)));
  valid(next);
  const after = deleteRecord(fixture(), 'category', 'after', {reassignTo: 'parts'}).next;
  const hidden = after.banners.filter(b => b.visible === false && b.destination === 'Home');
  assert.ok(hidden.length >= 1, 'banners pointing at the category are hidden');
  valid(after);
});

test('subcategory delete: clear by default, or move to a sibling', () => {
  const d = fixture(), cat = d.categories.find(c => c.id === 'helmets');
  const helmets = cat.children.find(c => c.name === 'Helmets').id, gloves = cat.children.find(c => c.name === 'Hand Gloves').id;
  const n = d.products.filter(p => p.subcategory === helmets).length;
  const a = deleteRecord(d, 'subcategory', 'helmets/' + helmets);
  assert.ok(!a.next.categories.find(c => c.id === 'helmets').children.some(c => c.id === helmets));
  assert.equal(a.next.products.filter(p => p.category === 'helmets' && p.subcategory === helmets).length, 0);
  assert.ok(!a.next.blocks.some(b => (b.subcategories || []).includes(helmets)));
  assert.ok(!a.next.sections.some(s => s.id === S(1)));
  assert.equal(a.summary.moved, n);
  valid(a.next);
  const b = deleteRecord(d, 'subcategory', 'helmets/' + helmets, {reassignTo: gloves});
  assert.equal(b.next.products.filter(p => p.subcategory === gloves).length, n + d.products.filter(p => p.subcategory === gloves).length);
  valid(b.next);
  assert.throws(() => deleteRecord(d, 'subcategory', 'helmets/' + helmets, {reassignTo: helmets}), /bad-reassign/);
});

test('product delete removes it from bundles and hand-picked sections', () => {
  const d = fixture(), id = d.products[0].id;
  assert.ok(d.kits.some(k => k.productIds.includes(id)));
  const {next, summary} = deleteRecord(d, 'product', id);
  assert.ok(!next.products.some(p => p.id === id));
  assert.ok(!next.kits.some(k => k.productIds.includes(id)));
  assert.deepEqual(next.sections.find(s => s.id === S(2)).source.productIds, ['hel-agv-k1']);
  assert.ok(summary.removed >= 2);
  valid(next);
});

test('brand delete clears or reassigns product brands and drops brand sections', () => {
  const d = fixture(), motul = d.brands.find(b => b.name === 'Motul');
  const uses = d.products.filter(p => p.brand?.toLowerCase() === 'motul').map(p => p.id);
  assert.ok(uses.length);
  const a = deleteRecord(d, 'brand', motul.id);
  for (const id of uses) assert.equal(a.next.products.find(p => p.id === id).brand, '');
  assert.ok(!a.next.sections.some(s => s.id === S(6)));
  valid(a.next);
  const other = d.brands.find(b => b.id !== motul.id);
  const b = deleteRecord(d, 'brand', motul.id, {reassignTo: other.id});
  for (const id of uses) assert.equal(b.next.products.find(p => p.id === id).brand, other.name);
  valid(b.next);
});

test('brand group delete needs a new group for its brands', () => {
  const d = fixture();
  assert.throws(() => deleteRecord(d, 'brandGroup', 'oil'), /needs-reassign/);
  const {next} = deleteRecord(d, 'brandGroup', 'oil', {reassignTo: 'tyres'});
  assert.ok(!next.brands.some(b => b.group === 'oil'));
  assert.ok(!next.sections.some(s => s.id === S(4)));
  valid(next);
  const cleared = deleteRecord(d, 'brandGroup', 'oil', {reassignTo: ''}).next;
  assert.ok(cleared.brands.some(b => !b.group));
  valid(cleared);
});

test('vehicle, page, post, service, kit, section, banner, block and menu deletes stay valid', () => {
  const d = fixture();
  const bike = d.vehicles[0].id;
  const v = deleteRecord(d, 'vehicle', bike).next;
  const helmet = v.products.find(p => p.id === 'hel-agv-k1');
  assert.ok(!helmet.vehicleIds.includes(bike));
  assert.equal(helmet.fitment, 'Ask us to confirm');
  valid(v);

  const page = deleteRecord(d, 'page', 'promo').next;
  assert.ok(!page.menu.some(m => m.target === 'page:promo'));
  assert.equal(page.banners[0].destination, 'Home');
  assert.equal(page.banners[0].visible, false);
  assert.equal(page.sections.find(s => s.id === S(5)).button, undefined);
  valid(page);

  const post = deleteRecord(d, 'post', d.posts[0].id).next;
  assert.equal(post.posts.length, d.posts.length - 1);
  valid(post);

  const service = deleteRecord(d, 'service', 'servicing').next;
  assert.ok(!service.blocks.some(b => b.kind === 'service' && b.target === 'servicing'));
  valid(service);

  const kit = deleteRecord(d, 'kit', d.kits[0].id).next;
  assert.deepEqual(kit.sections.find(s => s.id === S(3)).kitIds, []);
  valid(kit);

  const section = deleteRecord(d, 'section', S(1)).next;
  assert.ok(!section.sections.some(s => s.id === S(1)));
  assert.ok(!section.layout.index.includes('section:' + S(1)));
  valid(section);

  for (const [type, key] of [['banner', 'banners'], ['block', 'blocks'], ['menu', 'menu']]) {
    const next = deleteRecord(d, type, d[key][0].id).next;
    assert.equal(next[key].length, d[key].length - 1, type);
    valid(next);
  }
});

test('delete works on an old (v1) document without migrating it first', () => {
  const old = seed();
  delete old.sections; delete old.layout; delete old.brandGroups;
  const {next} = deleteRecord(old, 'product', old.products[0].id);
  assert.ok(Array.isArray(next.sections) && next.layout && next.brandGroups);
  assert.equal(typeof old.categories.find(c => c.id === 'helmets').children[0], 'string', 'input untouched');
  valid(next);
});

test('duplicate: new unique id, "(copy)", hidden, right after the original', () => {
  const d = fixture();
  for (const [type, key] of [['product', 'products'], ['brand', 'brands'], ['kit', 'kits'], ['vehicle', 'vehicles'], ['banner', 'banners'], ['block', 'blocks'], ['menu', 'menu'], ['service', 'services'], ['brandGroup', 'brandGroups'], ['post', 'posts']]) {
    const original = d[key][0];
    const {next, copy} = duplicateRecord(d, type, original.id);
    assert.notEqual(copy.id, original.id, type);
    assert.match(copy.id, /^[0-9a-f-]{36}$/, type);
    assert.equal(new Set(next[key].map(x => x.id)).size, next[key].length, type + ' ids unique');
    assert.equal(copy.visible, false, type);
    assert.match(copy.name, /\(copy\)$/, type);
    assert.equal(next[key][1], copy, type + ' inserted after the original');
    valid(next);
  }
  const twice = duplicateRecord(duplicateRecord(d, 'product', d.products[0].id).next, 'product', d.products[0].id).copy;
  assert.match(twice.name, /\(copy 2\)$/);
});

test('duplicate product drops the SKU; duplicate category gets new children and no products', () => {
  const d = fixture();
  const p = duplicateRecord(d, 'product', d.products[0].id);
  assert.equal(p.copy.sku, undefined);
  assert.match(p.copy.updatedAt, /Z$/);
  valid(p.next);
  const c = duplicateRecord(d, 'category', 'helmets');
  const original = d.categories.find(x => x.id === 'helmets');
  assert.equal(c.copy.children.length, original.children.length);
  assert.ok(c.copy.children.every((ch, i) => ch.name === original.children[i].name && /^sub-/.test(ch.id)));
  assert.equal(c.next.products.length, d.products.length);
  assert.equal(c.next.products.filter(x => x.category === c.copy.id).length, 0);
  valid(c.next);
});

test('duplicate subcategory, section and custom page', () => {
  const d = fixture();
  const sub = d.categories.find(c => c.id === 'helmets').children[0];
  const s = duplicateRecord(d, 'subcategory', 'helmets/' + sub.id);
  const kids = s.next.categories.find(c => c.id === 'helmets').children;
  assert.equal(kids[1], s.copy);
  assert.equal(s.copy.name, sub.name + ' (copy)');
  assert.equal(new Set(kids.map(k => k.id)).size, kids.length);
  valid(s.next);

  const sec = duplicateRecord(d, 'section', S(2));
  assert.equal(sec.copy.title, 'Picks (copy)');
  const at = sec.next.layout.index.indexOf('section:' + S(2));
  assert.equal(sec.next.layout.index[at + 1], 'section:' + sec.copy.id);
  valid(sec.next);

  const page = duplicateRecord(d, 'page', 'promo');
  assert.equal(page.copy.slug, 'promo-copy');
  valid(page.next);
  assert.throws(() => duplicateRecord(d, 'page', 'index'), /cannot-duplicate/);
  assert.throws(() => duplicateRecord(d, 'content', 'index-fitment'), /cannot-duplicate/);
});

test('copyName fits the limit', () => {
  assert.equal(copyName('A', []), 'A (copy)');
  assert.equal(copyName('A', ['a (copy)']), 'A (copy 2)');
  assert.equal(copyName('x'.repeat(200), [], 60).length, 60);
});

test('reorder a subset, move up/down/top/bottom, subcategories and layout', () => {
  const d = fixture();
  const ids = d.products.map(p => p.id);
  const helmets = d.products.filter(p => p.category === 'helmets').map(p => p.id);
  const {next, changed} = reorderRecords(d, 'product', helmets.slice().reverse());
  assert.equal(changed, true);
  // Products of other categories keep their slots.
  next.products.forEach((p, i) => { if (p.category !== 'helmets') assert.equal(p.id, ids[i]); });
  assert.deepEqual(next.products.filter(p => p.category === 'helmets').map(p => p.id), helmets.slice().reverse());
  valid(next);

  assert.equal(moveRecord(d, 'product', ids[1], 'top').next.products[0].id, ids[1]);
  assert.equal(moveRecord(d, 'product', ids[0], 'bottom').next.products.at(-1).id, ids[0]);
  assert.equal(moveRecord(d, 'product', ids[0], 'down').next.products[1].id, ids[0]);
  assert.equal(moveRecord(d, 'product', ids[0], 'up').changed, false);

  const kids = d.categories.find(c => c.id === 'helmets').children.map(c => c.id);
  const sub = moveRecord(d, 'subcategory', 'helmets/' + kids[2], 'top').next;
  assert.equal(sub.categories.find(c => c.id === 'helmets').children[0].id, kids[2]);
  valid(sub);

  const refs = resolveLayout(d, 'index');
  const lay = reorderLayout(d, 'index', refs.slice().reverse());
  assert.deepEqual(lay.next.layout.index, refs.slice().reverse());
  valid(lay.next);
  const top = moveLayoutRef(d, 'index', 'section:' + S(5), 'top').next;
  assert.equal(top.layout.index[0], 'section:' + S(5));
  valid(top);
});

test('findImageUsage lists every place a picture is used', () => {
  const d = fixture();
  const uses = findImageUsage(d, MEDIA);
  assert.ok(uses.some(u => u.type === 'product' && /^gallery/.test(u.field)));
  assert.ok(uses.some(u => u.type === 'section' && u.field === 'image'));
  assert.ok(findImageUsage(d, MEDIA.slice(6)).length === uses.length, 'bare uuid');
  assert.ok(findImageUsage(d, 'assets/icons/engine-oil.png').length > 0);
  assert.deepEqual(findImageUsage(d, 'assets/none.png'), []);
  assert.match(usageText(uses), /\w/);
  assert.equal(usageText([1, 2, 3, 4, 5, 6, 7].map(i => ({name: 'N' + i})), 5), 'N1, N2, N3, N4, N5, +2 more');
});

test('getRecord finds subcategories by catId/subId', () => {
  const d = fixture(), sub = d.categories.find(c => c.id === 'helmets').children[0];
  assert.equal(getRecord(d, 'subcategory', 'helmets/' + sub.id), sub);
  assert.equal(getRecord(d, 'subcategory', 'helmets/none'), null);
});

test('deleting the last product of a bundle hides the bundle, and publicDocument never shows an empty bundle', async () => {
  const {publicDocument} = await import('../supabase/functions/moto-admin/schema.mjs');
  let d = normalise(seed());
  const kit = d.kits[0];
  let last;
  for (const id of kit.productIds) last = deleteRecord(d, 'product', id), d = last.next;
  const after = d.kits.find(k => k.id === kit.id);
  assert.equal(after.productIds.length, 0);
  assert.equal(after.visible, false);
  assert.ok(last.summary.items.some(i => i.type === 'kit' && /hidden/.test(i.result)));
  valid(d);
  const shown = structuredClone(d); shown.kits.find(k => k.id === kit.id).visible = true;
  assert.ok(!publicDocument(shown).kits.some(k => k.id === kit.id), 'an empty bundle is not published');
});
