import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {load} from 'cheerio';
import {selectProducts, renderSection, kitHtml, markdown, visibleChildren, sectionLimit} from '../cms/sections.mjs';
import {normalise, resolveLayout} from '../cms/content-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const seed = () => JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json', import.meta.url)));
const XSS = '<img src=x onerror=alert(1)>"\'';
const doc = () => ({
  categories: [
    {id: 'oil', name: 'Oil', visible: true, image: 'assets/icons/engine-oil.png', children: [{id: 'sub-synthetic', name: 'Synthetic', visible: true, image: 'media:abc'}, {id: 'sub-old', name: 'Old', visible: false}]},
    {id: 'tyres', name: 'Tyres', visible: true, children: []},
    {id: 'secret', name: 'Hidden', visible: false, children: []},
  ],
  products: [
    {id: 'a', name: 'A oil', brand: 'Motul', category: 'oil', subcategory: 'sub-synthetic', price: 1000, sale: 900, featured: false, visible: true, updatedAt: '2026-11-01T00:00:00.000Z'},
    {id: 'b', name: 'B oil', brand: 'motul ', category: 'oil', subcategory: '', price: 500, sale: 0, featured: true, visible: true, updatedAt: null},
    {id: 'c', name: 'C tyre', brand: 'MRF', category: 'tyres', subcategory: '', price: 3000, sale: 2000, featured: true, visible: true, updatedAt: '2026-11-05T00:00:00.000Z'},
    {id: 'd', name: 'D hidden', brand: 'MRF', category: 'tyres', subcategory: '', price: 10, sale: 5, featured: true, visible: false},
    {id: 'e', name: 'E in hidden category', brand: 'Motul', category: 'secret', subcategory: '', price: 10, sale: 5, featured: true, visible: true},
    {id: 'f', name: 'F tyre', brand: 'CEAT', category: 'tyres', subcategory: '', price: 2000, sale: 1900, featured: false, visible: true, updatedAt: '2026-10-01T00:00:00.000Z'},
  ],
  kits: [{id: 'k1', name: 'Oil kit', description: 'Two oils', productIds: ['a', 'b'], visible: true}, {id: 'k2', name: 'Tyre kit', description: 'Tyre', productIds: ['c'], visible: true}],
  brands: [{id: 'mrf', name: 'MRF', image: 'assets/brands/mrf.webp', group: 'tyres', visible: true}, {id: 'motul', name: 'Motul', image: 'assets/brands/motul.webp', group: 'oil', visible: true}],
  brandGroups: [{id: 'tyres', name: 'Tyres', visible: true}, {id: 'oil', name: 'Engine oil', visible: false}],
});
const ids = (d, section) => selectProducts(d, section).map(p => p.id);
const ctx = d => ({
  content: d, esc,
  card: p => `<article class="card" data-product-id="${esc(p.id)}">${esc(p.name)}</article>`,
  path: t => 'shop.html?cat=' + encodeURIComponent(t),
  imageUrl: ref => ref?.startsWith('media:') ? 'https://cdn.example/' + ref.slice(6) + '.webp' : ref || '',
});

test('selectProducts: every source, hidden products and hidden categories excluded', () => {
  const d = doc();
  assert.deepEqual(ids(d, {source: {type: 'category', category: 'oil'}}), ['a', 'b']);
  assert.deepEqual(ids(d, {source: {type: 'category', category: 'secret'}}), []);
  assert.deepEqual(ids(d, {source: {type: 'subcategory', category: 'oil', subcategory: 'sub-synthetic'}}), ['a']);
  assert.deepEqual(ids(d, {source: {type: 'subcategory', category: 'oil', subcategory: ''}}), []);
  assert.deepEqual(ids(d, {source: {type: 'brand', brand: ' MOTUL'}}), ['a', 'b'], 'brand names match trimmed and case-insensitively');
  assert.deepEqual(ids(d, {source: {type: 'products', productIds: ['f', 'missing', 'd', 'a']}}), ['f', 'a'], 'hand-picked order kept, missing and hidden dropped');
  assert.deepEqual(ids(d, {source: {type: 'sale'}}), ['a', 'c', 'f']);
  assert.deepEqual(ids(d, {source: {type: 'featured'}}), ['b', 'c']);
  assert.deepEqual(ids(d, {source: {type: 'newest'}}), ['c', 'a', 'f', 'b'], 'updatedAt descending, then array order');
  assert.deepEqual(ids(d, {source: {type: 'all'}}), ['a', 'b', 'c', 'f']);
  assert.deepEqual(ids(d, {source: {type: 'nonsense'}}), []);
  const none = doc(); none.products.forEach(p => { p.featured = false; });
  assert.deepEqual(ids(none, {source: {type: 'featured'}}), ['a', 'b', 'c', 'f'], 'featured falls back to every product');
});

