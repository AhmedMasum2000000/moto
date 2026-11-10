// Control room → Store settings panels (Delivery & orders, Invoice & payments, Booking time slots).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateContent} from '../supabase/functions/moto-admin/schema.mjs';
import {withContentDefaults, defaultSections} from '../cms/content-defaults.mjs';

const app = fs.readFileSync(new URL('../control-room/app.js', import.meta.url), 'utf8');
const seed = () => JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json', import.meta.url), 'utf8'));

test('control room merges default text fields on load', () => {
  assert.match(app, /import \{withContentDefaults\} from '\.\.\/cms\/content-defaults\.mjs'/);
  assert.match(app, /data=r\.draft\?\.content;if\(data\)\{data\.posts\|\|=\[\];withContentDefaults\(data\);\}/);
});

test('new settings forms are wired to the submit handler', () => {
  for (const id of ['orders-settings-form', 'invoice-settings-form', 'booking-slots-form']) {
    assert.ok(app.includes(`id="${id}"`), id + ' is rendered');
    assert.ok(app.includes(`'${id}'`), id + ' is handled on submit');
  }
  for (const name of ['orderEmail', 'requestReceived', 'whatsappGreeting', 'parentCompany', 'invoiceNote', 'paymentMethods', 'bookingSlots'])
    assert.ok(app.includes(`'${name}'`), name + ' has a form field');
});

test('a draft as the control room saves it passes validateContent', () => {
  const doc = withContentDefaults(seed());
  for (const s of defaultSections) for (const f of s.fields)
    assert.ok(doc.content.some(x => x.fields.some(y => y.id === f.id)), f.id + ' present after merge');
  Object.assign(doc.settings, {
    delivery: [{id: 'inside', label: 'Inside Kushtia', fee: 100, visible: true}, {id: 'outside', label: 'Outside Kushtia', fee: 150, visible: false}, {id: 'dhaka-city', label: 'Dhaka City', fee: 200, visible: true}],
    orderEmail: 'orders@example.com', whatsappGreeting: 'Salam', parentCompany: '', paymentMethods: 'Cash · bKash',
    bookingSlots: ['Morning · 9:00 – 12:00', 'Late · 8:00 – 10:00'],
  });
  delete doc.settings.invoiceNote; delete doc.settings.requestReceived;
  assert.doesNotThrow(() => validateContent(doc));
});

// ── Flagship wiring (Wave 2) ──────────────────────────────────────────────────────────────────────
import {sectionDefaults} from '../control-room/ui/layout.mjs';
import {normalise, resolveLayout} from '../cms/content-model.mjs';
// Pulls one single-line function out of app.js and evaluates it on its own (it must not use app state).
const appFunction = name => {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name + ' exists in app.js');
  return new Function(`return (${app.slice(start, app.indexOf('\n', start))})`)();
};

test("defaults('section') is a valid section for the page shown in Website → Layout", () => {
  assert.match(app, /if\(type==='section'\)return sectionDefaults\(data,\{page:layoutPage\(\)\}\)/);
  const doc = normalise(withContentDefaults(seed()));
  for (const page of ['index', 'shop']) {
    const s = sectionDefaults(doc, {page});
    assert.equal(s.page, page);
    assert.equal(s.kind, 'carousel');
    assert.equal(s.visible, true);
    assert.equal(s.limit, 12);
    assert.equal(s.sort, 'featured');
    assert.deepEqual(s.source, {type: 'category', category: doc.categories[0].id});
    assert.match(s.id, /^[a-zA-Z0-9_-]{1,100}$/);
    const next = structuredClone(doc);
    next.sections.push(s);
    next.layout[page] = [...resolveLayout(next, page).filter(r => r !== 'section:' + s.id), 'section:' + s.id];
    assert.doesNotThrow(() => validateContent(next));
  }
  assert.match(app, /if\(type==='brandGroup'\)return \{id:'group-'/);
});

test('a new category with "Also add to website" ticked saves a valid document', () => {
  const addWebsiteLinks = appFunction('addWebsiteLinks');
  let n = 0;
  const makeId = () => 'id' + (++n);
  const next = normalise(withContentDefaults(seed()));
  const cat = {id: 'brake-parts', name: 'Brake Parts', visible: true, image: 'assets/icons/servicing.png', description: '', children: [{id: 'sub-brake-pads', name: 'Brake pads', visible: true}]};
  next.categories.push(cat);
  assert.deepEqual(addWebsiteLinks(next, cat, {menu: true, card: true, section: true}, makeId), ['menu link', 'homepage card', 'shop carousel']);
  assert.ok(next.menu.some(m => m.target === 'brake-parts'));
  assert.ok(next.blocks.some(b => b.kind === 'category' && b.target === 'brake-parts'));
  const shop = next.layout.shop;
  assert.equal(shop[shop.indexOf('builtin:shop-kits') - 1], 'section:id3', 'the carousel goes just before the bundles');
  assert.doesNotThrow(() => validateContent(next));
  assert.deepEqual(addWebsiteLinks(next, cat, {menu: true, card: true, section: true}, makeId), [], 'nothing is added twice');
});

test('drafts with plain-name subcategories keep the A-Z order the website shows today', () => {
  const sortLegacyChildren = appFunction('sortLegacyChildren');
  const doc = {categories: [{id: 'a', children: ['Visors', 'arm guards', 'Boots']}, {id: 'b', children: [{id: 'z', name: 'Z'}, {id: 'a', name: 'A'}]}]};
  sortLegacyChildren(doc);
  assert.deepEqual(doc.categories[0].children, ['arm guards', 'Boots', 'Visors']);
  assert.deepEqual(doc.categories[1].children.map(c => c.id), ['z', 'a'], 'records keep the order staff set');
  assert.match(app, /sortLegacyChildren\(r\.draft\?\.content\);data=r\.draft\?\.content;/);
});

test('the control room wires the flagship modules, undo and the tour', () => {
  const html = fs.readFileSync(new URL('../control-room/index.html', import.meta.url), 'utf8');
  for (const css of ['css/catalog.css', 'css/structure.css', 'css/tour.css']) assert.ok(html.includes(`href="${css}?v=`), css + ' is linked');
  assert.match(html, /src="app\.js\?v=fb-1110"/);
  for (const m of ['./tour/tour.mjs', './ui/layout.mjs', './ui/product-list.mjs', './ui/confirm.mjs', './ui/photos.mjs', './ui/io.mjs', './lib/undo.mjs'])
    assert.ok(app.includes(`from '${m}'`), m + ' is imported');
  assert.match(app, /undo\.push\(label,before\)/, 'save() keeps the previous draft for Undo');
  assert.match(app, /if\(error\?\.code==='CONFLICT'\)\{undo\.clear\(\)/, 'a conflict clears the undo stack');
  assert.match(app, /checkDocument\(next\);await save\(next,key,label\)/, 'the editor validates before saving');
  assert.match(app, /export const ctx=\{/);
});
