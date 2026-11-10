// Subcategories as records inside the category editor (replaces the one-per-line textarea).
// Each row: drag handle + arrows, photo, name edited in place, Visible switch, product count and a
// "…" menu (Add product here, Duplicate, Delete). "+ Add subcategory" stays at the bottom.
// Nothing is saved here: saveEditor reads the result and applies it in its one save.
//
// API:
//   renderSubcategories(ctx, category, {isNew})  → html (fieldset[data-subs])
//   bindSubcategories(ctx, root, category, {isNew}) → controller {read(), destroy()}; also root's
//       fieldset gets ._subs = controller, so readSubcategories(root) finds it later.
//   readSubcategories(root) → {children:[{id, name, visible, image?}], removed:[{id, name, moveTo, count}]}
//       throws Error(message) for empty or duplicate names (saveEditor shows it).
//   applySubcategoryEdits(next, categoryId, result) → {children, summary:[…]}
//       Applies the result to `next` (a normalised clone): deleted subcategories are removed through
//       records.deleteRecordIn (products move to moveTo or lose the subcategory, home cards and
//       sections that used them are fixed), then the category's children are set in the new order.
//       For a category that is not in `next` yet (a new one) it only returns the children.
import {subId} from '../../cms/content-model.mjs';
import {deleteRecordIn} from '../lib/records.mjs';
import {escOf} from './confirm.mjs';
import {makeSortable, moveIds, dragHandle} from './sortable.mjs';

const key = v => String(v ?? '').trim().toLowerCase();
const asChild = c => (typeof c === 'string' ? {id: c, name: c, visible: true} : {...c, visible: c.visible !== false});

export function productCounts(doc, categoryId) {
  const counts = {};
  for (const p of doc?.products || []) if (p.category === categoryId && p.subcategory) counts[p.subcategory] = (counts[p.subcategory] || 0) + 1;
  return counts;
}

function rowHtml(ctx, c, {count = 0, isNewChild = false, index = 0, total = 1, catSaved = true} = {}) {
  const esc = escOf(ctx);
  const img = c.image ? ctx.imageUrl?.(c.image) || '' : '';
  const n = esc(c.name || 'subcategory');
  return `<li class="sub-row${c.visible === false ? ' is-hidden' : ''}" data-sort-id="${esc(c.id)}" data-sub-id="${esc(c.id)}">
${dragHandle('Drag ' + (c.name || 'subcategory'), {tour: index === 0})}
<span class="sub-row__arrows"><button type="button" class="icon-button" data-sub-move="up" aria-label="Move ${n} up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-sub-move="down" aria-label="Move ${n} down" ${index === total - 1 ? 'disabled' : ''}>↓</button></span>
<button type="button" class="sub-row__thumb" data-sub-photo aria-label="Photo for ${n}">${img ? `<img src="${esc(img)}" alt="">` : '<span aria-hidden="true">+</span>'}</button>
<span class="sub-row__name"><input type="text" data-sub-name value="${esc(c.name)}" maxlength="100" aria-label="Subcategory name" placeholder="Subcategory name" required></span>
<label class="sub-row__vis" title="Show on website"><input type="checkbox" data-sub-visible ${c.visible !== false ? 'checked' : ''} aria-label="Show ${n} on website"><span>${c.visible !== false ? 'Visible' : 'Hidden'}</span></label>
<span class="sub-row__count" data-sub-count>${isNewChild ? 'New' : count + ' product' + (count === 1 ? '' : 's')}</span>
<details class="row-menu"><summary class="icon-button" aria-label="More for ${n}">…</summary><div class="row-menu__list">
<button type="button" data-sub-act="add-product" ${isNewChild || !catSaved ? 'disabled title="Save first"' : ''}>Add product here</button>
<button type="button" data-sub-act="duplicate">Duplicate</button>
<button type="button" data-sub-act="top">Move to top</button><button type="button" data-sub-act="bottom">Move to bottom</button>
<button type="button" class="danger-text" data-sub-act="delete">Delete…</button></div></details>
<div class="sub-row__confirm" data-sub-confirm hidden></div>
</li>`;
}