test('selectProducts: every sort and the limit', () => {
  const d = doc(), all = sort => ids(d, {source: {type: 'all'}, sort});
  assert.deepEqual(all('manual'), ['a', 'b', 'c', 'f']);
  assert.deepEqual(all(undefined), ['a', 'b', 'c', 'f']);
  assert.deepEqual(all('featured'), ['b', 'c', 'a', 'f']);
  assert.deepEqual(all('low'), ['b', 'a', 'f', 'c'], 'by the price a customer pays');
  assert.deepEqual(all('high'), ['c', 'f', 'a', 'b']);
  assert.deepEqual(all('save'), ['c', 'a', 'f', 'b'], 'largest discount first');
  assert.deepEqual(all('newest'), ['c', 'a', 'f', 'b']);
  assert.deepEqual(ids(d, {source: {type: 'all'}, limit: 2}), ['a', 'b']);
  assert.deepEqual(ids(d, {source: {type: 'featured', limit: 1}}), ['b'], 'a popular source may carry its own limit');
  assert.equal(sectionLimit({}), 12);
  assert.equal(sectionLimit({limit: 0}), 12);
  assert.equal(sectionLimit({limit: 500}), 48);
  const many = doc(); many.products = Array.from({length: 40}, (_, i) => ({...many.products[0], id: 'p' + i}));
  assert.equal(selectProducts(many, {source: {type: 'all'}}).length, 12, 'default limit 12');
});

test('carousel sections emit the structure app.js wires, escape every string and link only through path()', () => {
  const d = doc();
  const html = renderSection({id: 's1', page: 'index', kind: 'carousel', title: XSS, label: XSS, intro: XSS, visible: true, source: {type: 'sale'}, sort: 'save', button: {label: XSS, target: 'javascript:alert(1)'}}, ctx(d));
  const $ = load(html);
  assert.equal($('img[src="x"]').length, 0);
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal($('section[data-cms-generated="s1"]#s1').length, 1);
  assert.equal($('.band > .band__head').length, 1);
  assert.equal($('.band > .carousel[data-carousel] > .carousel__track > .card').length, 3);
  assert.equal($('.carousel__arrow[data-car="-1"]').length, 1);
  assert.equal($('.carousel__arrow[data-car="1"]').length, 1);
  assert.equal($('.carousel__dots[data-car-dots]').length, 1);
  assert.equal($('.band__title').text(), XSS);
  assert.equal($('a.btn').attr('href'), 'shop.html?cat=javascript%3Aalert(1)', 'targets go through path()');
  assert.match($('.band__head .label').last().text(), /3 on offer/);
  assert.equal(renderSection({id: 's2', page: 'shop', kind: 'carousel', title: 'x', visible: true, source: {type: 'brand', brand: 'Nobody'}}, ctx(d)), '', 'an empty product result is omitted');
  assert.equal(renderSection({id: 's3', page: 'index', kind: 'carousel', title: 'x', visible: false, source: {type: 'all'}}, ctx(d)), '', 'hidden sections render nothing');
  assert.equal(renderSection({id: 's4', kind: 'raw-html', title: 'x', visible: true}, ctx(d)), '');
  const grid = load(renderSection({id: 'g', page: 'shop', kind: 'grid', title: 'New', visible: true, source: {type: 'newest'}, limit: 2}, ctx(d)));
  assert.deepEqual(grid('.grid-products .card').map((_, el) => grid(el).attr('data-product-id')).get(), ['c', 'a']);
  assert.ok(grid('section').hasClass('cms-gen--shop'));
});

