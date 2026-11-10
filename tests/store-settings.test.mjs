import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STORE_DEFAULTS,storeSettings} from '../supabase/functions/_shared/store-defaults.mjs';
import {deliveryAreas,deliveryOption,defaultDeliveryAreas,deliveryOptions} from '../supabase/functions/_shared/delivery.mjs';
const seed=()=>JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json',import.meta.url)));
test('missing settings fall back to today’s wording and fees',()=>{
  const s=storeSettings({name:'Moto Market'});
  assert.equal(s.name,'Moto Market');assert.equal(s.parentCompany,'Motolube Bangladesh');assert.equal(s.paymentMethods,'Cash · bKash · Nagad');
  assert.equal(s.requestReceived,'Request received. The team will contact you to confirm availability and price.');
  assert.equal(s.invoiceNote,'Our team will call to confirm stock and price before delivery.');assert.equal(s.whatsappGreeting,'Assalamu alaikum');assert.equal(s.orderEmail,'');
  assert.deepEqual(s.bookingSlots,['Morning · 9:00 – 12:00','Afternoon · 12:00 – 4:00','Evening · 4:00 – 8:00']);
  assert.deepEqual(s.delivery.map(a=>[a.id,a.fee]),[['inside',120],['outside',150]]);
  for(const empty of [undefined,null,{}])assert.equal(storeSettings(empty).paymentMethods,STORE_DEFAULTS.paymentMethods);
});
test('an explicit empty sister-concern line hides it; blank texts use the default',()=>{
  assert.equal(storeSettings({parentCompany:''}).parentCompany,'');
  assert.equal(storeSettings({invoiceNote:'  '}).invoiceNote,STORE_DEFAULTS.invoiceNote);
  assert.deepEqual(storeSettings({bookingSlots:[]}).bookingSlots,[]);
});
test('the seed’s stored settings equal the code defaults, so a fresh setup looks the same',()=>{
  const s=seed().settings;
  for(const k of ['parentCompany','invoiceNote','paymentMethods','requestReceived','whatsappGreeting','orderEmail'])assert.equal(s[k],STORE_DEFAULTS[k],k);
  assert.deepEqual(s.bookingSlots,[...STORE_DEFAULTS.bookingSlots]);
  assert.deepEqual(s.delivery.map(({id,label,fee})=>({id,label,fee})),STORE_DEFAULTS.delivery.map(a=>({...a})));
});
test('delivery areas list visible areas in order and look up by id',()=>{
  assert.equal(deliveryOptions,defaultDeliveryAreas);
  assert.deepEqual(deliveryAreas({}).map(a=>a.id),['inside','outside']);
  const settings={delivery:[{id:'b',label:'B',fee:10,visible:false},{id:'a',label:'A',fee:20}]};
  assert.deepEqual(deliveryAreas(settings).map(a=>a.id),['a']);
  assert.equal(deliveryOption('a',settings).fee,20);assert.equal(deliveryOption('b',settings),null);assert.equal(deliveryOption('inside',settings),null);
  assert.equal(deliveryOption('inside').fee,120);
  assert.deepEqual(deliveryAreas({delivery:[{id:'x',label:'X',fee:1,visible:false}]}).map(a=>a.id),['inside','outside']);
});
