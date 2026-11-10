// Photos page, the details sheet and the photo chooser (plan role I5).
// Library = uploaded files (ctx.media, rows of moto_media) plus the built-in assets/ pictures the
// website uses. Search and chips (All, Used, Unused, Products, Banners, Documents, Hidden), multi-file
// upload with a progress list, and a details sheet with where-used, display name, alt text, Replace
// (rewrites every ref in one save) and Delete (only when unused; the server re-checks the draft, the
// live site and the last 10 versions, and the sheet then offers "Hide from library").
//
// Needs on ctx (besides the plan's ctx): media (array of moto_media rows, mutated in place),
// mediaUrls (id → signed URL, mutated in place), admin(action, args) for media-update / media-delete,
// and optionally uploadDocument(file) for PDFs. upload(file) must resolve to {media, url}.
//
// Exports
//   renderPhotos(ctx, {heading}) → html       the page ([data-tour="photos-upload"], [data-tour="photos-filters"])
//   bindPhotos(ctx, root)
//   openPhotoDetails(ctx, ref)                the details sheet ([data-tour="photo-details"])
//   chooserHtml(ctx, {kind}) → html           the picker body for chooseImage() ([data-tour="chooser-search"])
//   bindChooser(ctx, root, onPick, {kind})    onPick(ref, item) after a click or an upload
//   libraryItems(ctx) → [{ref, id, name, alt, kind, hidden, uploaded, uses, types}]
//   usageIndex(doc) → Map(ref → {count, types:Set})
//   replaceRefs(doc, from, to) → {next, count}   pure
//   mediaAlt(ctx, ref) → string               the library's default alt text for a picture
//   uploadFiles(ctx, files, onProgress) → Promise<[{file, ok, item?, error?}]>
import {normalise} from '../../cms/content-model.mjs';
import {findImageUsage} from '../lib/records.mjs';
import {validateContent} from '../../supabase/functions/moto-admin/schema.mjs';

const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const E = ctx => ctx?.esc || escHtml;
const editors = role => role === 'owner' || role === 'editor';
const ASSET = /^assets\/[a-zA-Z0-9_./-]+\.(png|webp|jpe?g)$/i;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const COLLECTIONS = {products: 'product', categories: 'category', banners: 'banner', services: 'service', blocks: 'block', kits: 'kit', brands: 'brand', vehicles: 'vehicle', content: 'content', pages: 'page', posts: 'post', menu: 'menu', sections: 'section', brandGroups: 'brandGroup'};
const TYPE_LABEL = {product: 'Product', category: 'Category', banner: 'Banner', service: 'Service', block: 'Card', kit: 'Bundle', brand: 'Brand', vehicle: 'Model', content: 'Page text', page: 'Page', post: 'Post', menu: 'Menu', section: 'Section', brandGroup: 'Brand group', settings: 'Store settings'};
export const CHIPS = [['all', 'All'], ['used', 'Used'], ['unused', 'Unused'], ['products', 'Products'], ['banners', 'Banners'], ['documents', 'Documents (PDF)'], ['hidden', 'Hidden']];

const state = {q: '', chip: 'all', chooserQ: '', chooserChip: 'all'};
let viewMemo = {src: null, doc: null, index: null};
const view = ctx => {
  if (viewMemo.src !== ctx.data) { const doc = normalise(ctx.data); viewMemo = {src: ctx.data, doc, index: usageIndex(doc)}; }
  return viewMemo;
};
const mediaList = ctx => Array.isArray(ctx.media) ? ctx.media : [];
const sizeText = n => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// ── pure helpers ──────────────────────────────────────────────────────────────────────────────
// One pass over the document: every media:/assets/ string → how many places use it, and by what.
export function usageIndex(input) {
  const doc = normalise(input), out = new Map();
  const add = (ref, type) => { const e = out.get(ref) || {count: 0, types: new Set()}; e.count++; e.types.add(type); out.set(ref, e); };
  const walk = (v, type) => {
    if (typeof v === 'string') { if (v.startsWith('media:') || ASSET.test(v)) add(v, type); return; }
    if (Array.isArray(v)) { v.forEach(x => walk(x, type)); return; }
    if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, type);
  };
  for (const [k, type] of Object.entries(COLLECTIONS)) for (const r of Array.isArray(doc?.[k]) ? doc[k] : []) walk(r, type);
  if (doc?.settings) walk(doc.settings, 'settings');
  return out;
}

