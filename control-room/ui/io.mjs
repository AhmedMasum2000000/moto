// Products spreadsheet export and import (CSV only), plan role I5.
// Export writes every product; import shows a preview (New / Updated / Error per row, new categories
// and subcategories, the product count against 2000 and the document size against 1.8 MB) and then
// makes one ctx.save(next, 'Imported 120 products (18 new)') that Undo can reverse.
//
// Exports
//   renderIoButtons(ctx) → html         header buttons ([data-tour="io-export"], [data-tour="io-import"])
//   bindIo(ctx, root)                   wires the buttons (a hidden file input is created on demand)
//   importFromText(ctx, text) → {next, report}   parse + plan (used by the preview and by tests)
//   importPreviewHtml(ctx, report) → html
//   downloadText(name, text)            saves a file in the browser
import {parseCsv, planImport, productsCsv, templateCsv, exportFileName, importLabel, LIMITS_IMPORT} from '../lib/csv.mjs';
import {validateContent} from '../../supabase/functions/moto-admin/schema.mjs';

const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const E = ctx => ctx?.esc || escHtml;
const editors = role => role === 'owner' || role === 'editor';
const PREVIEW_ROWS = 300;
const STATUS = {new: ['New', 'io-new'], updated: ['Updated', 'io-upd'], unchanged: ['No change', 'io-same'], error: ['Error', 'io-err']};

export function renderIoButtons(ctx) {
  if (!editors(ctx.role)) return '';
  return `<div class="io-buttons" data-io-root><button class="btn ghost" type="button" data-io="export" data-tour="io-export">Export (CSV)</button><button class="btn ghost" type="button" data-io="import" data-tour="io-import">Import from spreadsheet</button><button class="btn ghost io-template" type="button" data-io="template">Download template</button></div>`;
}

