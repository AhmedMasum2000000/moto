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