// Rewrites every string equal to `from` into `to` (pictures, gallery refs, page fields, settings).
export function replaceRefs(input, from, to) {
  const next = normalise(input);
  let count = 0;
  const walk = v => {
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { if (v[i] === from) { v[i] = to; count++; } else walk(v[i]); } return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (x === from) { v[k] = to; count++; } else walk(x); }
  };
  for (const k of [...Object.keys(COLLECTIONS), 'settings']) if (next[k]) walk(next[k]);
  return {next, count};
}

export function libraryItems(ctx) {
  const {index} = view(ctx), items = [], seen = new Set();
  for (const m of mediaList(ctx)) {
    const ref = 'media:' + m.id;
    seen.add(ref);
    const u = index.get(ref);
    items.push({ref, id: m.id, name: m.name || 'Untitled', alt: m.alt || '', kind: m.mime_type === 'application/pdf' ? 'pdf' : 'image', hidden: !!m.hidden, uploaded: true, uses: u?.count || 0, types: u?.types || new Set(), media: m});
  }
  for (const [ref, u] of index) {
    if (seen.has(ref) || !ASSET.test(ref)) continue;
    seen.add(ref);
    items.push({ref, id: '', name: ref.split('/').pop().replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' '), alt: '', kind: 'image', hidden: false, uploaded: false, uses: u.count, types: u.types});
  }
  return items;
}

const matches = (it, chip, q) => {
  if (chip === 'hidden') { if (!it.hidden) return false; }
  else if (it.hidden) return false;
  if (chip === 'used' && !it.uses) return false;
  if (chip === 'unused' && it.uses) return false;
  if (chip === 'products' && !it.types.has('product')) return false;
  if (chip === 'banners' && !it.types.has('banner')) return false;
  if (chip === 'documents' && it.kind !== 'pdf') return false;
  if (q && !(it.name + ' ' + it.alt + ' ' + it.ref).toLowerCase().includes(q)) return false;
  return true;
};

export function mediaAlt(ctx, ref) {
  const id = String(ref || '').startsWith('media:') ? ref.slice(6) : '';
  return id ? mediaList(ctx).find(m => m.id === id)?.alt || '' : '';
}

const thumb = (ctx, it, cls = '') => it.kind === 'pdf'
  ? `<span class="ph-doc ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2h9l5 5v15H6zM14 2v6h6"/></svg><b>PDF</b></span>`
  : `<img class="${cls}" loading="lazy" src="${E(ctx)(ctx.imageUrl ? ctx.imageUrl(it.ref) : '')}" alt="${E(ctx)(it.alt || it.name)}">`;

// ── page ──────────────────────────────────────────────────────────────────────────────────────
function gridHtml(ctx) {
  const esc = E(ctx), items = libraryItems(ctx), q = state.q.trim().toLowerCase();
  const shown = items.filter(it => matches(it, state.chip, q));
  if (!shown.length) return `<div class="empty-inline">${ctx.icon ? ctx.icon('image') : ''}<span>${items.length ? 'Nothing matches. Try another word or chip.' : 'No photos yet. Upload your first one.'}</span></div>`;
  return `<div class="media-grid ph-grid">${shown.map(it => `<button class="media-card ph-card${it.hidden ? ' is-hidden' : ''}" type="button" data-ph-open="${esc(it.ref)}"><div class="media-art${it.kind === 'pdf' || /^assets\/(icons|brands|mascot)\//.test(it.ref) ? ' icon-art' : ''}">${thumb(ctx, it)}</div><b>${esc(it.name)}</b><small>${it.uses ? `Used in ${it.uses} place${it.uses === 1 ? '' : 's'}` : 'Not used'}${it.kind === 'pdf' ? ' · PDF' : ''}${it.uploaded ? '' : ' · Built-in'}${it.hidden ? ' · Hidden' : ''}</small></button>`).join('')}</div>`;
}
function chipsHtml(ctx, active, attr, items) {
  const esc = E(ctx), hasHidden = items.some(i => i.hidden), hasPdf = items.some(i => i.kind === 'pdf');
  return CHIPS.filter(([id]) => (id !== 'hidden' || hasHidden || active === 'hidden') && (id !== 'documents' || hasPdf || active === 'documents'))
    .map(([id, label]) => `<button type="button" class="lay-chip${active === id ? ' active' : ''}" ${attr}="${id}" aria-pressed="${active === id}">${esc(label)}</button>`).join('');
}