export function downloadText(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = Object.assign(document.createElement('a'), {href: url, download: name, rel: 'noopener'});
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function importFromText(ctx, text) {
  const rows = parseCsv(text);
  if (!rows.length) return {next: null, report: {created: 0, updated: 0, unchanged: 0, errors: [{row: 1, message: 'The file is empty.'}], newCategories: [], newSubs: [], rows: [], ignoredColumns: [], products: (ctx.data?.products || []).length, bytes: JSON.stringify(ctx.data || {}).length, limits: LIMITS_IMPORT, canImport: false}};
  return planImport(ctx.data, rows);
}

const kb = n => (n / 1000000).toLocaleString('en-GB', {maximumFractionDigits: 2}) + ' MB';

export function importPreviewHtml(ctx, report, fileName = '') {
  const esc = E(ctx), r = report;
  const errorsByRow = new Map();
  for (const e of r.errors || []) errorsByRow.set(e.row, [...(errorsByRow.get(e.row) || []), e.message]);
  const rows = (r.rows || []).slice(0, PREVIEW_ROWS);
  const general = (r.errors || []).filter(e => !(r.rows || []).some(x => x.row === e.row));
  const n = r.created + r.updated;
  return `<h2>${n ? `${n} product${n === 1 ? '' : 's'} ready to import.` : 'Nothing to import yet.'}</h2>
<p class="small-note">${fileName ? esc(fileName) + ' · ' : ''}Check the list, then confirm. Nothing changes until you do, and Undo can reverse it.</p>
<div class="io-summary">
 <span class="io-badge io-new">${r.created} new</span><span class="io-badge io-upd">${r.updated} updated</span>${r.unchanged ? `<span class="io-badge io-same">${r.unchanged} no change</span>` : ''}<span class="io-badge io-err">${(r.errors || []).length} error${(r.errors || []).length === 1 ? '' : 's'}</span>
</div>
<div class="io-limits">
 <div class="${r.overProducts ? 'is-over' : ''}"><b>${r.products.toLocaleString('en-GB')}</b> of ${LIMITS_IMPORT.products.toLocaleString('en-GB')} products after import</div>
 <div class="${r.overBytes ? 'is-over' : ''}"><b>${kb(r.bytes)}</b> of ${kb(LIMITS_IMPORT.bytes)} website size</div>
</div>
${r.newCategories?.length ? `<p class="io-new-list"><b>New categories (${r.newCategories.length}):</b> ${esc(r.newCategories.join(', '))}</p>` : ''}
${r.newSubs?.length ? `<p class="io-new-list"><b>New subcategories (${r.newSubs.length}):</b> ${esc(r.newSubs.join(', '))}</p>` : ''}
${r.ignoredColumns?.length ? `<p class="small-note">These columns are not used and were skipped: ${esc(r.ignoredColumns.join(', '))}</p>` : ''}
${general.length ? `<ul class="io-errors">${general.map(e => `<li>Row ${esc(e.row)}: ${esc(e.message)}</li>`).join('')}</ul>` : ''}
${r.overProducts ? `<p class="io-stop">This would go over ${LIMITS_IMPORT.products.toLocaleString('en-GB')} products. Remove some rows and try again.</p>` : ''}
${r.overBytes ? '<p class="io-stop">This would make the website too large to save. Use fewer gallery pictures or shorter descriptions.</p>' : ''}
${rows.length ? `<div class="io-table-wrap"><table class="io-table"><thead><tr><th>Row</th><th>Product</th><th>Result</th></tr></thead><tbody>${rows.map(x => {
  const [label, cls] = STATUS[x.status] || STATUS.error;
  const msg = x.message || (errorsByRow.get(x.row) || []).join(' ');
  return `<tr><td>${esc(x.row)}</td><td>${esc(x.name || x.id || '')}${msg ? `<small>${esc(msg)}</small>` : ''}</td><td><span class="io-badge ${cls}">${label}</span></td></tr>`;
}).join('')}</tbody></table></div>${(r.rows || []).length > PREVIEW_ROWS ? `<p class="small-note">Showing the first ${PREVIEW_ROWS} of ${r.rows.length} rows.</p>` : ''}` : ''}
<div class="modal-footer"><button class="btn ghost" type="button" data-io-cancel>Cancel</button><button class="btn primary" type="button" data-io-confirm ${r.canImport ? '' : 'disabled'}>Import ${n} product${n === 1 ? '' : 's'}</button></div>`;
}

let pending = null, globalCtx = null, busy = false;
function bindGlobal(ctx) {
  const first = !globalCtx;
  globalCtx = ctx;
  if (!first || typeof document === 'undefined') return;
  document.addEventListener('click', async e => {
    const b = e.target.closest?.('[data-io-confirm],[data-io-cancel]');
    if (!b) return;
    const ctx = globalCtx, dlg = b.closest('dialog');
    if (b.dataset.ioCancel !== undefined) { pending = null; dlg?.close(); return; }
    if (!pending || busy) return;
    if (pending.src !== ctx.data) { pending = null; dlg?.close(); ctx.toast?.('The products changed while the preview was open. Import the file again.'); return; }
    busy = true; b.disabled = true;
    try {
      validateContent(structuredClone(pending.next));
      await ctx.save(pending.next, importLabel(pending.report));
      pending = null;
      dlg?.close();
    } catch (err) {
      ctx.toast?.(err?.message || 'The import could not be saved.');
      b.disabled = false;
    } finally { busy = false; }
  });
}

function fileInput() {
  let input = document.getElementById('io-csv-input');
  if (!input) {
    input = Object.assign(document.createElement('input'), {type: 'file', id: 'io-csv-input', accept: '.csv,text/csv', hidden: true});
    document.body.append(input);
  }
  return input;
}

export function bindIo(ctx, root) {
  bindGlobal(ctx);
  const box = root?.matches?.('[data-io-root]') ? root : root?.querySelector?.('[data-io-root]');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-io]');
    if (!b) return;
    const what = b.dataset.io;
    if (what === 'export') {
      const n = (ctx.data.products || []).length;
      downloadText(exportFileName(), productsCsv(ctx.data));
      ctx.toast?.(`Downloaded ${n} product${n === 1 ? '' : 's'}. Open it in Excel or Google Sheets.`);
      return;
    }
    if (what === 'template') { downloadText('moto-market-products-template.csv', templateCsv()); return; }
    if (what === 'import') {
      const input = fileInput();
      input.value = '';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (!/\.csv$/i.test(file.name) && file.type && !/csv|text\/plain/.test(file.type)) { ctx.toast?.('Choose a CSV file. In Excel use File → Save as → CSV UTF-8.'); return; }
        if (file.size > 5 * 1024 * 1024) { ctx.toast?.('Choose a CSV file smaller than 5 MB.'); return; }
        try {
          const src = ctx.data, {next, report} = importFromText(ctx, await file.text());
          pending = next ? {next, report, src} : null;
          ctx.modal({title: 'Import from spreadsheet', mascot: true, body: importPreviewHtml(ctx, report, file.name)});
        } catch (err) { ctx.toast?.(err?.message || 'The file could not be read.'); }
      };
      input.click();
    }
  });
}
