// Cross-part checks: the control room, the server and the storefront agree on store settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateContent, publicDocument, validateRequest} from '../supabase/functions/moto-admin/schema.mjs';
import {STORE_DEFAULTS} from '../supabase/functions/_shared/store-defaults.mjs';
import {deliveryAreas, deliveryOption} from '../supabase/functions/_shared/delivery.mjs';
import {withContentDefaults} from '../cms/content-defaults.mjs';
import {cartInventory} from '../cms/catalog.mjs';

const root = new URL('../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const seed = () => JSON.parse(read('cms/initial-content.json'));

// The storefront bill (cms/public.js): products + the chosen area's fee, both from the published document.
function storefrontBill(live, cart, areaId) {
  const lines = cartInventory(live.products, cart);
  const subtotal = lines.reduce((sum, i) => sum + i.price * i.qty, 0);
  const area = deliveryOption(areaId, live.settings);
  return {lines, expectedTotalMinor: lines.reduce((sum, i) => sum + i.price * i.qty * 100, 0), expectedDeliveryMinor: area ? area.fee * 100 : undefined, shownTotalMinor: area ? (subtotal + area.fee) * 100 : null};
}

function checkBills(draft) {
  const live = publicDocument(validateContent(draft));
  const product = live.products.find(p => p.id === 'oil-motul-7100');
  const cart = [{id: product.id, qty: 2}];
  const areas = deliveryAreas(live.settings);
  assert(areas.length > 0);
  for (const area of areas) {
    const bill = storefrontBill(live, cart, area.id);
    const r = validateRequest({key: crypto.randomUUID(), kind: 'order', name: 'Bill test', phone: '01700000000', address: 'R.A. Khan Chowdhury Road, Kushtia', delivery: area.id, items: bill.lines.map(i => ({id: i.id, qty: i.qty, colorId: i.colorId || ''})), expectedTotalMinor: bill.expectedTotalMinor, expectedDeliveryMinor: bill.expectedDeliveryMinor}, live);
    assert.equal(r.details.totalMinor, bill.shownTotalMinor, `bill for ${area.id}`);
    assert.equal(r.details.delivery, area.label);
  }
  return live;
}

test('cart bill equals the server total for the default delivery areas', () => {
  const live = checkBills(seed());
  assert.deepEqual(deliveryAreas(live.settings).map(a => [a.id, a.fee]), [['inside', 120], ['outside', 150]]);
  const legacy = seed();
  for (const k of Object.keys(STORE_DEFAULTS)) delete legacy.settings[k];
  checkBills(legacy);
});

test('cart bill equals the server total for control-room delivery areas; hidden areas and orderEmail stay private', () => {
  const d = seed();
  // The shape control-room/app.js readOrderSettings() writes.
  Object.assign(d.settings, {delivery: [{id: 'inside', label: 'Inside Kushtia', fee: 100, visible: true}, {id: 'outside', label: 'Outside Kushtia', fee: 150, visible: false}, {id: 'dhaka-city', label: 'Dhaka City', fee: 0, visible: true}], orderEmail: 'orders@example.com', requestReceived: 'Thanks!', whatsappGreeting: 'Hello', parentCompany: '', bookingSlots: ['Morning']});
  const live = checkBills(d);
  assert.deepEqual(deliveryAreas(live.settings).map(a => a.id), ['inside', 'dhaka-city']);
  assert(!JSON.stringify(live).includes('orders@example.com'));
  assert.equal(live.settings.orderEmail, undefined);
  const product = live.products.find(p => p.id === 'oil-motul-7100');
  assert.throws(() => validateRequest({key: crypto.randomUUID(), kind: 'order', name: 'x y', phone: '01700000000', address: 'Somewhere 12', delivery: 'outside', items: [{id: product.id, qty: 1}], expectedTotalMinor: (product.sale || product.price) * 100}, live), /delivery area/);
});

test('every store setting the control room writes is one the server and storefront know', () => {
  const all = read('control-room/app.js'), start = all.indexOf('function readOrderSettings');
  assert(start > 0);
  const src = all.slice(start, all.indexOf('\n', all.indexOf('function readBookingSlots')));
  const written = new Set();
  for (const m of src.matchAll(/\bs\.([a-zA-Z]+)=/g)) written.add(m[1]);
  for (const m of src.matchAll(/settings\.([a-zA-Z]+)=/g)) written.add(m[1]);
  for (const m of src.matchAll(/\['(requestReceived|whatsappGreeting|invoiceNote|paymentMethods)'/g)) written.add(m[1]);
  const known = new Set([...Object.keys(STORE_DEFAULTS), ...Object.keys(seed().settings)]);
  assert(written.has('delivery') && written.has('orderEmail') && written.has('bookingSlots') && written.has('parentCompany'));
  for (const k of written) assert(known.has(k), k + ' is not a known store setting');
});

test('the seed with every default text merged in still validates and publishes', () => {
  const d = withContentDefaults(seed());
  validateContent(d);
  const ids = d.content.flatMap(s => s.fields.map(f => f.id));
  assert.equal(new Set(ids).size, ids.length);
  publicDocument(d);
});

test('every page loads the same cache-busted storefront script', () => {
  const versions = new Set();
  for (const f of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
    for (const m of read(f).matchAll(/cms\/(public|finder)\.js(\?v=[\w-]+)?"/g)) versions.add(m[1] + (m[2] || ''));
  }
  const pub = [...versions].filter(v => v.startsWith('public'));
  assert.equal(pub.length, 1, 'pages disagree on the public.js version: ' + pub.join(', '));
  assert.notEqual(pub[0], 'public?v=mob-1104', 'bump the public.js version so returning visitors get the editable texts');
  const imported = read('cms/public.js').match(/from '\.\/finder\.js(\?v=[\w-]+)'/)[1];
  for (const v of versions) if (v.startsWith('finder')) assert.equal(v, 'finder' + imported, 'finder.js preload must match the version public.js imports');
});