export function renderPhotos(ctx, {heading} = {}) {
  const esc = E(ctx), items = libraryItems(ctx), canEdit = editors(ctx.role);
  const upload = canEdit ? `<button class="btn primary" type="button" data-ph-upload data-tour="photos-upload">${ctx.icon ? ctx.icon('upload') : ''} Upload photos</button>` : '';
  const head = heading ?? `<div class="page-heading"><div><span class="eyebrow red">YOUR PHOTO LIBRARY</span><h1>A place for every picture.</h1><p>Upload once, then choose it wherever you need it. JPG, PNG or WebP up to 5 MB, PDF data sheets up to 10 MB.</p></div>${upload}</div>`;
  return `${head}<div class="ph" data-ph-root>
 <div class="toolbar ph-toolbar"><label class="search-box">${ctx.icon ? ctx.icon('search') : ''}<input type="search" data-ph-search aria-label="Find a photo" placeholder="Find a photo by name or alt text…" value="${esc(state.q)}"></label><div class="lay-chips ph-chips" role="group" aria-label="Filter photos" data-tour="photos-filters">${chipsHtml(ctx, state.chip, 'data-ph-chip', items)}</div></div>
 ${heading !== undefined && upload ? `<div class="ph-upload-row">${upload}</div>` : ''}
 ${canEdit ? '<p class="small-note ph-drop-note">Tip: on a computer you can drop several files anywhere on this page.</p>' : ''}
 <ol class="ph-progress" data-ph-progress hidden></ol>
 <div data-ph-grid>${gridHtml(ctx)}</div>
</div>`;
}

const refreshGrid = (ctx, root) => { const g = root.querySelector('[data-ph-grid]'); if (g) g.innerHTML = gridHtml(ctx); const c = root.querySelector('[data-tour="photos-filters"]'); if (c) c.innerHTML = chipsHtml(ctx, state.chip, 'data-ph-chip', libraryItems(ctx)); };
const invalidate = () => { viewMemo = {src: null, doc: null, index: null}; };

function pickFiles({multiple = true, accept = 'image/png,image/jpeg,image/webp,application/pdf'} = {}) {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), {type: 'file', multiple, accept, hidden: true});
    input.addEventListener('change', () => { resolve([...(input.files || [])]); input.remove(); }, {once: true});
    document.body.append(input);
    input.click();
  });
}

// Uploads one after another; onProgress(i, status, message) with status waiting|uploading|done|failed.
export async function uploadFiles(ctx, files, onProgress = () => {}) {
  const results = [];
  files.forEach((f, i) => onProgress(i, 'waiting'));
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress(i, 'uploading');
    try {
      const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (pdf && !ctx.uploadDocument) throw new Error('PDF uploads are added from a product’s data sheet field.');
      if (!pdf && !IMAGE_TYPES.includes(file.type)) throw new Error('Choose a JPG, PNG or WebP picture, or a PDF.');
      const r = await (pdf ? ctx.uploadDocument(file) : ctx.upload(file));
      const item = r?.media;
      if (item && Array.isArray(ctx.media) && !ctx.media.some(m => m.id === item.id)) ctx.media.unshift(item);
      if (item && r.url && ctx.mediaUrls) ctx.mediaUrls[item.id] = r.url;
      results.push({file, ok: true, item});
      onProgress(i, 'done');
    } catch (e) {
      results.push({file, ok: false, error: e?.message || 'Upload failed.'});
      onProgress(i, 'failed', e?.message || 'Upload failed.');
    }
  }
  invalidate();
  return results;
}

