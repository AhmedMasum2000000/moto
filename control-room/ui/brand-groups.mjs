// Brand groups (Products > Brands and Website > Brand logos), plan role I5.
// Groups such as "Engine oil" or "Tyres" hold brand logos; each can be hidden and can send its Shop
// button to a category or page. Every change is one ctx.save(next, label) after validateContent.
//
// Exports
//   renderBrandGroups(ctx) → html     the panel ([data-tour="brand-groups"])
//   bindBrandGroups(ctx, root)        inline rename, shop target, visible, order, add and delete
//   groupOptions(doc, {none}) → [[id, name]]   for a brand editor's group select
//   addBrandGroup(doc, name) → {next, group}  pure
import {normalise, slug, LIMITS} from '../../cms/content-model.mjs';
import {deleteRecordIn, moveRecord} from '../lib/records.mjs';
import {validateContent} from '../../supabase/functions/moto-admin/schema.mjs';

const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const E = ctx => ctx?.esc || escHtml;
const editors = role => role === 'owner' || role === 'editor';
let viewMemo = {src: null, doc: null};
const view = ctx => { if (viewMemo.src !== ctx.data) viewMemo = {src: ctx.data, doc: normalise(ctx.data)}; return viewMemo.doc; };

// Shop button destinations (the menu target set used by the server's validator).
const targetsOf = doc => [
  ['', 'No shop button'], ['Home', 'Home'], ['Services', 'Services'], ['Contact', 'Contact'], ['Posts', 'Posts'],
  ...(doc.categories || []).map(c => [c.id, 'Shop · ' + c.name]),
  ...(doc.pages || []).map(p => ['page:' + p.id, 'Page · ' + p.name]),
  ...(doc.posts || []).map(p => ['post:' + p.id, 'Post · ' + p.name]),
];
const opts = (esc, list, value) => list.map(([v, t]) => `<option value="${esc(v)}" ${String(value ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');

export function groupOptions(input, {none = true} = {}) {
  const doc = normalise(input);
  return [...(none ? [['', 'No group']] : []), ...(doc.brandGroups || []).map(g => [g.id, g.name + (g.visible === false ? ' (hidden)' : '')])];
}

export function addBrandGroup(input, name) {
  const doc = normalise(input), n = String(name ?? '').trim();
  if (!n) throw new Error('Enter a name for the brand group.');
  if (n.length > 60) throw new Error('Use a brand group name of up to 60 characters.');
  if ((doc.brandGroups || []).length >= LIMITS.brandGroups) throw new Error(`You can have up to ${LIMITS.brandGroups} brand groups.`);
  if (doc.brandGroups.some(g => g.name.trim().toLowerCase() === n.toLowerCase())) throw new Error('A brand group with this name already exists.');
  const taken = new Set(doc.brandGroups.map(g => g.id));
  let id = slug(n).slice(0, 60) || 'group', k = 2;
  const base = id;
  while (taken.has(id)) id = base + '-' + k++;
  const group = {id, name: n, visible: true};
  doc.brandGroups.push(group);
  return {next: doc, group};
}

export function renderBrandGroups(ctx) {
  const esc = E(ctx), doc = view(ctx), canEdit = editors(ctx.role), groups = doc.brandGroups || [];
  const count = id => doc.brands.filter(b => b.group === id).length;
  const loose = doc.brands.filter(b => !b.group || !groups.some(g => g.id === b.group)).length;
  const targets = targetsOf(doc);
  const rows = groups.map((g, i) => {
    const n = count(g.id);
    return `<div class="bg-row${g.visible === false ? ' is-hidden' : ''}" data-bg-row="${esc(g.id)}">
  <div class="bg-order"><button class="icon-button" type="button" data-bg-move="up" aria-label="Move ${esc(g.name)} up" ${i === 0 || !canEdit ? 'disabled' : ''}>↑</button><button class="icon-button" type="button" data-bg-move="down" aria-label="Move ${esc(g.name)} down" ${i === groups.length - 1 || !canEdit ? 'disabled' : ''}>↓</button></div>
  <div class="field bg-name"><label for="bg-name-${esc(g.id)}">Group name</label><input id="bg-name-${esc(g.id)}" data-bg-name maxlength="60" value="${esc(g.name)}" ${canEdit ? '' : 'disabled'}></div>
  <div class="field bg-target"><label for="bg-target-${esc(g.id)}">Shop button opens</label><select id="bg-target-${esc(g.id)}" data-bg-target ${canEdit ? '' : 'disabled'}>${opts(esc, targets, g.shopTarget || '')}</select></div>
  <span class="bg-count">${n} brand${n === 1 ? '' : 's'}</span>
  <label class="lay-switch" title="Show on the website"><span class="sr-only">Show ${esc(g.name)} on the website</span><input type="checkbox" data-bg-visible ${g.visible !== false ? 'checked' : ''} ${canEdit ? '' : 'disabled'}></label>
  ${canEdit ? `<button class="btn tiny ghost lay-danger" type="button" data-bg-delete>Delete</button>` : ''}
 </div>`;
  }).join('');
  return `<section class="panel bg-panel" data-tour="brand-groups" data-bg-root>
 <div class="panel-head"><h2>Brand groups</h2><span class="small-note">${groups.length} of ${LIMITS.brandGroups}</span></div>
 <p class="small-note">Groups such as Engine oil or Tyres organise the logos on the homepage dealer section. Hide a group to take its logos off the site. Order here is the order on the site.</p>
 <div class="bg-list">${rows || '<p class="empty-inline">No brand groups yet. Add your first one below.</p>'}</div>
 ${loose ? `<p class="small-note">${loose} brand${loose === 1 ? ' is' : 's are'} not in a group yet. Choose a group in each brand's editor.</p>` : ''}
 ${canEdit ? `<form class="bg-add" data-bg-add-form><div class="field"><label for="bg-new-name">New group</label><input id="bg-new-name" name="name" maxlength="60" placeholder="For example: Batteries" required></div><button class="btn primary" type="submit" ${groups.length >= LIMITS.brandGroups ? 'disabled' : ''}>+ Add brand group</button></form>` : ''}
</section>`;
}

let busy = false;
async function commit(ctx, next, label) {
  if (busy) return false;
  busy = true;
  try { validateContent(structuredClone(next)); await ctx.save(next, label); return true; }
  catch (e) { ctx.toast?.(e?.detail || e?.message || 'Unable to save. Please try again.'); return false; }
  finally { busy = false; }
}

let globalCtx = null;
function bindGlobal(ctx) {
  const first = !globalCtx;
  globalCtx = ctx;
  if (!first || typeof document === 'undefined') return;
  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-bg-confirm-delete],[data-bg-cancel]');
    if (!b) return;
    const ctx = globalCtx, dlg = b.closest('dialog');
    if (b.dataset.bgCancel !== undefined) { dlg?.close(); return; }
    const id = b.dataset.bgConfirmDelete, d = normalise(ctx.data), group = d.brandGroups.find(g => g.id === id);
    if (!group) { dlg?.close(); return; }
    const to = (dlg || document).querySelector('[data-bg-reassign]')?.value ?? '';
    try {
      deleteRecordIn(d, 'brandGroup', id, {reassignTo: to});
      dlg?.close();
      commit(ctx, d, `Deleted brand group ${group.name}`);
    } catch (err) { ctx.toast?.(err.detail || err.message); }
  });
}

export function bindBrandGroups(ctx, root) {
  bindGlobal(ctx);
  const panel = root?.matches?.('[data-bg-root]') ? root : root?.querySelector?.('[data-bg-root]');
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = '1';
  const esc = E(ctx);
  const rowOf = el => el.closest('[data-bg-row]')?.dataset.bgRow;
  const change = (id, fn, label) => {
    const d = normalise(ctx.data), g = d.brandGroups.find(g => g.id === id);
    if (!g) return Promise.resolve(false);
    fn(g);
    return commit(ctx, d, label(g));
  };
  panel.addEventListener('change', e => {
    const el = e.target, id = rowOf(el);
    if (!id) return;
    if (el.matches('[data-bg-name]')) {
      const name = el.value.trim();
      if (!name) { ctx.toast?.('Enter a name for the brand group.'); el.value = view(ctx).brandGroups.find(g => g.id === id)?.name || ''; return; }
      change(id, g => { g.name = name; }, g => `Renamed brand group ${g.name}`);
    }
    if (el.matches('[data-bg-target]')) change(id, g => { if (el.value) g.shopTarget = el.value; else delete g.shopTarget; }, g => `Updated ${g.name} shop button`);
    if (el.matches('[data-bg-visible]')) change(id, g => { g.visible = el.checked; }, g => `${g.visible ? 'Showed' : 'Hid'} brand group ${g.name}`).then(ok => { if (!ok) el.checked = !el.checked; });
  });
  panel.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-bg-name]')) { e.preventDefault(); e.target.blur(); } });
  panel.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !panel.contains(b)) return;
    const id = rowOf(b);
    if (b.dataset.bgMove && id) {
      try { const r = moveRecord(normalise(ctx.data), 'brandGroup', id, b.dataset.bgMove); if (r.changed) commit(ctx, r.next, 'Reordered brand groups'); }
      catch (err) { ctx.toast?.(err.detail || err.message); }
      return;
    }
    if (b.matches('[data-bg-delete]') && id) {
      const doc = view(ctx), g = doc.brandGroups.find(g => g.id === id), brands = doc.brands.filter(x => x.group === id);
      const sections = doc.sections.filter(s => s.group === id);
      const others = doc.brandGroups.filter(x => x.id !== id);
      ctx.modal({
        title: 'Delete brand group',
        mascot: true,
        body: `<h2>Delete “${esc(g.name)}”?</h2>${brands.length ? `<p>${brands.length} brand${brands.length === 1 ? ' is' : 's are'} in this group: ${esc(brands.slice(0, 6).map(b => b.name).join(', '))}${brands.length > 6 ? '…' : ''}. The logos are kept.</p><div class="field"><label for="bg-reassign">Move ${brands.length === 1 ? 'it' : 'them'} to</label><select id="bg-reassign" data-bg-reassign>${opts(esc, [...others.map(o => [o.id, o.name]), ['', 'No group']], others[0]?.id || '')}</select></div>` : '<p>No brands are in this group.</p>'}${sections.length ? `<p>${sections.length} website section${sections.length === 1 ? '' : 's'} showing this group will be removed too.</p>` : ''}<p class="small-note">Live site changes only when you publish. Version history can bring it back.</p><div class="modal-footer"><button class="btn ghost" type="button" data-bg-cancel>Keep it</button><button class="btn primary lay-danger-fill" type="button" data-bg-confirm-delete="${esc(id)}">Delete group</button></div>`,
      });
    }
  });
  panel.addEventListener('submit', e => {
    if (!e.target.matches('[data-bg-add-form]')) return;
    e.preventDefault();
    try {
      const {next, group} = addBrandGroup(ctx.data, new FormData(e.target).get('name'));
      commit(ctx, next, `Added brand group ${group.name}`);
    } catch (err) { ctx.toast?.(err.message); }
  });
}
