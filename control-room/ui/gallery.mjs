// Product gallery strip (replaces the 4 fixed photo slots). "+ Add photos" takes many files at once
// (and drag-and-drop on desktop) and uploads them one after another with progress. Tiles drag to
// reorder and offer Make main (swaps with product.image), Alt text and Remove; "3 of 12" counter.
// The strip edits the record object it is given (editorState.record); saveEditor saves it.
//
// API:
//   GALLERY_MAX = 12
//   normaliseGallery(list)                → [{ref, alt?}] (legacy strings become {ref}; empties dropped)
//   moveGalleryItem(product, from, to)    → product (mutated)
//   removeGalleryItem(product, index)     → product
//   makeMain(product, index)              → product (gallery[index] ⇄ product.image; alt kept with the photo)
//   addGalleryRefs(product, refs, max, altOf?) → {added, skipped} (altOf(ref): the library's default alt)
//   renderGallery(ctx, product, {max})    → html (section[data-gallery])
//   bindGallery(ctx, root, product, {max, onChange}) → {refresh(), destroy()}
import {escOf} from './confirm.mjs';
import {makeSortable} from './sortable.mjs';
import {refOf} from './brand-picker.mjs';
import {mediaAlt} from './photos.mjs';

export const GALLERY_MAX = 12;

export function normaliseGallery(list) {
  return (Array.isArray(list) ? list : []).map(x => (typeof x === 'string' ? {ref: x} : x && typeof x === 'object' ? {...x} : null))
    .filter(x => x && typeof x.ref === 'string' && x.ref)
    .map(x => { const o = {ref: x.ref}; if (typeof x.alt === 'string' && x.alt.trim()) o.alt = x.alt.trim().slice(0, 150); return o; });
}
const ready = p => { p.gallery = normaliseGallery(p.gallery); return p.gallery; };

export function moveGalleryItem(product, from, to) {
  const g = ready(product);
  if (from < 0 || from >= g.length) return product;
  const [x] = g.splice(from, 1);
  g.splice(Math.max(0, Math.min(g.length, to)), 0, x);
  return product;
}
export function removeGalleryItem(product, index) { ready(product).splice(index, 1); return product; }
export function makeMain(product, index) {
  const g = ready(product);
  const item = g[index];
  if (!item) return product;
  const oldMain = product.image;
  product.image = item.ref;
  if (oldMain) g[index] = {ref: oldMain}; else g.splice(index, 1);
  return product;
}
export function addGalleryRefs(product, refs, max = GALLERY_MAX, altOf = null) {
  const g = ready(product);
  let added = 0, skipped = 0;
  for (const ref of refs) {
    if (!ref) continue;
    if (g.length >= max) { skipped++; continue; }
    const alt = typeof altOf === 'function' ? String(altOf(ref) || '').trim().slice(0, 150) : '';
    g.push(alt ? {ref, alt} : {ref}); added++;
  }
  return {added, skipped};
}

function tilesHtml(ctx, product, max) {
  const esc = escOf(ctx);
  const g = normaliseGallery(product.gallery);
  return g.map((x, i) => `<li class="gallery__tile" data-sort-id="${i}" data-g-index="${i}">
<img src="${esc(ctx.imageUrl?.(x.ref) || '')}" alt="${esc(x.alt || '')}" draggable="false">
<span class="gallery__num">${i + 2}</span>${x.alt ? '<span class="gallery__alt-flag" title="Has alt text">ALT</span>' : ''}
<button type="button" class="drag-handle gallery__handle" data-drag-handle aria-label="Drag photo ${i + 2}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke="currentColor" stroke-width="3" stroke-linecap="square"/></svg></button>
<div class="gallery__actions"><button type="button" data-g-main>Make main</button><button type="button" data-g-alt aria-expanded="false">Alt text</button><button type="button" class="danger-text" data-g-remove aria-label="Remove photo ${i + 2}">Remove</button></div>
</li>`).join('') + (g.length < max ? `<li class="gallery__add" data-tour="gallery-add"><label class="gallery__add-btn"><input type="file" accept="image/png,image/jpeg,image/webp" multiple data-g-files hidden><span aria-hidden="true">+</span><b>Add photos</b><small>Several at once</small></label><button type="button" class="text-link" data-g-library>or choose from library</button></li>` : '');
}