export function renderSubcategories(ctx, category, {isNew = false} = {}) {
  const esc = escOf(ctx);
  const children = (category?.children || []).map(asChild);
  const counts = productCounts(ctx.data, category?.id);
  return `<fieldset class="subs" data-subs data-category="${esc(category?.id || '')}" data-tour="sub-list">
<legend>Subcategories</legend>
<p class="subs__note">The order here is the order on your website. Rename in place, add a photo, hide or drag.</p>
<ol class="subs__list" data-subs-list>${children.map((c, i) => rowHtml(ctx, c, {count: counts[c.id] || 0, index: i, total: children.length, catSaved: !isNew})).join('')}</ol>
<p class="subs__empty" data-subs-empty ${children.length ? 'hidden' : ''}>No subcategories yet. Add the first one below.</p>
<div class="subs__removed" data-subs-removed hidden></div>
<div class="subs__add" data-tour="sub-add"><input type="text" data-sub-new maxlength="100" placeholder="New subcategory name" aria-label="New subcategory name"><button type="button" class="btn ghost" data-sub-add>+ Add subcategory</button></div>
<p class="subs__error" role="alert" data-subs-error hidden></p>
</fieldset>`;
}

export function bindSubcategories(ctx, root, category, {isNew = false} = {}) {
  const box = root.matches?.('[data-subs]') ? root : root.querySelector('[data-subs]');
  if (!box) return null;
  const esc = escOf(ctx);
  const list = box.querySelector('[data-subs-list]');
  const counts = productCounts(ctx.data, category?.id);
  const original = new Map((category?.children || []).map(asChild).map(c => [c.id, c]));
  // Working state: id → {id, name, visible, image}; order lives in the DOM.
  const state = new Map([...original.values()].map(c => [c.id, {...c}]));
  const created = new Set();
  const removed = new Map(); // id → {id, name, moveTo, count}
  const errorEl = box.querySelector('[data-subs-error]');
  const setError = msg => { errorEl.textContent = msg || ''; errorEl.hidden = !msg; };

  const rows = () => [...list.querySelectorAll(':scope > [data-sub-id]')];
  const order = () => rows().map(r => r.dataset.subId);
  const takenIds = () => new Set([...state.keys(), ...removed.keys()]);
  const refreshArrows = () => {
    const rs = rows();
    rs.forEach((r, i) => {
      r.querySelector('[data-sub-move="up"]').disabled = i === 0;
      r.querySelector('[data-sub-move="down"]').disabled = i === rs.length - 1;
      r.querySelector('[data-drag-handle]')?.toggleAttribute('data-tour', false);
    });
    rs[0]?.querySelector('[data-drag-handle]')?.setAttribute('data-tour', 'drag-handle');
    box.querySelector('[data-subs-empty]').hidden = rs.length > 0;
  };
  const reorder = ids => { const byId = new Map(rows().map(r => [r.dataset.subId, r])); ids.forEach(id => list.appendChild(byId.get(id))); refreshArrows(); };
  const renderRemoved = () => {
    const el = box.querySelector('[data-subs-removed]');
    const items = [...removed.values()];
    el.hidden = !items.length;
    el.innerHTML = items.length ? `<p>Deleted when you save:</p><ul>${items.map(r => `<li><s>${esc(r.name)}</s>${r.count ? ` <small>· ${r.count} product${r.count === 1 ? '' : 's'} → ${esc(r.moveTo ? state.get(r.moveTo)?.name || 'another subcategory' : 'no subcategory')}</small>` : ''} <button type="button" class="text-link" data-sub-restore="${esc(r.id)}">Restore</button></li>`).join('')}</ul>` : '';
  };

  const addRow = (child, afterRow = null) => {
    state.set(child.id, child);
    created.add(child.id);
    const html = rowHtml(ctx, child, {isNewChild: true, index: 1, total: 2, catSaved: !isNew});
    if (afterRow) afterRow.insertAdjacentHTML('afterend', html); else list.insertAdjacentHTML('beforeend', html);
    refreshArrows();
    return list.querySelector(`[data-sub-id="${CSS.escape(child.id)}"]`);
  };

  const add = () => {
    const input = box.querySelector('[data-sub-new]');
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) { setError('Type a name for the new subcategory.'); input.focus(); return; }
    if ([...state.values()].some(c => key(c.name) === key(name))) { setError(`There is already a subcategory called ${name}.`); input.focus(); return; }
    if (state.size >= 100) { setError('A category can have up to 100 subcategories.'); return; }
    setError('');
    addRow({id: subId(name, takenIds()), name, visible: true});
    input.value = '';
    input.focus();
  };

  const startDelete = row => {
    const id = row.dataset.subId, c = state.get(id);
    const count = created.has(id) ? 0 : counts[id] || 0;
    if (!count) { finishDelete(row, ''); return; }
    const box2 = row.querySelector('[data-sub-confirm]');
    const siblings = order().filter(x => x !== id).map(x => state.get(x));
    box2.innerHTML = `<label for="sub-move-${esc(id)}">Move ${count} product${count === 1 ? '' : 's'} to:</label><select id="sub-move-${esc(id)}" data-sub-move-to><option value="">No subcategory (stay in this category)</option>${siblings.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select><div class="sub-row__confirm-actions"><button type="button" class="btn ghost tiny" data-sub-cancel>Keep it</button><button type="button" class="btn danger tiny" data-sub-confirm-delete>Delete ${esc(c.name)}</button></div>`;
    box2.hidden = false;
    box2.querySelector('select').focus();
  };
  const finishDelete = (row, moveTo) => {
    const id = row.dataset.subId, c = state.get(id);
    state.delete(id);
    if (created.has(id)) created.delete(id);
    else removed.set(id, {id, name: c.name, moveTo, count: counts[id] || 0});
    row.remove();
    // A removed subcategory can no longer be a move target.
    for (const r of removed.values()) if (r.moveTo === id) r.moveTo = '';
    refreshArrows();
    renderRemoved();
  };

  box.addEventListener('click', e => {
    const row = e.target.closest('[data-sub-id]');
    const t = e.target;
    if (t.closest('[data-sub-add]')) { add(); return; }
    const restore = t.closest('[data-sub-restore]');
    if (restore) {
      const r = removed.get(restore.dataset.subRestore);
      if (!r) return;
      removed.delete(r.id);
      const c = original.get(r.id);
      state.set(c.id, {...c});
      list.insertAdjacentHTML('beforeend', rowHtml(ctx, c, {count: counts[c.id] || 0, index: 1, total: 2, catSaved: !isNew}));
      refreshArrows(); renderRemoved();
      return;
    }
    if (!row) return;
    const move = t.closest('[data-sub-move]');
    if (move) { reorder(moveIds(order(), row.dataset.subId, move.dataset.subMove)); row.querySelector(`[data-sub-move="${move.dataset.subMove}"]`)?.focus(); return; }
    if (t.closest('[data-sub-photo]')) {
      const id = row.dataset.subId;
      ctx.chooseImage?.(ref => {
        const c = state.get(id); if (!c) return;
        c.image = ref;
        const btn = row.querySelector('[data-sub-photo]');
        btn.innerHTML = ref ? `<img src="${esc(ctx.imageUrl?.(ref) || '')}" alt="">` : '<span aria-hidden="true">+</span>';
      }, {optional: true, key: 'sub:' + id});
      return;
    }
    if (t.closest('[data-sub-cancel]')) { const b = row.querySelector('[data-sub-confirm]'); b.hidden = true; b.innerHTML = ''; return; }
    if (t.closest('[data-sub-confirm-delete]')) { finishDelete(row, row.querySelector('[data-sub-move-to]')?.value || ''); return; }
    const act = t.closest('[data-sub-act]');
    if (!act || act.disabled) return;
    act.closest('details')?.removeAttribute('open');
    const id = row.dataset.subId;
    if (act.dataset.subAct === 'top' || act.dataset.subAct === 'bottom') reorder(moveIds(order(), id, act.dataset.subAct));
    else if (act.dataset.subAct === 'duplicate') {
      const c = state.get(id);
      let name = c.name + ' (copy)';
      for (let n = 2; [...state.values()].some(x => key(x.name) === key(name)); n++) name = `${c.name} (copy ${n})`;
      const copy = {id: subId(name, takenIds()), name: name.slice(0, 100), visible: false};
      if (c.image) copy.image = c.image;
      addRow(copy, row).querySelector('[data-sub-name]').focus();
    } else if (act.dataset.subAct === 'delete') startDelete(row);
    else if (act.dataset.subAct === 'add-product') ctx.openEditor?.('product', 'new', {defaults: {category: category.id, subcategory: id}});
  });
  box.addEventListener('input', e => {
    const row = e.target.closest('[data-sub-id]');
    if (row && e.target.matches('[data-sub-name]')) { const c = state.get(row.dataset.subId); if (c) c.name = e.target.value; }
  });
  box.addEventListener('change', e => {
    const row = e.target.closest('[data-sub-id]');
    if (row && e.target.matches('[data-sub-visible]')) {
      const c = state.get(row.dataset.subId); if (!c) return;
      c.visible = e.target.checked;
      row.classList.toggle('is-hidden', !c.visible);
      e.target.nextElementSibling.textContent = c.visible ? 'Visible' : 'Hidden';
    }
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('[data-sub-new]')) { e.preventDefault(); add(); }
    else if (e.key === 'Enter' && e.target.matches('[data-sub-name]')) e.preventDefault();
  });
  // Close other "…" menus when one opens.
  box.addEventListener('toggle', e => { if (e.target.matches?.('details.row-menu') && e.target.open) box.querySelectorAll('details.row-menu[open]').forEach(d => { if (d !== e.target) d.removeAttribute('open'); }); }, true);

  const sortable = makeSortable(list, {onDrop: () => refreshArrows()});

  const controller = {
    read() {
      const children = order().map(id => {
        const c = state.get(id);
        const name = String(c.name || '').replace(/\s+/g, ' ').trim();
        const out = {id: c.id, name, visible: c.visible !== false};
        if (c.image) out.image = c.image;
        if (c.description) out.description = c.description;
        return out;
      });
      const empty = children.find(c => !c.name);
      if (empty) { setError('Every subcategory needs a name.'); throw new Error('Every subcategory needs a name.'); }
      const seen = new Set();
      for (const c of children) {
        if (seen.has(key(c.name))) { const m = `Two subcategories are called ${c.name}. Give each a different name.`; setError(m); throw new Error(m); }
        seen.add(key(c.name));
      }
      setError('');
      return {children, removed: [...removed.values()].map(r => ({...r, moveTo: r.moveTo && state.has(r.moveTo) ? r.moveTo : ''}))};
    },
    get dirty() {
      const now = order().map(id => JSON.stringify(state.get(id)));
      const was = [...original.values()].map(c => JSON.stringify(c));
      return removed.size > 0 || now.join() !== was.join();
    },
    destroy() { sortable.destroy(); },
  };
  box._subs = controller;
  return controller;
}

export function readSubcategories(root) {
  const box = root?.matches?.('[data-subs]') ? root : root?.querySelector?.('[data-subs]');
  return box?._subs ? box._subs.read() : null;
}

export function applySubcategoryEdits(next, categoryId, result) {
  const summary = [];
  if (!result) return {children: null, summary};
  const cat = (next.categories || []).find(c => c.id === categoryId);
  const children = result.children.map(c => ({...c}));
  if (!cat) return {children, summary};
  // Removed ones stay in place until deleteRecordIn has repaired everything that used them; new
  // ones are present first so they can be move targets.
  const keepRemoved = (cat.children || []).filter(c => c && typeof c === 'object' && result.removed.some(r => r.id === c.id));
  cat.children = [...children, ...keepRemoved];
  for (const r of result.removed) {
    if (!cat.children.some(c => c.id === r.id)) continue;
    const {summary: s} = deleteRecordIn(next, 'subcategory', categoryId + '/' + r.id, {reassignTo: r.moveTo || ''});
    summary.push(s);
  }
  const fresh = next.categories.find(c => c.id === categoryId);
  fresh.children = children;
  return {children, summary};
}
