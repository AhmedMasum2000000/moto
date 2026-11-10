// Inline "+ New …" in selects. Picking the last option of a quick select reveals a small card inside
// the same form (never a second modal). Adding stages the record in `pending`, adds it to the select
// and selects it. saveEditor calls flushPending(next, pending) on its clone, so everything is written
// in the same single save as the record being edited.
//
// API:
//   createPending()                         → {categories, subs, brands, brandGroups, pages, serviceCategories}
//   hasPending(pending)                     → boolean
//   QUICK_KINDS                             kind → {label, option}
//   quickOption(kind)                       → '<option value="__new__">+ New category…</option>'
//   quickSelect(ctx, {kind, name, label, value, options, tour, pending, category, required})
//                                           → html of a .field with the select (pending records included)
//   subcategoryOptions(ctx, categoryId, pending) → [[id, name]] in admin (= website) order
//   bindQuickCreate(ctx, root, {pending, onCreate})
//       Wires every select[data-quick] inside root. data-quick = category | subcategory | brand |
//       brandGroup | page | serviceCategory. A subcategory select follows the category select of the
//       same form (data-quick-category="<select name>" picks which one; default "category").
//   stageRecord(doc, pending, kind, input)  → the staged record; throws Error(message) when invalid.
//       input: {name, category (for subcategory), group, image (for brand)}
//   flushPending(next, pending)             → next (mutated clone) with every staged record added.
import {slug, subId, newId, findChild} from '../../cms/content-model.mjs';
import {escOf} from './confirm.mjs';

export const NEW = '__new__';
export const QUICK_KINDS = Object.freeze({
  category: {label: 'category', option: '+ New category…', max: 100},
  subcategory: {label: 'subcategory', option: '+ New subcategory…', max: 100},
  brand: {label: 'brand', option: '+ New brand…', max: 100},
  brandGroup: {label: 'brand group', option: '+ New brand group…', max: 60},
  page: {label: 'page', option: '+ New page…', max: 150},
  serviceCategory: {label: 'service category', option: '+ New service category…', max: 100},
});
const DEFAULT_PAGE_HTML = '<section class="section"><p class="label">MOTO MARKET</p><h1>Your new page</h1><p class="lede">Tell your story here.</p></section>';
const key = v => String(v ?? '').trim().toLowerCase();
const objs = list => (Array.isArray(list) ? list.filter(x => x && typeof x === 'object') : []);

export const createPending = () => ({categories: [], subs: [], brands: [], brandGroups: [], pages: [], serviceCategories: []});
export const hasPending = p => !!p && Object.values(p).some(v => Array.isArray(v) && v.length);
export const quickOption = kind => `<option value="${NEW}" data-quick-new>${QUICK_KINDS[kind]?.option || '+ New…'}</option>`;

const uniqueId = (base, taken) => { if (!taken.has(base)) return base; for (let n = 2; ; n++) if (!taken.has(base + '-' + n)) return base + '-' + n; };
const fail = message => Object.assign(new Error(message), {code: 'invalid-value'});

function cleanName(input, kind) {
  const name = String(input?.name ?? '').replace(/\s+/g, ' ').trim();
  const max = QUICK_KINDS[kind]?.max || 100;
  if (!name) throw fail(`Type a name for the new ${QUICK_KINDS[kind]?.label || 'item'}.`);
  if (name.length > max) throw fail(`Keep the name to ${max} characters or fewer.`);
  return name;
}

// Categories (existing + staged) and their children (existing + staged).
function allCategories(doc, pending) { return [...objs(doc?.categories), ...(pending?.categories || [])]; }
function childrenOf(doc, pending, categoryId) {
  const cat = allCategories(doc, pending).find(c => c.id === categoryId);
  const own = (cat?.children || []).map(c => (typeof c === 'string' ? {id: c, name: c, visible: true} : c)).filter(Boolean);
  return [...own, ...(pending?.subs || []).filter(s => s.category === categoryId).map(s => s.child)];
}

