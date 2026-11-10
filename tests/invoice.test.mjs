import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceHtml,invoiceUrl,openInvoice} from '../supabase/functions/_shared/invoice.mjs';
const base={receipt:'MM-1',createdAt:'2026-11-04T10:00:00Z',name:'Rahim',phone:'017',address:'Kushtia',items:[{name:'Oil',quantity:1,unitPriceMinor:135000}],deliveryMinor:12000,delivery:'Inside Kushtia'};
test('default invoice keeps today’s tagline, note and payment methods',()=>{
  const html=invoiceHtml({...base,store:{name:'Moto Market',address:'R.A. Khan Chowdhury Road',phone:'+880 1711-154387',email:'shop@example.com'}});
  assert.ok(html.includes('<div class="muted">A sister concern of Motolube Bangladesh</div>'));
  assert.ok(html.includes('<p class="note">Our team will call to confirm stock and price before delivery. Payment: Cash · bKash · Nagad.</p>'));
  assert.ok(html.includes('R.A. Khan Chowdhury Road')&&html.includes('+880 1711-154387 · shop@example.com'));
  assert.ok(html.includes('৳1,470'));
  for(const store of [undefined,null,{}])assert.ok(invoiceHtml({...base,store}).includes('A sister concern of Motolube Bangladesh'));
});
test('an empty sister-concern line is hidden and custom texts are used',()=>{
  const html=invoiceHtml({...base,store:{name:'Moto Market',parentCompany:'',invoiceNote:'We call you first.',paymentMethods:'Cash only'}});
  assert.ok(!html.includes('sister concern'));
  assert.ok(html.includes('<p class="note">We call you first. Payment: Cash only.</p>'));
  assert.ok(invoiceHtml({...base,store:{parentCompany:'Acme Group'}}).includes('A sister concern of Acme Group'));
});
test('store texts are HTML-escaped',()=>{
  const html=invoiceHtml({...base,store:{name:'<i>N</i>',parentCompany:'<script>x</script>',invoiceNote:'a & "b"',paymentMethods:'<b>bKash</b>'}});
  assert.ok(!html.includes('<script>x</script>')&&html.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(html.includes('a &amp; &quot;b&quot;')&&html.includes('&lt;b&gt;bKash&lt;/b&gt;')&&html.includes('&lt;i&gt;N&lt;/i&gt;'));
});
test('the invoice API stays the same',()=>{
  assert.equal(typeof invoiceUrl,'function');assert.equal(typeof openInvoice,'function');
  assert.ok(!invoiceHtml({...base,embedded:true}).includes('Print / Save as PDF'));
  assert.ok(invoiceHtml(base).includes('Print / Save as PDF'));
});
