// Brand picker: a searchable combobox over data.brands (with logos) plus "+ New brand" (name, logo,
// group), staged in the editor's `pending` like the other quick-create records. The product keeps the
// brand as text (legacy free text still works); when the text matches no brand the hint says
// "Not linked to a logo · Link", and Link opens the new-brand card prefilled.
//
// API:
//   renderBrandPicker(ctx, value, {name='brand', label='Brand', pending, tour='field-brand'}) → html
//   bindBrandPicker(ctx, root, {pending, onChange}) → {destroy()}   (wires every [data-brand-picker])
//   matchBrands(brands, query, limit=8)            → brands whose name contains query (starts-with first)
//   linkedBrand(brands, value)                      → the brand whose name equals value (case-insensitive) or null
import {escOf} from './confirm.mjs';
import {stageRecord} from './quick-create.mjs';

const key = v => String(v ?? '').trim().toLowerCase();
const objs = list => (Array.isArray(list) ? list.filter(x => x && typeof x === 'object') : []);
let seq = 0;

export function matchBrands(brands, query, limit = 8) {
  const q = key(query);
  const list = objs(brands);
  if (!q) return list.slice(0, limit);
  const starts = [], has = [];
  for (const b of list) { const n = key(b.name); if (n.startsWith(q)) starts.push(b); else if (n.includes(q)) has.push(b); }
  return [...starts, ...has].slice(0, limit);
}
export const linkedBrand = (brands, value) => (key(value) ? objs(brands).find(b => key(b.name) === key(value)) || null : null);

const allBrands = (ctx, pending) => [...objs(ctx.data?.brands), ...(pending?.brands || [])];

function statusHtml(ctx, value, pending) {
  const esc = escOf(ctx);
  if (!key(value)) return '<span class="brand-picker__muted">No brand</span>';
  const b = linkedBrand(allBrands(ctx, pending), value);
  if (b) return `${b.image ? `<img src="${esc(ctx.imageUrl?.(b.image) || '')}" alt="">` : ''}<span>Linked to the ${esc(b.name)} logo${(pending?.brands || []).includes(b) ? ' (new)' : ''}</span>`;
  return `<span class="brand-picker__warn">Not linked to a logo</span> · <button type="button" class="text-link" data-bp-link>Link</button>`;
}

export function renderBrandPicker(ctx, value = '', {name = 'brand', label = 'Brand', pending, tour = 'field-brand'} = {}) {
  const esc = escOf(ctx);
  const id = 'field-' + name, lb = id + '-list';
  return `<div class="field brand-picker" data-brand-picker ${tour ? `data-tour="${esc(tour)}"` : ''}>
<label for="${esc(id)}">${esc(label)}</label>
<div class="brand-picker__box"><input id="${esc(id)}" name="${esc(name)}" type="text" value="${esc(value)}" maxlength="100" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${esc(lb)}" placeholder="Type to find a brand…">
<ul class="brand-picker__list" id="${esc(lb)}" role="listbox" aria-label="Brands" hidden></ul></div>
<p class="brand-picker__status" data-bp-status aria-live="polite">${statusHtml(ctx, value, pending)}</p>
<div data-bp-card></div></div>`;
}