export function stageRecord(doc, pending, kind, input = {}) {
  const name = cleanName(input, kind);
  switch (kind) {
    case 'category': {
      const all = allCategories(doc, pending);
      if (all.some(c => key(c.name) === key(name))) throw fail(`There is already a category called ${name}.`);
      if (all.length >= 100) throw fail('You can have up to 100 categories.');
      const id = uniqueId(slug(name).slice(0, 90), new Set(all.map(c => c.id)));
      const rec = {id, name, children: [], visible: true, image: input.image || 'assets/icons/servicing.png', description: ''};
      pending.categories.push(rec);
      return rec;
    }
    case 'subcategory': {
      const category = input.category;
      if (!category || !allCategories(doc, pending).some(c => c.id === category)) throw fail('Choose the category first.');
      const kids = childrenOf(doc, pending, category);
      if (kids.some(c => key(c.name) === key(name))) throw fail(`This category already has a subcategory called ${name}.`);
      if (kids.length >= 100) throw fail('A category can have up to 100 subcategories.');
      const child = {id: subId(name, new Set(kids.map(c => c.id))), name, visible: true};
      pending.subs.push({category, child});
      return child;
    }
    case 'brand': {
      const all = [...objs(doc?.brands), ...pending.brands];
      const found = all.find(b => key(b.name) === key(name));
      if (found) throw fail(`${found.name} is already in your brands. Pick it from the list.`);
      const groups = [...objs(doc?.brandGroups), ...pending.brandGroups];
      const group = input.group && groups.some(g => g.id === input.group) ? input.group : '';
      const rec = {id: 'brand-' + newId(), name, image: input.image || 'assets/icons/spare-parts.png', group, visible: true, alt: name};
      pending.brands.push(rec);
      return rec;
    }
    case 'brandGroup': {
      const all = [...objs(doc?.brandGroups), ...pending.brandGroups];
      if (all.some(g => key(g.name) === key(name))) throw fail(`There is already a brand group called ${name}.`);
      if (all.length >= 30) throw fail('You can have up to 30 brand groups.');
      const rec = {id: uniqueId('group-' + slug(name).slice(0, 80), new Set(all.map(g => g.id))), name, visible: true};
      pending.brandGroups.push(rec);
      return rec;
    }
    case 'page': {
      const pages = [...objs(doc?.pages), ...pending.pages];
      if (pages.some(p => key(p.name) === key(name))) throw fail(`There is already a page called ${name}.`);
      const taken = new Set([...pages, ...objs(doc?.posts)].map(p => p.slug).filter(Boolean));
      let s = slug(name).slice(0, 90);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) s = 'page';
      const rec = {id: 'page-' + newId(), name, visible: true, custom: true, title: name, description: '', shareImage: 'assets/banners/frando-brakes.webp', slug: uniqueId(s, taken), html: DEFAULT_PAGE_HTML, css: ''};
      pending.pages.push(rec);
      return rec;
    }
    case 'serviceCategory': {
      const all = [...(doc?.serviceCategories || []), ...pending.serviceCategories];
      if (all.some(c => key(c) === key(name))) throw fail(`There is already a service category called ${name}.`);
      pending.serviceCategories.push(name);
      return name;
    }
    default: throw fail('This list cannot add new items here.');
  }
}

// Writes every staged record into `next` (a clone the caller will save). Idempotent per record id.
export function flushPending(next, pending) {
  if (!pending) return next;
  next.categories ||= [];
  for (const c of pending.categories) if (!next.categories.some(x => x.id === c.id)) next.categories.push(structuredClone(c));
  next.brandGroups ||= [];
  for (const g of pending.brandGroups) if (!next.brandGroups.some(x => x.id === g.id)) next.brandGroups.push(structuredClone(g));
  next.brands ||= [];
  for (const b of pending.brands) if (!next.brands.some(x => x.id === b.id)) next.brands.push(structuredClone(b));
  next.pages ||= [];
  for (const p of pending.pages) if (!next.pages.some(x => x.id === p.id)) next.pages.push(structuredClone(p));
  next.serviceCategories ||= [];
  for (const s of pending.serviceCategories) if (!next.serviceCategories.some(x => key(x) === key(s))) next.serviceCategories.push(s);
  for (const {category, child} of pending.subs) {
    const cat = next.categories.find(c => c.id === category);
    if (!cat) continue;
    cat.children ||= [];
    if (cat.children.some(c => (typeof c === 'string' ? key(c) === key(child.name) : c.id === child.id))) continue;
    cat.children.push(structuredClone(child));
  }
  return next;
}

