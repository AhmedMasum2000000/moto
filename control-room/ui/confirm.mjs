// Mascot dialogs for the control room: delete (with usage list and reassign), discard changes,
// plain confirm, and the duplicate flow. Each dialog is its own <dialog> (top layer), so it can sit
// above the editor sheet without replacing the shared #modal. After opening, it dispatches
// `moto:dialog-open` on document so the toast / tour popovers can re-show themselves on top.
//
// API (ctx is the shared control-room context, plan 2.7):
//   mascotHtml(ctx, size)                         → <img> html for the guide mascot (32 | 56 | 96)
//   openDialog(ctx, {kicker, title, body, actions, mascot, className, onOpen}) → {el, done, close}
//   confirmDialog(ctx, {title, message, confirmLabel, danger, kicker})       → Promise<boolean>
//   confirmDiscard(ctx)                                                      → Promise<boolean>
//   deleteFlow(ctx, type, id, {name})          → Promise<{next, summary} | null> (saves once)
//   duplicateFlow(ctx, type, id, {open=true})  → Promise<{next, copy} | null> (saves once, opens copy)
//   checkDocument(ctx, next)                   → throws the schema's message when next is invalid
//   reassignOptions(doc, type, id)             → {required, label, options:[[value, title]]} | null
import {references, parseSubRef} from '../../cms/content-model.mjs';
import {deleteRecord, duplicateRecord, getRecord, canDelete, canDuplicate, nameOf, COLLECTIONS} from '../lib/records.mjs';
import {validateContent} from '../../supabase/functions/moto-admin/schema.mjs';

// Client-side check before every save (the server re-validates). ctx.validate wins when given.
export function checkDocument(ctx, next) {
  if (typeof ctx?.validate === 'function') return ctx.validate(next);
  validateContent(structuredClone(next));
}

const ESC = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const escOf = ctx => (typeof ctx?.esc === 'function' ? ctx.esc : ESC);
export const MASCOT_SRC = 'assets/mascot/guide.webp';

export function mascotHtml(ctx, size = 56) {
  const src = ctx?.mascotSrc || MASCOT_SRC;
  return `<img class="mascot mascot--${size === 32 || size === 96 ? size : 56}" src="${ESC(src)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.hidden=true">`;
}

let dialogSeq = 0;
// A modal <dialog> appended to <body>. actions: [{label, value, kind:'primary'|'danger'|'ghost', attrs}]
// done resolves with the clicked action's value, or null on Esc / backdrop / close.
export function openDialog(ctx, {kicker = '', title = '', body = '', actions = [], mascot = true, className = '', onOpen, onAction} = {}) {
  const esc = escOf(ctx);
  const el = document.createElement('dialog');
  const id = 'cr-dialog-' + (++dialogSeq);
  el.className = ('cr-dialog ' + className).trim();
  el.setAttribute('aria-labelledby', id + '-title');
  el.innerHTML = `<div class="cr-dialog__head">${mascot ? mascotHtml(ctx, 56) : ''}<div>${kicker ? `<span class="eyebrow red">${esc(kicker)}</span>` : ''}<h2 id="${id}-title">${esc(title)}</h2></div><button type="button" class="icon-button cr-dialog__x" data-dialog-value="" aria-label="Close">✕</button></div>
<div class="cr-dialog__body">${body}</div>
<p class="cr-dialog__error" role="alert" hidden></p>
<div class="cr-dialog__actions">${actions.map((a, i) => `<button type="button" class="btn ${a.kind === 'danger' ? 'danger' : a.kind === 'primary' ? 'primary' : 'ghost'}" data-dialog-action="${i}" ${a.attrs || ''}>${esc(a.label)}</button>`).join('')}</div>`;
  document.body.appendChild(el);
  let settle;
  const done = new Promise(r => { settle = r; });
  let finished = false;
  const close = value => {
    if (finished) return;
    finished = true;
    try { el.close(); } catch { /* already closed */ }
    el.remove();
    settle(value === undefined ? null : value);
  };
  const setError = msg => { const e = el.querySelector('.cr-dialog__error'); e.textContent = msg || ''; e.hidden = !msg; };
  const setBusy = on => el.querySelectorAll('.cr-dialog__actions button').forEach(b => { b.disabled = on; });
  el.addEventListener('cancel', e => { e.preventDefault(); close(null); });
  el.addEventListener('click', async e => {
    if (e.target === el) { close(null); return; } // backdrop
    if (e.target.closest('.cr-dialog__x')) { close(null); return; }
    const b = e.target.closest('[data-dialog-action]');
    if (!b) return;
    const action = actions[Number(b.dataset.dialogAction)];
    if (!action) return;
    if (onAction) {
      setError('');
      setBusy(true);
      try {
        const out = await onAction(action.value, {el, setError});
        if (out !== false) close(out === undefined ? action.value : out);
      } catch (err) {
        setError(err?.detail || err?.message || 'Something went wrong. Please try again.');
      } finally { if (!finished) setBusy(false); }
    } else close(action.value);
  });
  try { el.showModal(); } catch { el.setAttribute('open', ''); }
  document.dispatchEvent(new CustomEvent('moto:dialog-open', {detail: {dialog: el}}));
  onOpen?.(el);
  const focus = el.querySelector('[autofocus]') || el.querySelector('.cr-dialog__actions .btn.ghost') || el.querySelector('.cr-dialog__actions .btn');
  focus?.focus();
  return {el, done, close, setError};
}