test('category tiles, bundles, brand strips, promo, FAQ and text sections', () => {
  const d = doc(), c = ctx(d);
  let $ = load(renderSection({id: 't', page: 'index', kind: 'categories', title: 'Types', visible: true, category: 'oil'}, c));
  assert.deepEqual($('.cms-tile').map((_, el) => $(el).attr('href')).get(), ['shop.html?cat=oil&sub=sub-synthetic'], 'visible children only, linked by id');
  assert.equal($('.cms-tile img').attr('src'), 'https://cdn.example/abc.webp');
  $ = load(renderSection({id: 't2', page: 'index', kind: 'categories', title: 'All', visible: true}, c));
  assert.deepEqual($('.cms-tile').map((_, el) => $(el).attr('href')).get(), ['shop.html?cat=oil', 'shop.html?cat=tyres']);
  assert.equal(renderSection({id: 't3', page: 'index', kind: 'categories', title: 'x', visible: true, category: 'secret'}, c), '');

  $ = load(renderSection({id: 'k', page: 'shop', kind: 'kits', title: 'Bundles', visible: true, kitIds: ['k2']}, c));
  assert.deepEqual($('.kit__title').map((_, el) => $(el).text()).get(), ['Tyre kit']);
  assert.equal(JSON.parse($('[data-kit]').attr('data-kit'))[0].id, 'c');
  assert.equal(load(renderSection({id: 'k', page: 'shop', kind: 'kits', title: 'All', visible: true}, c))('.kit').length, 2);
  assert.equal(renderSection({id: 'k', page: 'shop', kind: 'kits', title: 'None', visible: true, kitIds: ['gone']}, c), '');

  $ = load(renderSection({id: 'b', page: 'shop', kind: 'brands', title: 'Tyre brands', visible: true, group: 'tyres'}, c));
  assert.deepEqual($('.partners__row img').map((_, el) => $(el).attr('alt')).get(), ['MRF']);
  assert.equal(renderSection({id: 'b', page: 'shop', kind: 'brands', title: 'Oil', visible: true, group: 'oil'}, c), '', 'a hidden brand group shows nothing');

  $ = load(renderSection({id: 'p', page: 'index', kind: 'promo', title: 'Promo', heading: XSS, text: XSS, image: 'media:pic', visible: true, button: {label: 'Book', target: 'Services'}}, c));
  assert.equal($('img[src="x"]').length, 0);
  assert.equal($('.promo__head').text(), XSS);
  assert.equal($('.cms-promo__image').attr('src'), 'https://cdn.example/pic.webp');
  assert.equal($('.promo a').attr('href'), 'shop.html?cat=Services');

  $ = load(renderSection({id: 'f', page: 'index', kind: 'faq', title: 'Questions', visible: true, items: [{q: XSS, a: 'Line 1\n' + XSS}, {q: '', a: 'skipped'}]}, c));
  assert.equal($('details').length, 1);
  assert.equal($('summary').text(), XSS);
  assert.equal($('img').length, 0, 'answers are plain text');
  assert.equal(renderSection({id: 'f', page: 'index', kind: 'faq', title: 'Questions', visible: true, items: []}, c), '');

  $ = load(renderSection({id: 'x', page: 'index', kind: 'text', title: 'About', visible: true, body: '## Since 2004\n\nWe fit <b>what</b> we sell.\n\n- Oil\n- Tyres'}, c));
  assert.equal($('.cms-gen__text h2').text(), 'Since 2004');
  assert.equal($('.cms-gen__text li').length, 2);
  assert.equal($('.cms-gen__text b').length, 0);
  assert.match($('.cms-gen__text p').text(), /<b>what<\/b>/);
  assert.equal(renderSection({id: 'x', page: 'index', kind: 'text', title: 'About', visible: true, body: '  '}, c), '');
});

test('markdown matches the journal renderer and escapes everything', () => {
  assert.equal(markdown('## Head\n\nLine one\nline two\n\n- a\n- <b>', esc), '<h2>Head</h2><p>Line one<br>line two</p><ul><li>a</li><li>&lt;b&gt;</li></ul>');
});

test('the shared kit markup is the shop kit card, and visibleChildren copes with old string children', () => {
  const d = doc(), $ = load(kitHtml(d.kits[0], d, esc));
  assert.equal($('article.kit > p.label.label--red').text(), '2 items · one visit');
  assert.equal($('.kit__total').text(), 'Bundle total৳1,400');
  assert.equal($('button[data-kit]').text(), 'Add all 2');
  assert.deepEqual(visibleChildren({children: ['Helmets', {id: 'x', name: 'X', visible: false}, {id: 'y', name: 'Y'}]}).map(c => c.id), ['Helmets', 'y']);
});

test('the seed document renders through normalise and its layout', () => {
  const d = normalise(seed());
  for (const page of ['index', 'shop']) assert.ok(resolveLayout(d, page).every(ref => /^(builtin|section):/.test(ref)));
  const html = renderSection({id: 'seed', page: 'index', kind: 'carousel', title: 'Deals', visible: true, source: {type: 'sale'}, sort: 'save'}, ctx(d));
  assert.ok(load(html)('.card').length > 0);
});

test('empty things stay off the site: a bundle with no products, empty category tiles and unanswered questions', () => {
  const c = doc();
  assert.equal(kitHtml({id: 'k0', name: 'Empty', description: '', productIds: []}, c, esc), '');
  const ctx = {content: c, esc, card: p => `<article>${esc(p.name)}</article>`, path: t => t, imageUrl: r => r, markdown};
  const tiles = renderSection({id: 's', page: 'index', kind: 'categories', title: 'Shop', category: 'oil', visible: true}, ctx);
  assert.match(tiles, /Synthetic/);
  c.products = c.products.filter(p => p.subcategory !== 'sub-synthetic');
  assert.equal(renderSection({id: 's', page: 'index', kind: 'categories', title: 'Shop', category: 'oil', visible: true}, ctx), '', 'tiles with 0 products are skipped');
  const faq = renderSection({id: 'f', page: 'index', kind: 'faq', title: 'Q', visible: true, items: [{q: 'Unanswered?', a: ''}, {q: 'Answered?', a: 'Yes.'}]}, ctx);
  assert.doesNotMatch(faq, /Unanswered/);
  assert.match(faq, /Answered\?/);
});