export function subcategoryOptions(ctx, categoryId, pending) {
  return childrenOf(ctx.data, pending, categoryId).map(c => [c.id, c.name + (c.visible === false ? ' (hidden)' : '')]);
}

function optionsFor(ctx, kind, pending, category) {
  const d = ctx.data || {};
  switch (kind) {
    case 'category': return allCategories(d, pending).map(c => [c.id, c.name]);
    case 'subcategory': return [['', 'No subcategory'], ...subcategoryOptions(ctx, category, pending)];
    case 'brandGroup': return [...objs(d.brandGroups), ...(pending?.brandGroups || [])].map(g => [g.id, g.name]);
    case 'serviceCategory': return [...(d.serviceCategories || []), ...(pending?.serviceCategories || [])].map(c => [c, c]);
    default: return [];
  }
}

const optionHtml = (esc, options, value) => options.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(value ?? '') === String(v) ? ' selected' : ''}>${esc(t)}</option>`; }).join('');

// A labelled select with the "+ New …" option last. options default to the kind's own list.
export function quickSelect(ctx, {kind, name, label, value = '', options, tour, pending, category, required = false, extra = ''} = {}) {
  const esc = escOf(ctx);
  const opts = options || optionsFor(ctx, kind, pending, category);
  const id = 'field-' + name;
  return `<div class="field quick-field"><label for="${esc(id)}">${esc(label)}</label><select id="${esc(id)}" name="${esc(name)}" data-quick="${esc(kind)}" ${tour ? `data-tour="${esc(tour)}"` : ''} ${required ? 'required' : ''} ${extra}>${optionHtml(esc, opts, value)}${quickOption(kind)}</select></div>`;
}

function cardHtml(ctx, kind, sel) {
  const esc = escOf(ctx);
  const info = QUICK_KINDS[kind];
  const groups = [...objs(ctx.data?.brandGroups)];
  const extra = kind === 'brand' ? `<label class="quick-card__sub" for="${esc(sel.id)}-qc-group">Brand group</label><select id="${esc(sel.id)}-qc-group" data-qc-group><option value="">No group</option>${groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select>` : '';
  const hint = kind === 'page' ? 'A simple page is created. Write its words later under Pages & Posts.' : kind === 'subcategory' ? 'Added inside the chosen category.' : 'Saved together with this form.';
  return `<div class="quick-card" role="group" aria-label="New ${esc(info.label)}" data-quick-card="${esc(kind)}">
<label class="quick-card__label" for="${esc(sel.id)}-qc-name">New ${esc(info.label)} name</label>
<input id="${esc(sel.id)}-qc-name" data-qc-name type="text" maxlength="${info.max}" autocomplete="off" placeholder="For example: ${kind === 'brand' ? 'Motul' : kind === 'page' ? 'Warranty' : kind === 'brandGroup' ? 'Helmets' : kind === 'serviceCategory' ? 'Tyre fitting' : 'Brake pads'}">${extra}
<p class="quick-card__error" role="alert" hidden></p>
<div class="quick-card__actions"><button type="button" class="btn ghost tiny" data-qc-cancel>Cancel</button><button type="button" class="btn primary tiny" data-qc-add>Add ${esc(info.label)}</button></div>
<p class="quick-card__hint">${esc(hint)}</p></div>`;
}

export function bindQuickCreate(ctx, root, {pending, onCreate} = {}) {
  if (!root || !pending) return {destroy() {}};
  const esc = escOf(ctx);
  const selects = () => [...root.querySelectorAll('select[data-quick]')];
  const prev = new WeakMap();
  selects().forEach(s => prev.set(s, s.value === NEW ? '' : s.value));

  const categorySelectFor = sub => root.querySelector(`select[name="${CSS.escape(sub.dataset.quickCategory || 'category')}"]`);
  const refreshSubs = (catSelect) => {
    for (const sub of selects().filter(s => s.dataset.quick === 'subcategory' && categorySelectFor(s) === catSelect)) {
      const keep = sub.value;
      const opts = optionsFor(ctx, 'subcategory', pending, catSelect.value);
      sub.innerHTML = optionHtml(esc, opts, opts.some(o => o[0] === keep) ? keep : '') + quickOption('subcategory');
      prev.set(sub, sub.value);
    }
  };

  const closeCard = (sel, restore) => {
    const card = sel._quickCard;
    if (card) { card.remove(); sel._quickCard = null; }
    if (restore) sel.value = prev.get(sel) ?? '';
    sel.removeAttribute('aria-expanded');
  };
  const openCard = sel => {
    if (sel._quickCard) { sel._quickCard.querySelector('[data-qc-name]').focus(); return; }
    const kind = sel.dataset.quick;
    const host = sel.closest('.field') || sel;
    host.insertAdjacentHTML('afterend', cardHtml(ctx, kind, sel));
    const card = host.nextElementSibling;
    sel._quickCard = card;
    sel.setAttribute('aria-expanded', 'true');
    const input = card.querySelector('[data-qc-name]');
    const error = card.querySelector('.quick-card__error');
    const add = () => {
      try {
        const input2 = {name: input.value};
        if (kind === 'subcategory') { const c = categorySelectFor(sel); input2.category = c ? c.value : sel.dataset.category; }
        if (kind === 'brand') input2.group = card.querySelector('[data-qc-group]')?.value || '';
        const rec = stageRecord(ctx.data, pending, kind, input2);
        const value = kind === 'page' ? 'page:' + rec.id : kind === 'serviceCategory' ? rec : rec.id;
        const label = kind === 'page' ? rec.name + ' (page)' : kind === 'serviceCategory' ? rec : rec.name;
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = label; opt.dataset.pending = '';
        sel.insertBefore(opt, sel.querySelector('[data-quick-new]'));
        sel.value = value;
        prev.set(sel, value);
        closeCard(sel, false);
        sel.dispatchEvent(new Event('change', {bubbles: true}));
        sel.focus();
        onCreate?.(kind, rec);
        ctx.toast?.(`${QUICK_KINDS[kind].label[0].toUpperCase() + QUICK_KINDS[kind].label.slice(1)} “${typeof rec === 'string' ? rec : rec.name}” added. It is saved with this form.`);
      } catch (err) {
        error.textContent = err.message; error.hidden = false; input.focus();
      }
    };
    card.addEventListener('click', e => {
      if (e.target.closest('[data-qc-add]')) add();
      else if (e.target.closest('[data-qc-cancel]')) { closeCard(sel, true); sel.focus(); }
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); add(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCard(sel, true); sel.focus(); }
    });
    input.focus();
  };

  const onChange = e => {
    const sel = e.target.closest?.('select[data-quick]');
    if (!sel || !root.contains(sel)) return;
    if (sel.value === NEW) { openCard(sel); return; }
    if (sel._quickCard) closeCard(sel, false);
    prev.set(sel, sel.value);
    if (sel.dataset.quick === 'category') refreshSubs(sel);
  };
  root.addEventListener('change', onChange);
  return {destroy() { root.removeEventListener('change', onChange); selects().forEach(s => closeCard(s, false)); }, refreshSubs};
}

// The category a subcategory option belongs to, for callers that only have ids.
export const pendingChild = (pending, category, id) => (pending?.subs || []).find(s => s.category === category && s.child.id === id)?.child || null;
export {findChild};
