import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateContent,publicDocument,validateRequest,mediaReferences,resolveMedia,safeLink} from '../supabase/functions/moto-admin/schema.mjs';
const seed=()=>JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json',import.meta.url)));
const requestBase=()=>({key:crypto.randomUUID(),name:'Delivery test',phone:'01700000000',address:'R.A. Khan Chowdhury Road, Kushtia',delivery:'inside',kind:'order',items:[{id:'oil-motul-7100',qty:2}],expectedTotalMinor:270000});
test('existing catalogue migrates with its prices and six category and four service cards',()=>{const d=validateContent(seed());assert.equal(d.products.length,38);assert.equal(d.posts.length,1);assert.equal(d.blocks.length,10);assert.equal(d.vehicles.length,81);});
test('sale price must be lower; category and submenu references must exist',()=>{for(const change of [p=>p.sale=p.price,p=>p.price=-1,p=>p.category='missing',p=>p.subcategory='missing']){const d=seed();change(d.products[0]);assert.throws(()=>validateContent(d));}});
test('unpublished records and their dependent links do not leak',()=>{const d=seed();d.categories[0].visible=false;d.services[0].visible=false;d.content[0].visible=false;d.photos=[{secret:'private'}];const p=publicDocument(d);assert(!p.categories.some(c=>c.id===d.categories[0].id));assert(!p.products.some(c=>c.category===d.categories[0].id));assert(!p.blocks.some(b=>b.target===d.services[0].id));assert(!p.menu.some(m=>m.target===d.categories[0].id));assert(!p.content.some(c=>c.id===d.content[0].id));assert(!('photos'in p));});
test('public prices are recalculated and mismatches rejected',()=>{const live=publicDocument(seed()),body=requestBase(),r=validateRequest(body,live);assert.equal(r.details.subtotalMinor,270000);body.expectedTotalMinor=2;assert.throws(()=>validateRequest(body,live),/Prices changed/);body.expectedTotalMinor=270000;live.products[0].stock='Out of stock';assert.throws(()=>validateRequest(body,live),/unavailable/);});
test('invalid quantities, duplicates, empty bookings and past dates fail',()=>{const d=publicDocument(seed());for(const qty of [0,-1,1.2,51])assert.throws(()=>validateRequest({...requestBase(),items:[{id:d.products[0].id,qty}]},d));assert.throws(()=>validateRequest({...requestBase(),items:[...requestBase().items,...requestBase().items]},d));assert.throws(()=>validateRequest({...requestBase(),kind:'booking',services:[]},d));assert.throws(()=>validateRequest({...requestBase(),kind:'booking',services:[d.services[0].id],date:'2020-01-01'},d));});
test('private media references must all be resolved for publication',()=>{const id=crypto.randomUUID(),doc={image:'media:'+id,nested:[{picture:'media:'+id}]};assert.equal(mediaReferences(doc).size,1);assert.throws(()=>resolveMedia(doc,{}));assert.equal(resolveMedia(doc,{[id]:'https://example.com/photo.png'}).nested[0].picture,'https://example.com/photo.png');});
test('unsafe destinations and duplicate page addresses are rejected',()=>{assert(!safeLink('javascript:alert(1)'));assert(!safeLink('data:text/html,x'));const d=seed();d.pages.push({id:'new',custom:true,name:'Test',title:'Test',description:'',shareImage:d.settings.logo,slug:'test',html:'<h1>Test</h1>',css:''});d.posts=[{id:'post',name:'Test',slug:'test',body:'Story',image:d.settings.logo,date:'2026-10-10',author:'Store'}];assert.throws(()=>validateContent(d),/unique address/);});
test('orders need a delivery address and keep it with the request',()=>{
  const live=publicDocument(JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json',import.meta.url))));
  const b=requestBase();
  assert.equal(validateRequest(b,live).details.address,'R.A. Khan Chowdhury Road, Kushtia');
  assert.throws(()=>validateRequest({...b,address:''},live),/address/i);
  assert.throws(()=>validateRequest({...b,address:'abc'},live),/address/i);
  assert.throws(()=>validateRequest({...b,address:undefined},live),/address/i);
});
test('product data sheets accept an uploaded PDF or an https link only',()=>{
  const d=JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json',import.meta.url)));
  for(const ok of ['','media:123e4567-e89b-12d3-a456-426614174000','https://example.com/castrol-pds.pdf']){d.products[0].datasheet=ok;validateContent(d);}
  for(const bad of ['javascript:alert(1)','http://example.com/a.pdf','assets/../x.pdf',42]){d.products[0].datasheet=bad;assert.throws(()=>validateContent(d),/data sheet/i);}
});
test('invoices escape customer text and total the lines',async()=>{
  const {invoiceHtml}=await import('../supabase/functions/_shared/invoice.mjs');
  const html=invoiceHtml({receipt:'MM-ABC',createdAt:'2026-11-04T10:00:00Z',name:'<b>x</b>',phone:'017',address:'Kushtia',items:[{name:'Oil',quantity:2,unitPriceMinor:140000}],store:{name:'Moto Market'}});
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;')&&!html.includes('<b>x</b>'));
  assert.ok(html.includes('৳2,800'));
});
test('order bills add the chosen delivery charge to the product prices',()=>{
  const live=publicDocument(JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json',import.meta.url))));
  const inside=validateRequest(requestBase(),live).details;
  assert.equal(inside.subtotalMinor,270000);assert.equal(inside.deliveryMinor,12000);assert.equal(inside.totalMinor,282000);
  const outside=validateRequest({...requestBase(),delivery:'outside'},live).details;
  assert.equal(outside.deliveryMinor,15000);assert.equal(outside.totalMinor,285000);
  assert.throws(()=>validateRequest({...requestBase(),delivery:''},live),/delivery/i);
  assert.throws(()=>validateRequest({...requestBase(),delivery:'free'},live),/delivery/i);
});
const withoutNewSettings=()=>{const d=seed();for(const k of ['delivery','orderEmail','parentCompany','invoiceNote','paymentMethods','requestReceived','bookingSlots','whatsappGreeting'])delete d.settings[k];return d;};
test('documents saved before the new store settings still validate and keep the 120/150 delivery fees',()=>{
  const d=withoutNewSettings();validateContent(d);const live=publicDocument(d);
  assert.equal(validateRequest(requestBase(),live).details.deliveryMinor,12000);
  assert.equal(validateRequest({...requestBase(),delivery:'outside'},live).details.deliveryMinor,15000);
  validateContent(seed());
});
test('delivery areas and fees come from store settings',()=>{
  const d=seed();d.settings.delivery=[{id:'city',label:'City',fee:80},{id:'far',label:'Far away',fee:300,visible:false}];validateContent(d);const live=publicDocument(d);
  const r=validateRequest({...requestBase(),delivery:'city'},live).details;
  assert.equal(r.deliveryMinor,8000);assert.equal(r.delivery,'City');assert.equal(r.totalMinor,278000);
  assert.throws(()=>validateRequest(requestBase(),live),/delivery area/i);
  assert.throws(()=>validateRequest({...requestBase(),delivery:'far'},live),/delivery area/i);
});
test('a stale delivery fee is rejected; an absent expected fee is still accepted',()=>{
  const live=publicDocument(seed());
  assert.equal(validateRequest({...requestBase(),expectedDeliveryMinor:12000},live).details.deliveryMinor,12000);
  assert.throws(()=>validateRequest({...requestBase(),expectedDeliveryMinor:15000},live),/Prices changed/);
  assert.throws(()=>validateRequest({...requestBase(),expectedDeliveryMinor:'12000'},live),/Prices changed/);
  assert.doesNotThrow(()=>validateRequest(requestBase(),live));
});
test('invalid store settings are rejected',()=>{
  const bad=[
    s=>s.delivery=[],s=>s.delivery='inside',s=>s.delivery=[{id:'a',label:'A',fee:1},{id:'a',label:'B',fee:2}],
    s=>s.delivery=[{id:'A b',label:'A',fee:1}],s=>s.delivery=[{id:'a',label:'',fee:1}],s=>s.delivery=[{id:'a',label:'x'.repeat(101),fee:1}],
    s=>s.delivery=[{id:'a',label:'A',fee:-1}],s=>s.delivery=[{id:'a',label:'A',fee:1.5}],s=>s.delivery=[{id:'a',label:'A',fee:100001}],s=>s.delivery=[{id:'a',label:'A',fee:'120'}],
    s=>s.delivery=[{id:'a',label:'A',fee:1,visible:false}],s=>s.delivery=Array.from({length:21},(_,i)=>({id:'a'+i,label:'A',fee:1})),
    s=>s.orderEmail='not-an-email',s=>s.orderEmail=5,s=>s.email='shop at gmail',
    s=>s.parentCompany='x'.repeat(151),s=>s.invoiceNote='x'.repeat(301),s=>s.requestReceived='x'.repeat(301),s=>s.paymentMethods='x'.repeat(151),s=>s.whatsappGreeting='x'.repeat(61),s=>s.parentCompany=3,
    s=>s.bookingSlots=Array.from({length:13},(_,i)=>'Slot '+i),s=>s.bookingSlots=['Any time'],s=>s.bookingSlots=['Morning','Morning'],s=>s.bookingSlots=[''],s=>s.bookingSlots=['x'.repeat(101)],s=>s.bookingSlots='Morning',
    s=>s.siteUrl='http://example.com/',
  ];
  for(const change of bad){const d=seed();change(d.settings);assert.throws(()=>validateContent(d),undefined,String(change));}
  const d=seed();Object.assign(d.settings,{email:'',orderEmail:'orders@example.com',parentCompany:'',bookingSlots:[],delivery:[{id:'pickup',label:'Pick up at the shop',fee:0}],siteUrl:'https://example.com/'});validateContent(d);
});
test('the private order email never reaches the public document',()=>{
  const d=seed();d.settings.orderEmail='owner@example.com';const p=publicDocument(d);
  assert(!('orderEmail' in p.settings));assert.equal(d.settings.orderEmail,'owner@example.com');assert.equal(p.settings.email,d.settings.email);
});
test('booking time stays free text',()=>{
  const live=publicDocument(seed()),base={...requestBase(),kind:'booking',services:[live.services[0].id]};
  assert.equal(validateRequest(base,live).details.slot,'Any time');
  assert.equal(validateRequest({...base,slot:'Morning · 9:00 – 12:00'},live).details.slot,'Morning · 9:00 – 12:00');
  assert.equal(validateRequest({...base,slot:'Old cached slot'},live).details.slot,'Old cached slot');
  assert.throws(()=>validateRequest({...base,slot:'x'.repeat(101)},live));
});
