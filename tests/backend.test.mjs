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

// ── photo library: media-update and media-delete (supabase/functions/moto-admin/media.mjs) ──
import {mediaAction,validateMediaUpdate,mediaUsedIn,mediaDocuments,canManageMedia} from '../supabase/functions/moto-admin/media.mjs';
const mediaId='123e4567-e89b-12d3-a456-426614174000';
const fakeStore=(over={})=>{const calls=[];const row={id:mediaId,path:'u/x.webp',name:'x.webp',alt:null,hidden:false};const docs={draft:{content:seed()},live:{content:publicDocument(seed())},revisions:[]};return {calls,row,docs,store:{
  getMedia:async id=>{calls.push(['get',id]);return over.missing?null:row;},
  updateMedia:async(id,patch)=>{calls.push(['update',id,patch]);return {...row,...patch};},
  documents:async()=>{calls.push(['documents']);return docs;},
  deleteMedia:async id=>{calls.push(['delete',id]);},
  removeObject:async path=>{calls.push(['remove',path]);return true;},
  audit:async(action,details)=>{calls.push(['audit',action,details]);},
}};};
const owner={user_id:'o',role:'owner',active:true},editor={user_id:'e',role:'editor',active:true},service={user_id:'s',role:'service',active:true};
test('media-update: owner and editor only; validated name, alt and hidden; audited',async()=>{
  assert(canManageMedia(owner)&&canManageMedia(editor)&&!canManageMedia(service)&&!canManageMedia(null)&&!canManageMedia({...owner,active:false}));
  const f=fakeStore();
  let r=await mediaAction('media-update',{id:mediaId,name:'  Castrol 4T  ',alt:'Castrol oil bottle',hidden:true},{staff:editor,store:f.store});
  assert.equal(r.status,200);assert.equal(r.body.media.name,'Castrol 4T');assert.equal(r.body.media.alt,'Castrol oil bottle');assert.equal(r.body.media.hidden,true);
  assert(f.calls.some(c=>c[0]==='audit'&&c[1]==='media_updated'));
  const s=fakeStore();r=await mediaAction('media-update',{id:mediaId,name:'x'},{staff:service,store:s.store});
  assert.equal(r.status,400);assert.match(r.body.error,/owner or a content manager/);assert.equal(s.calls.length,0);
  for(const bad of [{id:'nope',name:'x'},{id:mediaId},{id:mediaId,name:''},{id:mediaId,name:'x'.repeat(121)},{id:mediaId,alt:'x'.repeat(151)},{id:mediaId,hidden:'yes'},{id:mediaId,name:5}])assert.throws(()=>validateMediaUpdate(bad),undefined,JSON.stringify(bad));
  assert.deepEqual(validateMediaUpdate({id:mediaId,alt:''}).patch,{alt:null});
  r=await mediaAction('media-update',{id:mediaId,name:'x'},{staff:owner,store:fakeStore({missing:true}).store});assert.equal(r.status,400);
});
test('media-delete refuses while the draft, live site or a recent version uses the file',async()=>{
  const inDraft=fakeStore();inDraft.docs.draft.content.products[0].image='media:'+mediaId;
  let r=await mediaAction('media-delete',{id:mediaId},{staff:owner,store:inDraft.store});
  assert.equal(r.status,409);assert.equal(r.body.code,'MEDIA_IN_USE');assert.deepEqual(r.body.usedIn,['Saved draft']);assert(!inDraft.calls.some(c=>c[0]==='delete'||c[0]==='remove'));
  const inLive=fakeStore();inLive.docs.live.content.banners[0].image=`https://x.supabase.co/storage/v1/object/public/moto-public/${mediaId}.webp`;
  r=await mediaAction('media-delete',{id:mediaId},{staff:editor,store:inLive.store});assert.equal(r.status,409);assert.deepEqual(r.body.usedIn,['Live website']);
  const inRevision=fakeStore();inRevision.docs.revisions=[{created_at:'2026-11-01T10:00:00Z',content:{logo:'media:'+mediaId},public_content:{}}];
  r=await mediaAction('media-delete',{id:mediaId},{staff:owner,store:inRevision.store});assert.equal(r.status,409);assert.match(r.body.usedIn[0],/Earlier version of 2026-11-01/);
  const old=fakeStore();old.docs.revisions=[...Array.from({length:10},()=>({content:{},public_content:{}})),{content:{logo:'media:'+mediaId}}];
  assert.equal(mediaUsedIn(mediaId,mediaDocuments(old.docs)).length,0,'only the last 10 versions are checked');
});
test('media-delete removes an unused file and its row, audited; service staff cannot delete',async()=>{
  const f=fakeStore();let r=await mediaAction('media-delete',{id:mediaId.toUpperCase()},{staff:editor,store:f.store});
  assert.equal(r.status,200);assert.equal(r.body.deleted,true);
  assert(f.calls.some(c=>c[0]==='delete'&&c[1]===mediaId));assert(f.calls.some(c=>c[0]==='remove'&&c[1]==='u/x.webp'));assert(f.calls.some(c=>c[0]==='audit'&&c[1]==='media_deleted'));
  const s=fakeStore();r=await mediaAction('media-delete',{id:mediaId},{staff:service,store:s.store});assert.equal(r.status,400);assert.equal(s.calls.length,0);
  r=await mediaAction('media-delete',{id:'../etc'},{staff:owner,store:fakeStore().store});assert.equal(r.status,400);
  r=await mediaAction('media-wipe',{id:mediaId},{staff:owner,store:fakeStore().store});assert.equal(r.status,400);
});
test('moto-admin routes media-update and media-delete through mediaAction',()=>{
  const src=fs.readFileSync(new URL('../supabase/functions/moto-admin/index.ts',import.meta.url),'utf8');
  assert.match(src,/action==='media-update'\|\|action==='media-delete'/);assert.match(src,/mediaAction\(action,body,\{staff,store\}\)/);assert.match(src,/limit\(10\)/);
  const sql=fs.readFileSync(new URL('../supabase/migrations/202611100006_media_meta.sql',import.meta.url),'utf8');
  for(const col of ['name text','alt text','hidden boolean not null default false'])assert(sql.includes('add column if not exists '+col));
});

test('media-delete removes the stored files before the library row and keeps the row when removal fails', async () => {
  const {mediaAction} = await import('../supabase/functions/moto-admin/media.mjs');
  const owner = {user_id: 'u1', role: 'owner', active: true};
  const f = fakeStore();
  f.docs.draft = {content: seed()}; f.docs.live = {content: publicDocument(seed())};
  let r = await mediaAction('media-delete', {id: mediaId}, {staff: owner, store: f.store});
  assert.equal(r.status, 200);
  const order = f.calls.map(c => c[0]).filter(c => c === 'remove' || c === 'delete');
  assert.deepEqual(order, ['remove', 'delete']);
  const g = fakeStore();
  g.store.removeObject = async () => false;
  r = await mediaAction('media-delete', {id: mediaId}, {staff: owner, store: g.store});
  assert.equal(r.status, 500);
  assert(!g.calls.some(c => c[0] === 'delete'), 'the row stays when the file could not be removed');
});