function progressUi(ctx, root, files) {
  const esc = E(ctx), list = root.querySelector('[data-ph-progress]');
  if (!list) return () => {};
  list.hidden = false;
  list.innerHTML = files.map((f, i) => `<li data-ph-file="${i}"><span>${esc(f.name)}</span><b>Waiting</b></li>`).join('');
  const words = {waiting: 'Waiting', uploading: 'Uploading…', done: 'Done', failed: 'Failed'};
  return (i, status, message) => {
    const li = list.querySelector(`[data-ph-file="${i}"]`);
    if (!li) return;
    li.className = 'is-' + status;
    li.querySelector('b').textContent = words[status] + (message ? ' · ' + message : '');
  };
}

async function uploadInto(ctx, root, files) {
  if (!files.length) return;
  const results = await uploadFiles(ctx, files, progressUi(ctx, root, files));
  const ok = results.filter(r => r.ok).length, bad = results.length - ok;
  refreshGrid(ctx, root);
  ctx.toast?.(bad ? `${ok} uploaded, ${bad} failed. See the list for details.` : `${ok} file${ok === 1 ? '' : 's'} added to your library.`);
}

export function bindPhotos(ctx, root) {
  bindGlobal(ctx);
  const ph = root?.matches?.('[data-ph-root]') ? root : root?.querySelector?.('[data-ph-root]');
  if (!ph || ph.dataset.bound) return;
  ph.dataset.bound = '1';
  ph.addEventListener('input', e => { if (e.target.matches('[data-ph-search]')) { state.q = e.target.value; refreshGrid(ctx, ph); } });
  ph.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !ph.contains(b)) return;
    if (b.dataset.phChip) { state.chip = b.dataset.phChip; refreshGrid(ctx, ph); return; }
    if (b.dataset.phOpen) openPhotoDetails(ctx, b.dataset.phOpen);
  });
  if (editors(ctx.role)) {
    const host = ph.parentElement || ph;
    host.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); ph.classList.add('is-drop'); } });
    host.addEventListener('dragleave', e => { if (!host.contains(e.relatedTarget)) ph.classList.remove('is-drop'); });
    host.addEventListener('drop', e => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); ph.classList.remove('is-drop'); uploadInto(ctx, ph, [...e.dataTransfer.files]); });
  }
}

// ── details sheet ─────────────────────────────────────────────────────────────────────────────
function usageLines(ctx, ref) {
  const esc = E(ctx), list = findImageUsage(view(ctx).doc, ref);
  if (!list.length) return '<p class="small-note">Not used anywhere in your draft.</p>';
  return `<ul class="ph-usage">${list.slice(0, 40).map(u => `<li><b>${esc(TYPE_LABEL[u.type] || u.type)}</b> ${esc(u.name)}<small>${esc(u.field)}</small></li>`).join('')}${list.length > 40 ? `<li class="small-note">and ${list.length - 40} more</li>` : ''}</ul>`;
}

