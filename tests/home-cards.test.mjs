import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {load} from 'cheerio';
import {categoryMatches,categoryUrl,moveCard,removedHomeSections,updateHomepage} from '../cms/home-cards.mjs';
import {validateContent,publicDocument,mediaReferences,resolveMedia} from '../supabase/functions/moto-admin/schema.mjs';
const seed=()=>JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json',import.meta.url)));
test('homepage cards split helmets from riding gear without changing shop taxonomy',()=>{
  const d=seed(),gear=d.blocks.find(b=>b.id==='gear-card'),helmet=d.blocks.find(b=>b.id==='helmets');
  assert.equal(d.blocks.filter(b=>b.kind==='category').length,6);
  assert.equal(d.blocks.filter(b=>b.kind==='service').length,4);
  assert.deepEqual(d.products.filter(p=>categoryMatches(p,helmet)),d.products.filter(p=>p.category==='helmets'&&p.subcategory==='Helmets'));
  assert(categoryMatches(d.products.find(p=>p.id==='hel-agv-k1'),helmet));
  assert(!categoryMatches(d.products.find(p=>p.id==='hel-gloves'),helmet));
  assert.deepEqual(d.products.filter(p=>categoryMatches(p,gear)).map(p=>p.id),['hel-gloves']);
  assert.match(categoryUrl(helmet),/collection=helmets/);
  assert.equal(categoryUrl(d.blocks.find(b=>b.id==='oil')),'shop.html?cat=oil');
});
test('reordering a filtered card group leaves other cards in place',()=>{
  const blocks=[{id:'a',kind:'category'},{id:'s',kind:'service'},{id:'b',kind:'category'}];
  assert(moveCard(blocks,'b',-1));assert.deepEqual(blocks.map(b=>b.id),['b','s','a']);
  assert(!moveCard(blocks,'s',1));assert(!moveCard(blocks,'missing',-1));assert(!moveCard(blocks,'b',-1));
});
test('preview uploads publish correctly; invalid pictures and cross-category filters fail',()=>{
  const d=seed(),card=d.blocks.find(b=>b.id==='helmets'),id=crypto.randomUUID();card.previewImage='media:'+id;
  validateContent(d);assert(mediaReferences(d).has(id));assert.equal(resolveMedia(publicDocument(d),{[id]:'https://example.com/preview.png'}).blocks.find(b=>b.id===card.id).previewImage,'https://example.com/preview.png');
  card.previewImage='javascript:bad';assert.throws(()=>validateContent(d),/preview picture/);card.previewImage='';card.subcategories=['Not a real subcategory'];assert.throws(()=>validateContent(d),/subcategories/);
});
test('requested sections are gone, Category is followed by Servicing, and contact navigation works',()=>{
  const d=seed(),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),$=load(html);
  for(const id of removedHomeSections){assert(!d.content.some(s=>s.id===id));assert.equal($(`[data-cms-section="${id}"]`).length,0);}
  assert.equal($('.partners').length,0);assert.equal($('#brands').next('section').attr('id'),'services');
  assert.equal(d.content[d.content.findIndex(s=>s.id==='index-brands')+1].id,'index-services');assert.equal($('#contact').prop('tagName'),'FOOTER');
  assert.equal($('a[href="index.html#faq"],a[href="index.html#pricing"]').length,0);
  const htmlIds=new Set($('[id]').map((_,el)=>$(el).attr('id')).get());assert.equal(htmlIds.size,$('[id]').length);
});
test('homepage content update preserves products, campaign banners and staff-added cards',()=>{
  const d=seed(),prices=d.products.map(p=>p.price),banners=structuredClone(d.banners);d.blocks.push({id:'staff-card',kind:'category',target:'oil',name:'Staff choice',image:'assets/icons/engine-oil.png',visible:true});
  updateHomepage(d);assert.deepEqual(d.products.map(p=>p.price),prices);assert.deepEqual(d.banners,banners);assert(d.blocks.some(b=>b.id==='staff-card'));assert.equal(d.blocks.filter(b=>b.id==='gear-card').length,1);
});
