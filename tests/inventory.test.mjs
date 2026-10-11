import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stockLabel,stockStatus,quantityOf} from '../supabase/functions/_shared/inventory.mjs';
import {cartInventory} from '../cms/catalog.mjs';
import {validateContent,validateRequest,publicDocument} from '../supabase/functions/moto-admin/schema.mjs';
const seed=()=>JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json',import.meta.url)));
test('uncounted stock stays unknown; zero stock and per-colour counts are accurate',()=>{
 assert.equal(quantityOf({stock:'In stock'}),null);assert.equal(stockLabel({stock:'In stock'}),'In stock');
 assert.equal(stockStatus({stock:'In stock',quantity:0}),'Out of stock');
 assert.equal(stockLabel({stock:'In stock',quantity:1,unit:'bottle'}),'1 bottle available');
 const p={stock:'In stock',unit:'pair',colors:[{id:'r',quantity:3,stock:'In stock'},{id:'b',quantity:0,stock:'In stock'}]};
 assert.equal(quantityOf(p),3);assert.equal(stockLabel(p,p.colors[0]),'3 pairs available');assert.equal(stockStatus(p,p.colors[1]),'Out of stock');
 p.colors[1].quantity=null;assert.equal(quantityOf(p),null);
});
test('cart quantities obey colour counts and the total stock across variants',()=>{
 const p={id:'p',name:'Part',price:100,stock:'In stock',quantity:4,unit:'set',colors:[{id:'r',stock:'In stock',quantity:3},{id:'b',stock:'In stock',quantity:3}]};
 const lines=cartInventory([p],[{id:'p',colorId:'r',qty:5},{id:'p',colorId:'b',qty:4}]);
 assert.deepEqual(lines.map(l=>l.qty),[3,1]);assert.equal(lines[0].unit,'set');p.quantity=0;assert.deepEqual(cartInventory([p],lines),[]);
});
test('server rejects invalid stock counts and excess stock across colours',()=>{
 const d=seed(),p=d.products[0];p.quantity=-1;assert.throws(()=>validateContent(d),/quantity/i);p.quantity=1.5;assert.throws(()=>validateContent(d),/quantity/i);p.quantity=4;p.unit='unsafe';assert.throws(()=>validateContent(d),/unit/i);p.unit='piece';
 p.colors=[{id:'red',name:'Red',stock:'In stock',hex:'#dc1238',quantity:3,image:''},{id:'blue',name:'Blue',stock:'In stock',hex:'#0000ff',quantity:3,image:''}];validateContent(d);
 const b={key:crypto.randomUUID(),name:'Stock test',phone:'01700000000',kind:'order',items:[{id:p.id,colorId:'red',qty:3},{id:p.id,colorId:'blue',qty:2}],expectedTotalMinor:5*(p.sale||p.price)*100};
 assert.throws(()=>validateRequest(b,publicDocument(d)),/stock/i);b.items[1].qty=1;b.expectedTotalMinor=4*(p.sale||p.price)*100;assert.equal(validateRequest(b,publicDocument(d)).details.items[0].unit,'piece');
 b.items=[{id:p.id,colorId:'red',qty:4}];assert.throws(()=>validateRequest(b,publicDocument(d)),/stock/i);p.quantity=0;assert.equal(publicDocument(d).products[0].stock,'Out of stock');
});