export function openPhotoDetails(ctx, ref) {
  bindGlobal(ctx);
  const esc = E(ctx), it = libraryItems(ctx).find(x => x.ref === ref);
  if (!it) { ctx.toast?.('This file is no longer in the library.'); return; }
  const canEdit = editors(ctx.role), uses = findImageUsage(view(ctx).doc, ref).length, m = it.media || {};
  const info = it.uploaded ? [m.mime_type === 'application/pdf' ? 'PDF' : (m.mime_type || '').replace('image/', '').toUpperCase(), sizeText(m.size_bytes), it.kind === 'image' && m.width > 1 ? `${m.width} × ${m.height}` : '', m.created_at ? 'Uploaded ' + new Date(m.created_at).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}) : ''].filter(Boolean).join(' · ') : 'Built-in website picture';
  const preview = it.kind === 'pdf' ? `<a class="btn ghost" href="${esc(ctx.imageUrl ? ctx.imageUrl(ref) : '')}" target="_blank" rel="noopener">Open PDF ↗</a>` : `<img class="photo-detail ph-detail-img" src="${esc(ctx.imageUrl ? ctx.imageUrl(ref) : '')}" alt="${esc(it.alt || it.name)}">`;
  const deleteBtn = !it.uploaded ? '' : uses ? `<p class="ph-blocked">Remove from ${uses} place${uses === 1 ? '' : 's'} first, then you can delete it.</p>` : `<button class="btn ghost lay-danger" type="button" data-ph-delete="${esc(it.id)}">Delete file</button>`;
  ctx.modal({
    title: 'Photo details',
    body: `<div class="ph-details" data-tour="photo-details" data-ph-details="${esc(ref)}">
 <h2>${esc(it.name)}</h2>
 <div class="ph-detail-grid"><div class="ph-detail-art">${preview}<p class="small-note">${esc(info)}</p></div>
 <div class="ph-detail-side">
  ${it.uploaded && canEdit ? `<form class="ph-meta" data-ph-meta="${esc(it.id)}"><div class="field"><label for="ph-name">Display name</label><input id="ph-name" name="name" maxlength="120" required value="${esc(m.name || '')}"></div>${it.kind === 'image' ? `<div class="field"><label for="ph-alt">Picture description (alt text)</label><input id="ph-alt" name="alt" maxlength="150" value="${esc(m.alt || '')}" placeholder="For example: Motul 7100 4T 1 litre bottle"><small class="small-note">Used when you choose this photo, unless you write a different one there.</small></div>` : ''}<button class="btn primary" type="submit">Save details</button></form>` : ''}
  <h3 class="ph-sub">Where it is used</h3>${usageLines(ctx, ref)}
  ${canEdit ? `<div class="ph-detail-actions"><button class="btn ghost" type="button" data-ph-replace="${esc(ref)}" data-kind="${it.kind}">Replace file everywhere</button>${it.uploaded ? `<button class="btn ghost" type="button" data-ph-hide="${esc(it.id)}" data-hidden="${it.hidden ? '0' : '1'}">${it.hidden ? 'Show in library' : 'Hide from library'}</button>` : ''}${deleteBtn}</div><p class="ph-message" data-ph-message aria-live="polite"></p>` : ''}
 </div></div></div>`,
  });
}

let globalCtx = null, busy = false;
async function adminCall(ctx, action, args) {
  if (typeof ctx.admin !== 'function') throw new Error('The photo library cannot be changed from here yet.');
  return ctx.admin(action, args);
}
const setMessage = (el, text) => { const p = el?.closest('[data-ph-details]')?.querySelector('[data-ph-message]'); if (p) p.textContent = text; };
const rerenderOpenPage = ctx => { const ph = document.querySelector('[data-ph-root]'); if (ph) refreshGrid(ctx, ph); };

