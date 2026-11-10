// Tour hub + small mascot helpers (plan role I6). HTML builders return escaped strings only.
//
// Exports
//   MASCOT_SRC                                  'assets/mascot/guide.webp' (relative to control-room/index.html)
//   mascotImg(src?, size=56) → html             <img class="mascot mascot--32|56|96">
//   renderHub(ctx, {chapters, progress, mascotSrc?, phone?}) → html   hub body (chapters grouped by section)
//   bindHub(ctx, dialogEl, tourApi)             close / backdrop / "Restart all" wiring (start buttons use the
//                                               delegated [data-tour-start] handler from tour.mjs)
//   explainButtonHtml(ctx, {chapter?, editorType?, label?}) → html   "Explain this page" ([data-tour="explain"])
//   tourButtonHtml(ctx, {label?}) → html        mascot "?" for the top bar ([data-tour="topbar-tour"])
//   helpCardHtml(ctx) → html                    sidebar "First time here? Take a 1-minute tour" card
//   chapterResultsHtml(ctx, chapters) → html    search() rows for matching chapters (from searchChapters)
//   resetButtonHtml(ctx) → html                 Settings > Your sign-in "Reset tour progress"

import {SECTIONS, minutesFor} from './steps.mjs';

export const MASCOT_SRC = 'assets/mascot/guide.webp';
const ESC = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const E = ctx => (typeof ctx?.esc === 'function' ? ctx.esc : ESC);
const srcOf = ctx => ctx?.mascotSrc || MASCOT_SRC;

export function mascotImg(src = MASCOT_SRC, size = 56) {
  const n = size === 32 || size === 96 ? size : 56;
  return `<img class="mascot mascot--${n}" src="${ESC(src)}" alt="" width="${n}" height="${n}" decoding="async" draggable="false">`;
}

export function renderHub(ctx, {chapters = [], progress = {chapters: {}}, mascotSrc, phone = false} = {}) {
  const esc = E(ctx), p = progress.chapters || {};
  const total = chapters.length, done = chapters.filter(c => p[c.id]?.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const groups = SECTIONS.map(sec => ({sec, list: chapters.filter(c => c.section === sec.id)})).filter(g => g.list.length);
  const row = (c, n) => {
    const st = p[c.id] || {}, steps = c.steps.length;
    const resumeAt = !st.done && st.step > 0 && st.step < steps ? st.step : 0;
    const status = st.done ? '<span class="tour-hub__tick" aria-label="Done">✓</span>' : `<span class="tour-hub__num" aria-hidden="true">${String(n).padStart(2, '0')}</span>`;
    const action = resumeAt
      ? `<button type="button" class="btn primary tiny" data-tour-start="${esc(c.id)}" data-tour-step="${resumeAt}">Resume step ${resumeAt + 1}</button><button type="button" class="tour-link" data-tour-start="${esc(c.id)}">Start over</button>`
      : `<button type="button" class="btn ${st.done ? 'ghost' : 'primary'} tiny" data-tour-start="${esc(c.id)}">${st.done ? 'Watch again' : 'Start'}</button>`;
    return `<li class="tour-hub__chapter${st.done ? ' is-done' : ''}">${status}<div class="tour-hub__text"><b>${esc(c.title)}</b><small>${esc(c.blurb || '')}</small><small class="tour-hub__meta">${steps} step${steps === 1 ? '' : 's'} · about ${minutesFor(c.steps)} min${st.done ? ' · done' : resumeAt ? ` · stopped at step ${resumeAt + 1}` : ''}</small></div><div class="tour-hub__go">${action}</div></li>`;
  };
  let n = 0;
  return `<div class="modal-head"><span class="eyebrow red">GUIDED TOUR</span><button type="button" class="icon-button" data-hub-close aria-label="Close the tour hub">✕</button></div>
<div class="tour-hub__hero">${mascotImg(mascotSrc || srcOf(ctx), phone ? 56 : 96)}<div><h2 id="tour-hub-title">Where shall we ride?</h2><p>Pick a part of the shop and I'll show you around it, step by step. Nothing gets changed or published while I show you.</p></div></div>
<div class="tour-hub__progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="Chapters done"><span style="width:${pct}%"></span></div>
<p class="tour-hub__count">${done} of ${total} chapter${total === 1 ? '' : 's'} done${done && done === total ? '. You know your way around!' : ''}</p>
${groups.map(g => `<section class="tour-hub__group"><h3>${esc(g.sec.title)}</h3><ol>${g.list.map(c => row(c, ++n)).join('')}</ol></section>`).join('')}
<div class="modal-footer tour-hub__foot"><button type="button" class="btn ghost" data-hub-restart${done || Object.keys(p).length ? '' : ' disabled'}>Restart all</button><button type="button" class="btn primary" data-tour-start="getting-around">${done ? 'Start from the beginning' : 'Start the tour'}</button></div>`;
}

export function bindHub(ctx, dialog, tour) {
  dialog.addEventListener('click', e => {
    if (e.target === dialog) { dialog.close(); return; }
    if (e.target.closest('[data-hub-close]')) { dialog.close(); return; }
    if (e.target.closest('[data-hub-restart]')) { tour?.restartAll?.(); ctx?.toast?.('All chapters are fresh again.'); }
  });
}

export function explainButtonHtml(ctx, {chapter = 'auto', editorType = '', label = 'Explain this page'} = {}) {
  const esc = E(ctx);
  return `<button type="button" class="tour-explain" data-tour="explain" data-tour-start="${esc(chapter)}"${editorType ? ` data-editor-type="${esc(editorType)}"` : ''}>${mascotImg(srcOf(ctx), 32)}<span>${esc(label)}</span></button>`;
}
export function tourButtonHtml(ctx, {label = 'Tour and help'} = {}) {
  const esc = E(ctx);
  return `<button type="button" class="tour-trigger icon-button" data-tour="topbar-tour" data-tour-start="hub" aria-label="${esc(label)}" title="${esc(label)}">${mascotImg(srcOf(ctx), 32)}<span class="tour-trigger__q" aria-hidden="true">?</span></button>`;
}
export function helpCardHtml(ctx) {
  return `<button type="button" class="help-card tour-help-card" data-tour-start="hub">${mascotImg(srcOf(ctx), 32)}<span>First time here?<small>Take a 1-minute tour ↗</small></span></button>`;
}
export function chapterResultsHtml(ctx, chapters = []) {
  const esc = E(ctx);
  if (!chapters.length) return '';
  return `<div class="tour-results"><span class="eyebrow">SHOW ME HOW</span>${chapters.map(c => `<button type="button" class="tour-result" data-tour-start="${esc(c.id)}">${mascotImg(srcOf(ctx), 32)}<span><b>${esc(c.title)}</b><small>Tour · ${c.steps.length} steps · ${esc(c.blurb || '')}</small></span></button>`).join('')}</div>`;
}
export function resetButtonHtml() {
  return '<button type="button" class="btn ghost" data-tour-reset>Reset tour progress</button>';
}
