import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sections} from '../cms/text-defaults-js.mjs';
import {cmsText,defaultText,withContentDefaults} from '../cms/content-defaults.mjs';
import {orderMessage,rideMessage,greetingLine} from '../cms/whatsapp.mjs';
import {validateContent} from '../supabase/functions/moto-admin/schema.mjs';

const seed = () => JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json', import.meta.url)));
const source = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

// The message app.js built before the settings became editable, copied verbatim.
function legacyMessage(items, total) {
  const lines = items.map(i => `• ${i.name}${i.colorName?' ('+i.colorName+')':''} ×${i.qty} — ৳${i.price * i.qty}`).join('\n');
  return items.length
    ? `Assalamu alaikum, Moto Market. I'd like to order:\n${lines}\n\nProducts total: ৳${total} + delivery charge (৳120 inside Kushtia / ৳150 outside Kushtia)`
    : `Assalamu alaikum, Moto Market. I'd like to ask about a part.`;
}

test('WhatsApp order message is byte-identical to the old text with default settings', () => {
  const items = [{name: 'Motul 7100 4T · 10W-40', qty: 2, price: 1350}, {name: 'SMK Twister', colorName: 'Matte black', qty: 1, price: 7900}];
  for (const settings of [seed().settings, {name: 'Moto Market'}, undefined]) {
    assert.equal(orderMessage(items, 10600, settings), legacyMessage(items, 10600));
    assert.equal(orderMessage([], 0, settings), legacyMessage([], 0));
  }
  assert.equal(rideMessage('Yamaha R15', seed().settings), 'Assalamu alaikum, Moto Market. I ride a Yamaha R15. Can you check parts for it?');
});

test('WhatsApp messages follow the store name, greeting and visible delivery areas', () => {
  const settings = {name: 'Bike Bay', whatsappGreeting: 'Hello', delivery: [
    {id: 'city', label: 'City centre', fee: 80}, {id: 'far', label: 'Far away', fee: 500, visible: false}, {id: 'dhaka', label: 'Dhaka', fee: 200}]};
  assert.equal(greetingLine(settings), 'Hello, Bike Bay.');
  const text = orderMessage([{name: 'Chain', qty: 1, price: 900}], 900, settings);
  assert.equal(text, "Hello, Bike Bay. I'd like to order:\n• Chain ×1 — ৳900\n\nProducts total: ৳900 + delivery charge (৳80 city centre / ৳200 Dhaka)");
  assert.equal(orderMessage([], 0, settings), "Hello, Bike Bay. I'd like to ask about a part.");
});

test('script text defaults have unique ids that never collide with stored fields', () => {
  // A seed that already carries these defaults (same id, same text) is fine; any other reuse is a clash.
  const existing = new Map(seed().content.flatMap(s => s.fields.map(f => [f.id, f.value])));
  const ids = sections.flatMap(s => s.fields.map(f => f.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const s of sections) for (const f of s.fields) assert(!existing.has(f.id) || existing.get(f.id) === f.value, f.id + ' already exists in the seed');
  for (const s of sections) {
    assert(['index', 'shop', 'book'].includes(s.page));
    for (const f of s.fields) { assert.equal(f.kind, 'text'); assert(f.value.trim() && f.label.trim()); }
  }
});

test('a document with the defaults merged in still validates and reads back the defaults', () => {
  const d = withContentDefaults(seed());
  validateContent(structuredClone(d));
  for (const s of sections) for (const f of s.fields) {
    assert.equal(cmsText(d, f.id), f.value);
    assert.equal(cmsText(seed(), f.id), f.value, 'old documents fall back to ' + f.id);
  }
  d.content.find(s => s.id === 'cart-order-form').fields.find(f => f.id === 'order-title').value = 'Order now';
  assert.equal(cmsText(d, 'order-title'), 'Order now');
});

test('default texts equal the wording the scripts used before', () => {
  const expected = {
    'menu-cta': 'Book a service →', 'cart-whatsapp': 'Or ask on WhatsApp ↗', 'order-submit': 'Send request →',
    'booking-note': 'Sending a request does not reserve a slot. Our team will call to confirm.',
    'fit-universal': 'Universal fit — confirm with our team', 'fit-unknown': 'Ask us to confirm fitment', 'datasheet-button': 'Download PDS',
    'journal-label': 'THE MOTO JOURNAL', 'journal-heading': 'From the workshop.', 'finder-intro': 'Type a model. Choose your ride. Find the right products.',
  };
  for (const [id, value] of Object.entries(expected)) assert.equal(defaultText(id), value);
  // app.js keeps the same wording as its fallback when content cannot load.
  const app = source('app.js');
  for (const id of ['cart-empty-text', 'search-empty', 'search-empty-call']) assert(app.includes(`'${defaultText(id)}'`), id);
});

test('every text id the storefront scripts read has a default', () => {
  const ids = new Set(sections.flatMap(s => s.fields.map(f => f.id)));
  const used = new Set();
  for (const file of ['cms/public.js', 'cms/finder.js', 'app.js']) {
    for (const m of source(file).matchAll(/\b(?:th?|T|MM_TEXT)\('([a-z0-9-]+)'/g)) used.add(m[1]);
    for (const m of source(file).matchAll(/\bth?\([^)]*\?'([a-z0-9-]+)':'([a-z0-9-]+)'/g)) { used.add(m[1]); used.add(m[2]); }
  }
  assert(used.size > 30);
  for (const id of used) assert(ids.has(id), id + ' has no default');
});