function bindGlobal(ctx) {
  const first = !globalCtx;
  globalCtx = ctx;
  if (!first || typeof document === 'undefined') return;
  document.addEventListener('submit', async e => {
    const form = e.target.closest?.('[data-ph-meta]');
    if (!form) return;
    e.preventDefault();
    const ctx = globalCtx, id = form.dataset.phMeta, f = new FormData(form);
    if (busy) return;
    busy = true;
    try {
      const args = {id, name: String(f.get('name') || '').trim()};
      if (f.has('alt')) args.alt = String(f.get('alt') || '').trim();
      const r = await adminCall(ctx, 'media-update', args);
      const m = mediaList(ctx).find(x => x.id === id);
      if (m) Object.assign(m, r?.media || {name: args.name, alt: args.alt ?? m.alt});
      invalidate();
      form.closest('[data-ph-details]').querySelector('h2').textContent = m?.name || args.name;
      rerenderOpenPage(ctx);
      ctx.toast?.('Photo details saved.');
    } catch (err) { ctx.toast?.(err?.message || 'Unable to save the details.'); }
    finally { busy = false; }
  });
  document.addEventListener('click', async e => {
    const b = e.target.closest?.('[data-ph-upload],[data-ph-replace],[data-ph-hide],[data-ph-delete],[data-ph-confirm-delete]');
    if (!b) return;
    const ctx = globalCtx, d = b.dataset;
    if (busy) return;
    if (d.phUpload !== undefined) {
      const ph = document.querySelector('[data-ph-root]');
      const files = await pickFiles();
      if (ph && files.length) uploadInto(ctx, ph, files);
      return;
    }
    if (d.phReplace) {
      const from = d.phReplace, files = await pickFiles({multiple: false, accept: d.kind === 'pdf' ? 'application/pdf' : 'image/png,image/jpeg,image/webp'});
      if (!files.length) return;
      busy = true;
      try {
        setMessage(b, 'Uploading the new file…');
        const [r] = await uploadFiles(ctx, files);
        if (!r.ok) throw new Error(r.error);
        const to = 'media:' + r.item.id, {next, count} = replaceRefs(ctx.data, from, to);
        if (count) {
          validateContent(structuredClone(next));
          await ctx.save(next, `Replaced a ${d.kind === 'pdf' ? 'data sheet' : 'photo'} in ${count} place${count === 1 ? '' : 's'}`);
        }
        b.closest('dialog')?.close();
        invalidate();
        rerenderOpenPage(ctx);
        if (!count) ctx.toast?.('New file added. The old one was not used anywhere, so nothing else changed.');
      } catch (err) { setMessage(b, err?.message || 'The file could not be replaced.'); ctx.toast?.(err?.message || 'The file could not be replaced.'); }
      finally { busy = false; }
      return;
    }
    if (d.phHide) {
      busy = true;
      try {
        const hidden = d.hidden === '1', r = await adminCall(ctx, 'media-update', {id: d.phHide, hidden});
        const m = mediaList(ctx).find(x => x.id === d.phHide);
        if (m) Object.assign(m, r?.media || {hidden});
        invalidate();
        b.closest('dialog')?.close();
        rerenderOpenPage(ctx);
        ctx.toast?.(hidden ? 'Hidden from the library. It stays wherever it is already used.' : 'Back in the library.');
      } catch (err) { setMessage(b, err?.message); ctx.toast?.(err?.message || 'Unable to change the file.'); }
      finally { busy = false; }
      return;
    }
    if (d.phDelete) {
      const box = b.closest('.ph-detail-actions');
      box.insertAdjacentHTML('beforeend', `<div class="ph-confirm"><p>Delete this file for good? It is not used in your draft. This cannot be undone.</p><button class="btn primary lay-danger-fill" type="button" data-ph-confirm-delete="${escHtml(d.phDelete)}">Yes, delete it</button></div>`);
      b.remove();
      return;
    }
    if (d.phConfirmDelete) {
      busy = true;
      const id = d.phConfirmDelete;
      try {
        await adminCall(ctx, 'media-delete', {id});
        const list = mediaList(ctx), i = list.findIndex(m => m.id === id);
        if (i >= 0) list.splice(i, 1);
        if (ctx.mediaUrls) delete ctx.mediaUrls[id];
        invalidate();
        b.closest('dialog')?.close();
        rerenderOpenPage(ctx);
        ctx.toast?.('File deleted.');
      } catch (err) {
        if (err?.code === 'MEDIA_IN_USE' || /still used/i.test(err?.message || '')) {
          const box = b.closest('.ph-confirm');
          if (box) box.innerHTML = `<p>${escHtml(err.message)}</p><button class="btn ghost" type="button" data-ph-hide="${escHtml(id)}" data-hidden="1">Hide from library instead</button>`;
        } else { setMessage(b, err?.message); ctx.toast?.(err?.message || 'The file could not be deleted.'); }
      } finally { busy = false; }
    }
  });
}