export function renderGallery(ctx, product, {max = GALLERY_MAX} = {}) {
  const esc = escOf(ctx);
  const n = normaliseGallery(product?.gallery).length;
  return `<section class="gallery" data-gallery aria-label="Extra product photos">
<div class="gallery__head"><h3>Extra product photos</h3><span class="gallery__count" data-g-count>${n} of ${max}</span></div>
<div class="gallery__main"><img src="${esc(ctx.imageUrl?.(product?.image) || '')}" alt="" data-g-mainimg><span>Main photo</span></div>
<ol class="gallery__tiles" data-g-tiles>${tilesHtml(ctx, product || {}, max)}</ol>
<div class="gallery__alt" data-g-altbox hidden></div>
<ul class="gallery__progress" data-g-progress aria-live="polite" hidden></ul>
<p class="gallery__hint">Drag to reorder. Tap “Make main” to use a photo as the main picture. Drop photos here on a computer.</p>
</section>`;
}

export function bindGallery(ctx, root, product, {max = GALLERY_MAX, onChange} = {}) {
  const box = root.matches?.('[data-gallery]') ? root : root.querySelector('[data-gallery]');
  if (!box || !product) return null;
  const esc = escOf(ctx);
  ready(product);
  const tiles = box.querySelector('[data-g-tiles]');
  const progress = box.querySelector('[data-g-progress]');
  const altBox = box.querySelector('[data-g-altbox]');
  let altIndex = -1;

  const refresh = () => {
    tiles.innerHTML = tilesHtml(ctx, product, max);
    box.querySelector('[data-g-count]').textContent = `${product.gallery.length} of ${max}`;
    const main = box.querySelector('[data-g-mainimg]');
    main.src = ctx.imageUrl?.(product.image) || '';
    // The editor's own main-photo preview, when there is one.
    document.querySelectorAll('[data-picture="image"]').forEach(img => { img.src = ctx.imageUrl?.(product.image) || ''; });
    onChange?.(product);
  };
  const closeAlt = () => { altIndex = -1; altBox.hidden = true; altBox.innerHTML = ''; tiles.querySelectorAll('[data-g-alt]').forEach(b => b.setAttribute('aria-expanded', 'false')); };
  const openAlt = i => {
    altIndex = i;
    const item = product.gallery[i];
    altBox.innerHTML = `<label for="g-alt-input">Alt text for photo ${i + 2} <small>(what the photo shows, for search engines and screen readers)</small></label><input id="g-alt-input" type="text" maxlength="150" value="${esc(item.alt || '')}" placeholder="${esc(mediaAlt(ctx, item.ref) || 'For example: Motul 7100 1 litre bottle, front')}"><div class="gallery__alt-actions"><button type="button" class="btn ghost tiny" data-g-alt-cancel>Cancel</button><button type="button" class="btn primary tiny" data-g-alt-save>Use this text</button></div>`;
    altBox.hidden = false;
    tiles.querySelector(`[data-g-index="${i}"] [data-g-alt]`)?.setAttribute('aria-expanded', 'true');
    altBox.querySelector('input').focus();
  };
  const saveAlt = () => {
    const item = product.gallery[altIndex];
    if (!item) return closeAlt();
    const v = altBox.querySelector('input').value.trim().slice(0, 150);
    if (v) item.alt = v; else delete item.alt;
    closeAlt(); refresh();
  };

  const uploadFiles = async files => {
    const images = [...files].filter(f => /^image\/(png|jpeg|webp)$/.test(f.type));
    const rejected = files.length - images.length;
    const room = max - product.gallery.length;
    const take = images.slice(0, Math.max(0, room));
    progress.hidden = false;
    progress.innerHTML = '';
    if (rejected) progress.insertAdjacentHTML('beforeend', `<li class="is-error">${rejected} file${rejected === 1 ? ' is' : 's are'} not a JPG, PNG or WebP picture and ${rejected === 1 ? 'was' : 'were'} skipped.</li>`);
    if (images.length > take.length) progress.insertAdjacentHTML('beforeend', `<li class="is-error">Only ${max} photos fit. ${images.length - take.length} ${images.length - take.length === 1 ? 'was' : 'were'} skipped.</li>`);
    if (!take.length) return;
    if (!ctx.upload) { progress.insertAdjacentHTML('beforeend', '<li class="is-error">Uploading is not available here.</li>'); return; }
    const rows = take.map(f => { const li = document.createElement('li'); li.innerHTML = `<span>${esc(f.name)}</span><b>Waiting…</b>`; progress.appendChild(li); return li; });
    let ok = 0;
    for (let i = 0; i < take.length; i++) {
      const li = rows[i];
      li.querySelector('b').textContent = `Uploading ${i + 1} of ${take.length}…`;
      li.classList.add('is-busy');
      try {
        const ref = refOf(await ctx.upload(take[i]));
        if (!ref) throw new Error('Upload failed.');
        const {added} = addGalleryRefs(product, [ref], max, r => mediaAlt(ctx, r));
        if (!added) throw new Error(`Only ${max} photos fit.`);
        ok++;
        li.className = 'is-done'; li.querySelector('b').textContent = 'Added';
        refresh();
      } catch (err) {
        li.className = 'is-error'; li.querySelector('b').textContent = err?.message || 'Upload failed.';
      }
    }
    if (ok) ctx.toast?.(`${ok} photo${ok === 1 ? '' : 's'} added. Save this draft to keep ${ok === 1 ? 'it' : 'them'}.`);
  };

  const onClick = e => {
    const t = e.target;
    if (t.closest('[data-g-alt-save]')) { saveAlt(); return; }
    if (t.closest('[data-g-alt-cancel]')) { closeAlt(); return; }
    if (t.closest('[data-g-library]')) {
      ctx.chooseImage?.(ref => { if (!ref) return; const {skipped} = addGalleryRefs(product, [ref], max, r => mediaAlt(ctx, r)); if (skipped) ctx.toast?.(`Only ${max} photos fit.`); refresh(); }, {key: 'gallery'});
      return;
    }
    const tile = t.closest('[data-g-index]');
    if (!tile) return;
    const i = Number(tile.dataset.gIndex);
    if (t.closest('[data-g-main]')) { closeAlt(); makeMain(product, i); refresh(); ctx.toast?.('Main photo changed. Save to keep it.'); }
    else if (t.closest('[data-g-remove]')) { closeAlt(); removeGalleryItem(product, i); refresh(); }
    else if (t.closest('[data-g-alt]')) { if (altIndex === i) closeAlt(); else openAlt(i); }
  };
  const onChangeEv = e => { if (e.target.matches('[data-g-files]')) { const files = [...(e.target.files || [])]; e.target.value = ''; uploadFiles(files); } };
  const onKey = e => {
    if (!altBox.contains(e.target)) return;
    if (e.key === 'Enter') { e.preventDefault(); saveAlt(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAlt(); }
  };
  const onDragOver = e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); box.classList.add('is-drop'); } };
  const onDragLeave = e => { if (!box.contains(e.relatedTarget)) box.classList.remove('is-drop'); };
  const onDrop = e => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); box.classList.remove('is-drop'); uploadFiles([...e.dataTransfer.files]); };
  box.addEventListener('click', onClick);
  box.addEventListener('change', onChangeEv);
  box.addEventListener('keydown', onKey);
  box.addEventListener('dragover', onDragOver);
  box.addEventListener('dragleave', onDragLeave);
  box.addEventListener('drop', onDrop);
  const sortable = makeSortable(tiles, {item: '[data-g-index]', grid: true, onDrop: (ids, {from, to}) => { closeAlt(); moveGalleryItem(product, from, to); refresh(); }});
  return {
    refresh,
    destroy() { sortable.destroy(); box.removeEventListener('click', onClick); box.removeEventListener('change', onChangeEv); box.removeEventListener('keydown', onKey); box.removeEventListener('dragover', onDragOver); box.removeEventListener('dragleave', onDragLeave); box.removeEventListener('drop', onDrop); },
  };
}
