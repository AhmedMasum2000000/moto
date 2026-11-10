// One invoice layout for the customer (after ordering) and for staff (control room).
// Every value is escaped; the result is a standalone printable HTML document.
// The sister-concern line, closing note and payment methods come from Store settings
// (store-defaults.mjs supplies today's wording when a value is not set).
import {storeSettings} from './store-defaults.mjs';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = minor => '৳' + (Number(minor || 0) / 100).toLocaleString('en-BD', {maximumFractionDigits: 2});

export function invoiceHtml({receipt, createdAt, name, phone, address, items = [], totalMinor, deliveryMinor = 0, delivery = '', store = {}, embedded = false}) {
  const S = storeSettings(store || {});
  store = store || {};
  const note = [S.invoiceNote, S.paymentMethods ? 'Payment: ' + S.paymentMethods + '.' : ''].filter(Boolean).join(' ');
  const date = new Date(createdAt || Date.now());
  const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB', {timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short'});
  const subtotal = items.reduce((sum, i) => sum + i.unitPriceMinor * i.quantity, 0);
  const total = totalMinor ?? subtotal + (deliveryMinor || 0);
  const rows = items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}${i.colorName ? ' · ' + esc(i.colorName) : ''}</td><td class="r">${esc(i.quantity)}</td><td class="r">${money(i.unitPriceMinor)}</td><td class="r">${money(i.unitPriceMinor * i.quantity)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(receipt)} · ${esc(store.name || 'Moto Market')}</title><style>
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1f1e22;background:#fff;margin:0;padding:32px}
.inv{max-width:760px;margin:0 auto;overflow-wrap:anywhere}.head{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #dc1238;padding-bottom:16px}
h1{margin:0;font-size:28px;letter-spacing:.04em}.muted{color:#5a5862}.r{text-align:right}
table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}th{background:#f4f3f6;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.total td{font-weight:700;font-size:16px;border-bottom:0}.cols{display:flex;justify-content:space-between;gap:24px;margin-top:20px}
.note{margin-top:24px;font-size:12px;color:#5a5862}.actions{text-align:center;margin:24px 0}button{background:#dc1238;color:#fff;border:0;padding:12px 24px;font:inherit;cursor:pointer}
@media print{.actions{display:none}body{padding:0}}
td.r,th.r{white-space:nowrap}
@media(max-width:520px){body{padding:12px}.head{flex-direction:column;gap:12px}.head .r{text-align:left}h1{font-size:22px}th,td{padding:6px 3px;font-size:12px}th{letter-spacing:0}}
</style></head><body><div class="inv">
<div class="head"><div><h1>${esc(store.name || 'Moto Market')}</h1>${S.parentCompany ? `<div class="muted">A sister concern of ${esc(S.parentCompany)}</div>` : ''}<div class="muted">${esc(store.address || '')}</div><div class="muted">${esc(store.phone || '')}${store.email ? ' · ' + esc(store.email) : ''}</div></div>
<div class="r"><h1>INVOICE</h1><div><b>${esc(receipt)}</b></div><div class="muted">${esc(when)}</div></div></div>
<div class="cols"><div><div class="muted">Bill to</div><b>${esc(name)}</b><div>${esc(phone)}</div><div>${esc(address || '')}</div></div></div>
<table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody>
<tfoot>${deliveryMinor ? `<tr><td colspan="4" class="r">Products</td><td class="r">${money(subtotal)}</td></tr><tr><td colspan="4" class="r">Delivery charge${delivery ? ' (' + esc(delivery) + ')' : ''}</td><td class="r">${money(deliveryMinor)}</td></tr>` : ''}<tr class="total"><td colspan="4" class="r">Total payable</td><td class="r">${money(total)}</td></tr></tfoot></table>
<p class="note">${esc(note)}</p>
${embedded ? '' : '<div class="actions"><button type="button" onclick="print()">Print / Save as PDF</button></div>'}
</div></body></html>`;
}

export function invoiceUrl(data) {
  const url = URL.createObjectURL(new Blob([invoiceHtml(data)], {type: 'text/html'}));
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return url;
}

export function openInvoice(data, win = null) {
  const url = invoiceUrl(data);
  if (win && !win.closed) { win.location.href = url; return win; }
  return window.open(url, '_blank');
}