// ── chooser (used by chooseImage) ─────────────────────────────────────────────────────────────
function chooserGrid(ctx, kind) {
  const esc = E(ctx), q = state.chooserQ.trim().toLowerCase();
  const items = libraryItems(ctx).filter(it => (kind === 'any' || it.kind === kind) && matches(it, state.chooserChip, q));
  return items.length ? items.map(it => `<button class="photo-choice${it.kind === 'pdf' ? ' icon' : ''}" type="button" data-ch-pick="${esc(it.ref)}">${thumb(ctx, it)}<span>${esc(it.name)}</span></button>`).join('') : '<p class="small-note">Nothing matches. Try another word, or upload a new file.</p>';
}

export function chooserHtml(ctx, {kind = 'image'} = {}) {
  // Every chooser opens fresh: an old search or chip would otherwise hide most pictures.
  state.chooserQ = ''; state.chooserChip = 'all';
  const esc = E(ctx), items = libraryItems(ctx).filter(it => kind === 'any' || it.kind === kind);
  const chips = chipsHtml(ctx, state.chooserChip, 'data-ch-chip', items).replace(/<button[^>]*data-ch-chip="documents"[^>]*>.*?<\/button>/, kind === 'image' ? '' : '$&').replace(/<button[^>]*data-ch-chip="hidden"[^>]*>.*?<\/button>/, '');
  return `<div class="ph-chooser" data-ch-root data-kind="${esc(kind)}">
 <div class="ph-chooser-top"><label class="search-box" data-tour="chooser-search">${ctx.icon ? ctx.icon('search') : ''}<input type="search" data-ch-search aria-label="Find a picture" placeholder="Find by name or alt text…" value="${esc(state.chooserQ)}"></label>${editors(ctx.role) ? `<button class="btn primary" type="button" data-ch-upload>${ctx.icon ? ctx.icon('upload') : ''} Upload new</button>` : ''}</div>
 <div class="lay-chips ph-chips">${chips}</div>
 <p class="small-note" data-ch-status aria-live="polite"></p>
 <div class="photo-choices" data-ch-grid>${chooserGrid(ctx, kind)}</div>
</div>`;
}

export function bindChooser(ctx, root, onPick, {kind} = {}) {
  const ch = root?.matches?.('[data-ch-root]') ? root : root?.querySelector?.('[data-ch-root]');
  if (!ch || ch.dataset.bound) return;
  ch.dataset.bound = '1';
  const k = kind || ch.dataset.kind || 'image';
  const refresh = () => { ch.querySelector('[data-ch-grid]').innerHTML = chooserGrid(ctx, k); };
  ch.addEventListener('input', e => { if (e.target.matches('[data-ch-search]')) { state.chooserQ = e.target.value; refresh(); } });
  ch.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b || !ch.contains(b)) return;
    if (b.dataset.chChip) { state.chooserChip = b.dataset.chChip; ch.querySelectorAll('[data-ch-chip]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); refresh(); return; }
    if (b.dataset.chPick) { const it = libraryItems(ctx).find(x => x.ref === b.dataset.chPick); onPick?.(b.dataset.chPick, it); return; }
    if (b.matches('[data-ch-upload]')) {
      const files = await pickFiles({multiple: false, accept: k === 'pdf' ? 'application/pdf' : k === 'any' ? 'image/png,image/jpeg,image/webp,application/pdf' : 'image/png,image/jpeg,image/webp'});
      if (!files.length) return;
      const status = ch.querySelector('[data-ch-status]');
      status.textContent = 'Uploading ' + files[0].name + '…';
      b.disabled = true;
      const [r] = await uploadFiles(ctx, files);
      b.disabled = false;
      if (!r.ok) { status.textContent = r.error; return; }
      status.textContent = '';
      refresh();
      onPick?.('media:' + r.item.id, libraryItems(ctx).find(x => x.ref === 'media:' + r.item.id));
    }
  });
}