export function bindBrandPicker(ctx, root, {pending, onChange} = {}) {
  const esc = escOf(ctx);
  const offs = [];
  for (const box of root.querySelectorAll('[data-brand-picker]')) {
    if (box._bp) continue;
    const input = box.querySelector('input[role="combobox"]');
    const list = box.querySelector('[role="listbox"]');
    const status = box.querySelector('[data-bp-status]');
    const cardHost = box.querySelector('[data-bp-card]');
    let items = [], active = -1;
    const uid = 'bp' + (++seq);

    const setStatus = () => { status.innerHTML = statusHtml(ctx, input.value, pending); };
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
    const highlight = i => {
      active = i;
      list.querySelectorAll('[role="option"]').forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
      const li = list.querySelector(`#${uid}-${i}`);
      if (li) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({block: 'nearest'}); } else input.removeAttribute('aria-activedescendant');
    };
    const open = () => {
      const q = input.value.trim();
      const brands = allBrands(ctx, pending);
      const found = matchBrands(brands, q, 8);
      const exact = linkedBrand(brands, q);
      items = found.map(b => ({type: 'brand', brand: b}));
      if (!exact) items.push({type: 'new', name: q});
      list.innerHTML = items.map((it, i) => it.type === 'brand'
        ? `<li id="${uid}-${i}" role="option" aria-selected="false" data-i="${i}">${it.brand.image ? `<img src="${esc(ctx.imageUrl?.(it.brand.image) || '')}" alt="">` : '<span class="brand-picker__dot"></span>'}<span>${esc(it.brand.name)}</span></li>`
        : `<li id="${uid}-${i}" role="option" aria-selected="false" data-i="${i}" class="brand-picker__new">+ New brand${it.name ? ` “${esc(it.name)}”` : ''}…</li>`).join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      highlight(-1);
    };
    const choose = i => {
      const it = items[i];
      if (!it) return;
      if (it.type === 'brand') { input.value = it.brand.name; close(); setStatus(); onChange?.(input.value); }
      else { close(); openCard(it.name); }
    };
    const openCard = prefill => {
      if (cardHost.firstElementChild) { cardHost.querySelector('[data-bp-name]').focus(); return; }
      const groups = [...objs(ctx.data?.brandGroups), ...(pending?.brandGroups || [])];
      let image = '';
      cardHost.innerHTML = `<div class="quick-card" role="group" aria-label="New brand">
<label class="quick-card__label" for="${uid}-name">New brand name</label><input id="${uid}-name" data-bp-name type="text" maxlength="100" value="${esc(prefill || '')}" autocomplete="off">
<label class="quick-card__sub" for="${uid}-group">Brand group</label><select id="${uid}-group" data-bp-group><option value="">No group</option>${groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select>
<div class="quick-card__logo"><span class="quick-card__thumb" data-bp-thumb aria-hidden="true">Logo</span><button type="button" class="btn ghost tiny" data-bp-choose>Choose logo</button><label class="btn ghost tiny quick-card__upload">Upload<input type="file" accept="image/png,image/jpeg,image/webp" data-bp-upload hidden></label></div>
<p class="quick-card__error" role="alert" hidden></p>
<div class="quick-card__actions"><button type="button" class="btn ghost tiny" data-bp-cancel>Cancel</button><button type="button" class="btn primary tiny" data-bp-add>Add brand</button></div>
<p class="quick-card__hint">Saved together with this form. No logo yet? A plain icon is used until you add one.</p></div>`;
      const card = cardHost.firstElementChild;
      const err = card.querySelector('.quick-card__error');
      const thumb = card.querySelector('[data-bp-thumb]');
      const setImage = ref => { image = ref || ''; thumb.innerHTML = image ? `<img src="${esc(ctx.imageUrl?.(image) || '')}" alt="">` : 'Logo'; };
      const add = () => {
        try {
          const rec = stageRecord(ctx.data, pending, 'brand', {name: card.querySelector('[data-bp-name]').value, group: card.querySelector('[data-bp-group]').value, image});
          input.value = rec.name;
          cardHost.innerHTML = '';
          setStatus();
          onChange?.(input.value);
          ctx.toast?.(`Brand “${rec.name}” added. It is saved with this form.`);
          input.focus();
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      };
      card.addEventListener('click', async e => {
        if (e.target.closest('[data-bp-add]')) add();
        else if (e.target.closest('[data-bp-cancel]')) { cardHost.innerHTML = ''; input.focus(); }
        else if (e.target.closest('[data-bp-choose]')) ctx.chooseImage?.(ref => setImage(ref), {key: 'brand-logo'});
      });
      card.addEventListener('change', async e => {
        if (!e.target.matches('[data-bp-upload]')) return;
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !ctx.upload) return;
        thumb.textContent = '…';
        try { setImage(refOf(await ctx.upload(file))); } catch (x) { setImage(image); err.textContent = x?.message || 'Upload failed.'; err.hidden = false; }
      });
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.matches('input[type="text"]')) { e.preventDefault(); add(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cardHost.innerHTML = ''; input.focus(); }
      });
      card.querySelector('[data-bp-name]').focus();
    };

    const onInput = () => { open(); setStatus(); };
    const onKey = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); highlight(Math.min(items.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(0, active - 1)); }
      else if (e.key === 'Enter') { if (!list.hidden) { e.preventDefault(); if (active >= 0) choose(active); else close(); } }
      else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); e.stopPropagation(); close(); } }
    };
    const onListDown = e => { const li = e.target.closest('[role="option"]'); if (li) { e.preventDefault(); choose(Number(li.dataset.i)); } };
    const onFocus = () => open();
    const onBlur = () => setTimeout(() => { if (!box.contains(document.activeElement)) close(); }, 120);
    const onBoxClick = e => { if (e.target.closest('[data-bp-link]')) openCard(input.value.trim()); };
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    input.addEventListener('focus', onFocus);
    input.addEventListener('blur', onBlur);
    list.addEventListener('pointerdown', onListDown);
    box.addEventListener('click', onBoxClick);
    box._bp = true;
    offs.push(() => { input.removeEventListener('input', onInput); input.removeEventListener('keydown', onKey); input.removeEventListener('focus', onFocus); input.removeEventListener('blur', onBlur); list.removeEventListener('pointerdown', onListDown); box.removeEventListener('click', onBoxClick); box._bp = false; });
  }
  return {destroy() { offs.forEach(f => f()); }};
}

// ctx.upload may return a ref string, {ref}, or the register-media answer {media:{id}}.
export function refOf(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (result.ref) return result.ref;
  if (result.media?.id) return 'media:' + result.media.id;
  if (result.id) return 'media:' + result.id;
  return '';
}