export function confirmDialog(ctx, {kicker = 'PLEASE CONFIRM', title = 'Are you sure?', message = '', confirmLabel = 'Yes', cancelLabel = 'Cancel', danger = false} = {}) {
  const esc = escOf(ctx);
  const d = openDialog(ctx, {kicker, title, body: message ? `<p>${esc(message)}</p>` : '', actions: [{label: cancelLabel, value: false, kind: 'ghost'}, {label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary'}]});
  return d.done.then(v => v === true);
}

// "Discard your changes?" for the editor's unsaved-changes guard.
export function confirmDiscard(ctx) {
  return confirmDialog(ctx, {kicker: 'UNSAVED CHANGES', title: 'Discard your changes?', message: 'You changed this form but did not save it. If you leave now, those changes are lost.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true});
}

const TYPE_LABEL = {product: 'Product', category: 'Category', subcategory: 'Subcategory', brand: 'Brand', brandGroup: 'Brand group', kit: 'Bundle', vehicle: 'Bike or car', banner: 'Banner', block: 'Card', menu: 'Menu link', page: 'Page', post: 'Post', service: 'Service', section: 'Section', content: 'Page section', layout: 'Layout'};

// What the user can move dependants to before a delete. null when nothing needs a new home.
export function reassignOptions(doc, type, id) {
  const refs = references(doc, type, id);
  const products = refs.filter(r => r.type === 'product').length;
  if (type === 'category') {
    if (!products) return null;
    return {required: true, count: products, label: `This category has ${products} product${products === 1 ? '' : 's'}. Move them to:`, options: (doc.categories || []).filter(c => c.id !== id).map(c => [c.id, c.name])};
  }
  if (type === 'subcategory') {
    if (!products) return null;
    const {category, sub} = parseSubRef(id);
    const cat = (doc.categories || []).find(c => c.id === category);
    return {required: false, count: products, label: `This subcategory has ${products} product${products === 1 ? '' : 's'}. Move them to:`, options: [['', 'No subcategory (keep them in ' + (cat?.name || 'the category') + ')'], ...(cat?.children || []).filter(c => c && typeof c === 'object' && c.id !== sub).map(c => [c.id, c.name])]};
  }
  if (type === 'brand') {
    if (!products) return null;
    return {required: false, count: products, label: `${products} product${products === 1 ? ' uses' : 's use'} this brand. Give them:`, options: [['', 'No brand (clear it)'], ...(doc.brands || []).filter(b => b.id !== id).map(b => [b.id, b.name])]};
  }
  if (type === 'brandGroup') {
    const brands = refs.filter(r => r.type === 'brand').length;
    if (!brands) return null;
    return {required: false, count: brands, label: `${brands} brand${brands === 1 ? ' is' : 's are'} in this group. Move them to:`, options: [...(doc.brandGroups || []).filter(g => g.id !== id).map(g => [g.id, g.name]), ['', 'No group']]};
  }
  return null;
}

// How one reference is affected, worded by the pair (deleted type, referencing type), so a record
// that is kept is never shown as "is removed".
function refEffect(doc, type, id, r) {
  if (type === 'vehicle' && r.type === 'product') {
    const p = (doc.products || []).find(p => p.id === r.id);
    const only = p && (p.vehicleIds || []).length === 1 && p.fitment === 'Selected vehicles';
    return only ? 'loses this model and becomes \u201cAsk us to confirm\u201d' : 'loses this model';
  }
  if (type === 'product') {
    if (r.type === 'kit') {
      const k = (doc.kits || []).find(k => k.id === r.id);
      return (k?.productIds || []).length <= 1 ? 'drops this product and is hidden (no products left)' : 'drops this product';
    }
    if (r.type === 'section' || r.type === 'content') return 'drops this product';
  }
  if (type === 'kit' && r.type === 'section') return 'drops this bundle';
  if (r.type === 'subcategory') return 'is removed';
  if (r.type === 'block' && r.field === 'subcategories') return 'drops this subcategory';
  if (r.type === 'menu') return 'link is removed';
  if (r.type === 'banner') return 'is hidden (its link pointed here)';
  if (r.type === 'brandGroup' && r.field === 'shopTarget') return 'shop button is cleared';
  if (r.type === 'section' && r.field === 'button.target') return 'button is removed';
  if (r.type === 'content') return 'goes back to its default products';
  if (r.type === 'block') return 'card is removed';
  if (r.type === 'section') return 'is removed';
  return {reassign: 'moves', block: 'moves', clear: 'is cleared', remove: 'is removed'}[r.fix] || 'changes';
}

// The collapsed line for the records that follow the reassign select ("28 products move to …").
const DEP_TYPE = {category: 'product', subcategory: 'product', brand: 'product', brandGroup: 'brand'};
function dependantLine(doc, type, id, count, value, reassign) {
  const plural = DEP_TYPE[type] === 'brand' ? (count === 1 ? 'brand' : 'brands') : (count === 1 ? 'product' : 'products');
  const n = `${count} ${plural}`;
  const verb = count === 1 ? 'moves' : 'move';
  const title = value ? (reassign?.options || []).find(([v]) => v === value)?.[1] : '';
  if (type === 'category') return value ? `${n} ${verb} to ${title}` : `${n} ${verb} to the category you choose below`;
  if (type === 'subcategory') {
    const cat = (doc.categories || []).find(c => c.id === parseSubRef(id).category);
    return value ? `${n} ${verb} to ${title}` : `${n} ${count === 1 ? 'stays' : 'stay'} in ${cat?.name || 'the category'} without a subcategory`;
  }
  if (type === 'brand') return value ? `${n} ${verb} to the brand ${title}` : `${n} ${count === 1 ? 'loses its' : 'lose their'} brand`;
  if (type === 'brandGroup') return value ? `${n} ${verb} to ${title}` : `${n} ${count === 1 ? 'leaves' : 'leave'} the group`;
  return `${n} change`;
}

// Website changes first (menu links, cards, banners, sections), always in full; the products or
// brands that follow the reassign select collapse into one line that tracks the select.
function usageList(esc, doc, type, id, refs, reassign) {
  if (!refs.length) return '<p class="cr-usage__none">Nothing else on the website uses it.</p>';
  const depType = reassign ? DEP_TYPE[type] : null;
  const deps = depType ? refs.filter(r => r.type === depType) : [];
  const others = refs.filter(r => !deps.includes(r));
  const max = 8;
  const otherRows = others.slice(0, deps.length ? others.length : max).map(r => `<li><b>${esc(TYPE_LABEL[r.type] || r.type)}</b> ${esc(r.name || r.id)} <small>· ${esc(refEffect(doc, type, id, r))}</small></li>`).join('');
  const more = !deps.length && others.length > max ? `<li class="cr-usage__more">and ${others.length - max} more</li>` : '';
  const depRow = deps.length ? `<li class="cr-usage__deps"><b>${esc(TYPE_LABEL[depType])}s</b> <span data-cr-deps>${esc(dependantLine(doc, type, id, deps.length, '', reassign))}</span></li>` : '';
  return `<p class="cr-usage__lead">It is used in ${refs.length} place${refs.length === 1 ? '' : 's'}:</p><ul class="cr-usage">${otherRows}${more}${depRow}</ul>`;
}

// Delete with usage list and (where needed) a reassign select. One save; returns the result or null.
export async function deleteFlow(ctx, type, id, {name} = {}) {
  const esc = escOf(ctx);
  const doc = ctx.data;
  const record = getRecord(doc, type, id);
  if (!record) { ctx.toast?.('This item could not be found. It may already be deleted.'); return null; }
  if (!canDelete(type, ctx.role, record)) { ctx.toast?.('Your account cannot delete this. Ask the store owner.'); return null; }
  const label = COLLECTIONS[type]?.label || 'item';
  const title = name || nameOf(type, record) || label;
  const refs = references(doc, type, id).filter(r => r.type !== 'layout');
  const reassign = reassignOptions(doc, type, id);
  const body = `${usageList(esc, doc, type, id, refs, reassign)}${reassign ? `<div class="field cr-reassign"><label for="cr-reassign">${esc(reassign.label)}</label><select id="cr-reassign">${reassign.required ? '<option value="" selected disabled>Choose…</option>' : ''}${reassign.options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></div>` : ''}<p class="cr-dialog__note">Live site changes only when you publish. Version history can bring it back.</p>`;
  const d = openDialog(ctx, {
    kicker: 'DELETE ' + label.toUpperCase(),
    title: `Delete ${title}?`,
    body,
    actions: [{label: 'Keep it', value: null, kind: 'ghost'}, {label: 'Delete ' + label, value: 'delete', kind: 'danger'}],
    onAction: async value => {
      if (value !== 'delete') return null;
      const sel = d.el.querySelector('#cr-reassign');
      let reassignTo;
      if (sel) {
        if (reassign.required && !sel.value) throw new Error('Choose where they should go first.');
        reassignTo = sel.value;
      }
      const result = deleteRecord(ctx.data, type, id, reassignTo === undefined ? {} : {reassignTo});
      checkDocument(ctx, result.next);
      await ctx.save(result.next, result.summary.label);
      return result;
    },
  });
  const sel = d.el.querySelector('#cr-reassign');
  const deps = d.el.querySelector('[data-cr-deps]');
  const depCount = DEP_TYPE[type] ? refs.filter(r => r.type === DEP_TYPE[type]).length : 0;
  sel?.addEventListener('change', () => {
    d.setError('');
    if (deps) deps.textContent = dependantLine(doc, type, id, depCount, sel.value, reassign);
  });
  if (sel && deps && !reassign.required) deps.textContent = dependantLine(doc, type, id, depCount, sel.value, reassign);
  return d.done.then(v => (v && typeof v === 'object' ? v : null));
}

// Copies a record, saves once and opens the copy in the editor.
export async function duplicateFlow(ctx, type, id, {open = true} = {}) {
  const record = getRecord(ctx.data, type, id);
  if (!record) { ctx.toast?.('This item could not be found.'); return null; }
  if (!canDuplicate(type, ctx.role, record)) { ctx.toast?.('Your account cannot copy this.'); return null; }
  try {
    const result = duplicateRecord(ctx.data, type, id);
    checkDocument(ctx, result.next);
    await ctx.save(result.next, `Duplicated ${nameOf(type, record)}`);
    if (open && type !== 'subcategory') ctx.openEditor?.(type, result.copy.id, {duplicated: true});
    return result;
  } catch (err) {
    ctx.toast?.(err?.detail || err?.message || 'Could not copy this item.');
    return null;
  }
}
