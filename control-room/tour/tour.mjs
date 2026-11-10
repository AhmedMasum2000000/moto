// Mascot tour engine (plan role I6). One popover="manual" layer (#tour-layer) that sits in the top layer above
// every dialog: a spotlight on the target, and a speech bubble with Cookie Rider. Desktop: bubble beside the
// target with an arrow, flipping when there is no room. Phone (≤760px): bottom sheet, or top sheet when the
// target sits in the lower half of the screen.
//
// Exports
//   createTour(ctx, opts?) → tour        (see the object returned at the bottom of createTour)
//     tour.start(chapterId, step=0)       run one chapter (filtered by ctx.role / ctx.canPublish / screen size)
//     tour.explain({route, sub, editorType}?) start the chapter for the page on screen ("Explain this page")
//     tour.resume() → bool               resume a run interrupted by a reload (sessionStorage)
//     tour.greet() → bool                first sign-in greeting per staff user ("Hi, I'm Cookie Rider…")
//     tour.openHub()                     open the Tour hub dialog (tour/hub.mjs)
//     tour.stop() · next() · back() · skipChapter()
//     tour.raise()                       re-show the layer on top (call after showModal; also automatic)
//     tour.reset()                       clear this user's tour progress
//     tour.progress() → {greeted, chapters:{id:{done, step, at}}}
//     tour.running() → bool · tour.destroy()
//   Delegated clicks (installed by createTour, anywhere in the document):
//     [data-tour-start="<chapter>|hub|auto"] (optional data-tour-step="n") · [data-tour="explain"] (auto) ·
//     [data-tour="topbar-tour"] (hub, unless it has data-tour-start) · [data-tour-reset] (reset progress + toast)
//   Pure helpers (tested in node): progressKey, readProgress, writeProgress, clearProgress, readRun, writeRun,
//     markStep, markDone, filterSteps, isPhoneWidth, PHONE_QUERY, RUN_KEY
//
// ctx used: go(route, sub), openEditor(type, 'new', {demo:true, tour:true}), chooseImage(cb, opts), role,
//   staffId, canPublish?, setMenu?(open), toast?(msg), esc?, mascotSrc?. Nothing here ever calls save().

import {chaptersFor, chapterById, chapterForRoute, stepsFor, anchorOf, MICROCOPY} from './steps.mjs';
import {renderHub, bindHub, mascotImg} from './hub.mjs';

export const PHONE_QUERY = '(max-width: 760px)';
export const RUN_KEY = 'moto-tour:run';
export const progressKey = staffId => 'moto-tour:v1:' + (staffId || 'anon');
const EMPTY = () => ({greeted: false, chapters: {}});

const safeStore = which => { try { return typeof globalThis[which] === 'undefined' ? null : globalThis[which]; } catch { return null; } };

export function readProgress(storage, staffId) {
  try {
    const raw = storage?.getItem(progressKey(staffId));
    if (!raw) return EMPTY();
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return EMPTY();
    const chapters = {};
    if (p.chapters && typeof p.chapters === 'object' && !Array.isArray(p.chapters)) {
      for (const [id, v] of Object.entries(p.chapters)) {
        if (!chapterById(id) || !v || typeof v !== 'object') continue;
        chapters[id] = {done: v.done === true, step: Number.isInteger(v.step) && v.step >= 0 ? v.step : 0, at: Number(v.at) || 0};
      }
    }
    return {greeted: p.greeted === true, chapters};
  } catch { return EMPTY(); }
}
export function writeProgress(storage, staffId, p) { try { storage?.setItem(progressKey(staffId), JSON.stringify(p)); return true; } catch { return false; } }
export function clearProgress(storage, staffId) { try { storage?.removeItem(progressKey(staffId)); } catch { /* storage off */ } }
export function readRun(session) {
  try {
    const r = JSON.parse(session?.getItem(RUN_KEY) || 'null');
    if (r && typeof r === 'object' && chapterById(r.chapter) && Number.isInteger(r.step) && r.step >= 0) return {chapter: r.chapter, step: r.step, staffId: r.staffId ?? null};
  } catch { /* corrupt */ }
  return null;
}
export function writeRun(session, run) { try { if (run) session?.setItem(RUN_KEY, JSON.stringify(run)); else session?.removeItem(RUN_KEY); } catch { /* storage off */ } }
export const markStep = (p, id, step, at = Date.now()) => ({...p, chapters: {...p.chapters, [id]: {done: !!p.chapters[id]?.done, step, at}}});
export const markDone = (p, id, at = Date.now()) => ({...p, chapters: {...p.chapters, [id]: {done: true, step: 0, at}}});
export const filterSteps = (chapterId, {role, canPublish, phone}) => stepsFor(chapterId, {role, canPublish, phone});
export const isPhoneWidth = () => { try { return matchMedia(PHONE_QUERY).matches; } catch { return false; } };

const ESC = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const raf = () => new Promise(r => requestAnimationFrame(() => r()));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden';
const isModal = d => { try { return d.matches(':modal'); } catch { return d.hasAttribute('open'); } };

export function createTour(ctx, opts = {}) {
  const storage = opts.storage !== undefined ? opts.storage : safeStore('localStorage');
  const session = opts.session !== undefined ? opts.session : safeStore('sessionStorage');
  const esc = typeof ctx.esc === 'function' ? ctx.esc : ESC;
  const mascotSrc = () => ctx.mascotSrc || opts.mascotSrc || 'assets/mascot/guide.webp';
  const role = () => ctx.role || 'owner';
  const staffId = () => ctx.staffId ?? 'anon';
  const canPublish = () => role() === 'owner' || !!ctx.canPublish;
  const filterOpts = () => ({role: role(), canPublish: canPublish(), phone: isPhoneWidth()});

  let layer = null, live = null, run = null, token = 0, lastNav = '', target = null, drawerByTour = false;
  const tourDialogs = new Set();
  let ro = null, rafId = 0, dialogObserver = null, hub = null, lastBefore = null, filteredByTour = false;

  const progress = () => readProgress(storage, staffId());
  const saveProgress = p => writeProgress(storage, staffId(), p);

  // ── layer ──────────────────────────────────────────────────────────────────────────────────────────────
  function ensureLayer() {
    if (layer?.isConnected) return layer;
    layer = document.createElement('div');
    layer.id = 'tour-layer';
    layer.className = 'tour-layer';
    if ('popover' in HTMLElement.prototype) layer.setAttribute('popover', 'manual');
    else layer.classList.add('tour-layer--fallback');
    layer.innerHTML = '<div class="tour-spot" aria-hidden="true" hidden></div><div class="tour-bubble" role="dialog" aria-modal="false" aria-labelledby="tour-title" tabindex="-1" hidden></div><div class="tour-live sr-only" aria-live="polite"></div>';
    document.body.appendChild(layer);
    live = layer.querySelector('.tour-live');
    layer.addEventListener('click', onLayerClick);
    return layer;
  }
  const isOpen = () => { try { return layer?.matches(':popover-open'); } catch { return !layer?.hidden; } };
  // A popover is drawn above everything opened before it, but a modal dialog makes the rest of the page inert.
  // So the layer lives inside the topmost open modal dialog while one is open, and is re-shown (moved to the top
  // of the top layer) every time a dialog opens or closes.
  function raise() {
    if (!layer || (!run && !layer.dataset.mode)) return;
    const modals = [...document.querySelectorAll('dialog[open]')].filter(isModal);
    const host = modals.length ? modals[modals.length - 1] : document.body;
    const focused = layer.contains(document.activeElement);
    if (layer.parentElement !== host) { if (isOpen()) hidePop(); host.appendChild(layer); }
    if (isOpen()) hidePop();
    showPop();
    if (focused) focusBubble();
    schedule();
  }
  function showPop() { try { layer.showPopover(); } catch { layer.hidden = false; } }
  function hidePop() { try { layer.hidePopover(); } catch { layer.hidden = true; } }

  function watchDialogs() {
    if (dialogObserver) return;
    dialogObserver = new MutationObserver(muts => {
      if (!layer || (!run && !layer.dataset.mode)) return;
      if (muts.some(m => m.target.tagName === 'DIALOG' && m.attributeName === 'open')) queueMicrotask(raise);
    });
    dialogObserver.observe(document.documentElement, {subtree: true, attributes: true, attributeFilter: ['open']});
  }

  // ── geometry ───────────────────────────────────────────────────────────────────────────────────────────
  function schedule() { if (!rafId && layer) rafId = requestAnimationFrame(() => { rafId = 0; place(); }); }
  function place() {
    if (!layer || !isOpen()) return;
    const bubble = layer.querySelector('.tour-bubble'), spot = layer.querySelector('.tour-spot');
    if (bubble.hidden) return;
    const phone = isPhoneWidth(), vw = innerWidth, vh = innerHeight, gap = 14;
    const mode = layer.dataset.mode;
    if (target && !target.isConnected && run) { const again = find(run.steps[run.i]); if (again) target = again; }
    const tgt = mode === 'step' && visible(target) ? target : null;
    bubble.classList.toggle('is-sheet', phone);
    bubble.classList.toggle('is-centred', !tgt && !phone);
    bubble.style.left = bubble.style.top = bubble.style.right = bubble.style.bottom = '';
    bubble.removeAttribute('data-side');
    layer.toggleAttribute('data-dim', mode === 'step' && !tgt);
    if (!tgt) {
      spot.hidden = true;
      bubble.classList.toggle('is-top', false);
      return;
    }
    const r = clipRect(tgt), pad = 6;
    spot.hidden = false;
    Object.assign(spot.style, {left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px'});
    if (phone) {
      bubble.classList.toggle('is-top', r.top + r.height / 2 > vh / 2);
      return;
    }
    const b = bubble.getBoundingClientRect(), bw = b.width, bh = b.height;
    const room = {bottom: vh - r.bottom - gap, top: r.top - gap, right: vw - r.right - gap, left: r.left - gap};
    const fits = side => side === 'bottom' || side === 'top' ? room[side] >= bh + 8 : room[side] >= bw + 8;
    const pref = run?.steps[run.i]?.placement;
    const order = [...new Set([pref, 'bottom', 'top', 'right', 'left'].filter(Boolean))];
    const side = order.find(fits) || Object.entries(room).sort((a, c) => c[1] - a[1])[0][0];
    let x, y;
    if (side === 'bottom' || side === 'top') {
      x = Math.min(Math.max(12, r.left + r.width / 2 - bw / 2), vw - bw - 12);
      y = side === 'bottom' ? r.bottom + gap : r.top - gap - bh;
    } else {
      y = Math.min(Math.max(12, r.top + r.height / 2 - bh / 2), vh - bh - 12);
      x = side === 'right' ? r.right + gap : r.left - gap - bw;
    }
    y = Math.min(Math.max(8, y), Math.max(8, vh - bh - 8));
    x = Math.min(Math.max(8, x), Math.max(8, vw - bw - 8));
    bubble.style.left = Math.round(x) + 'px';
    bubble.style.top = Math.round(y) + 'px';
    bubble.dataset.side = side;
    const arrow = side === 'bottom' || side === 'top' ? r.left + r.width / 2 - x : r.top + r.height / 2 - y;
    const max = (side === 'bottom' || side === 'top' ? bw : bh) - 22;
    bubble.style.setProperty('--arrow', Math.round(Math.min(Math.max(22, arrow), max)) + 'px');
  }
  const onScroll = () => schedule();
  function listen(on) {
    const m = on ? 'addEventListener' : 'removeEventListener';
    window[m]('resize', onScroll);
    window[m]('scroll', onScroll, true);
    document[m]('keydown', onKey, true);
    if (on && typeof ResizeObserver === 'function' && !ro) ro = new ResizeObserver(() => schedule());
  }
  function observe(el) {
    if (!ro) return;
    ro.disconnect();
    if (el) ro.observe(el);
    const bubble = layer?.querySelector('.tour-bubble');
    if (bubble) ro.observe(bubble);
  }

  // The part of the editor sheet where a target is really visible: its scroll area minus the sticky
  // jump nav at the top and the sticky footer at the bottom. null outside the editor.
  function clipBox(el) {
    const ed = el?.closest?.('#editor');
    if (!ed) return null;
    let sc = el.parentElement;
    while (sc && sc !== ed) {
      const o = getComputedStyle(sc).overflowY;
      if ((o === 'auto' || o === 'scroll') && sc.scrollHeight > sc.clientHeight + 1) break;
      sc = sc.parentElement;
    }
    if (!sc) sc = ed;
    const r = sc.getBoundingClientRect();
    let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom), jumpH = 0, footH = 0;
    const jump = ed.querySelector('.editor-jump');
    if (jump && !jump.contains(el)) { const j = jump.getBoundingClientRect(); if (j.height && j.top <= top + 6 && j.bottom > top) { jumpH = j.bottom - top; top = j.bottom; } }
    const foot = ed.querySelector('.sheet-footer');
    if (foot && !foot.contains(el)) { const f = foot.getBoundingClientRect(); if (f.height && f.top < bottom && f.bottom >= bottom - 6) { footH = bottom - f.top; bottom = f.top; } }
    return {top, bottom, left: Math.max(0, r.left), right: Math.min(innerWidth, r.right), jumpH, footH};
  }
  function clipRect(el) {
    const r = el.getBoundingClientRect(), box = clipBox(el);
    if (!box) return r;
    const top = Math.max(r.top, box.top), bottom = Math.min(r.bottom, box.bottom), left = Math.max(r.left, box.left), right = Math.min(r.right, box.right);
    if (bottom - top < 4 || right - left < 4) return r;
    return {top, bottom, left, right, width: right - left, height: bottom - top};
  }

  // ── targets ────────────────────────────────────────────────────────────────────────────────────────────
  function find(step) {
    if (!step) return null;
    const all = [...document.querySelectorAll(step.target)];
    const list = all.filter(el => !layer?.contains(el));
    const pick = step.nth ? list.filter(visible)[step.nth] || list[step.nth] : list.find(visible) || list[0];
    return pick && visible(pick) ? pick : null;
  }
  function waitFor(step, ms, my) {
    return new Promise(resolve => {
      const hit = find(step);
      if (hit) return resolve(hit);
      let done = false;
      const finish = v => { if (done) return; done = true; mo.disconnect(); clearInterval(poll); clearTimeout(timer); resolve(v); };
      const check = () => { if (my !== token) return finish(null); const el = find(step); if (el) finish(el); };
      const mo = new MutationObserver(check);
      mo.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'open', 'style', 'data-tour']});
      const poll = setInterval(check, 120);
      const timer = setTimeout(() => finish(null), ms);
    });
  }
  const inSidebar = el => !!el?.closest('#sidebar, .sidebar');
  function setDrawer(open) {
    if (!isPhoneWidth()) return;
    const sb = document.querySelector('#sidebar');
    const isOpenNow = !!sb?.classList.contains('open');
    if (isOpenNow === open) return;
    if (typeof ctx.setMenu === 'function') ctx.setMenu(open);
    else document.querySelector('[data-tour="menu-button"], .mobile-menu')?.click();
    drawerByTour = open;
  }
  function closeTourDialogs() {
    for (const d of [...tourDialogs].reverse()) { try { if (d.open) d.close(); } catch { /* gone */ } }
    tourDialogs.clear();
  }
  function trackDialogs(before) {
    for (const d of document.querySelectorAll('dialog[open]')) if (!before.has(d) && d !== hub) tourDialogs.add(d);
  }
  function clickTarget(spec) {
    const sel = /^[a-zA-Z0-9_-]+$/.test(spec) ? `[data-tour="${spec}"]` : spec;
    let el = null;
    try { el = [...document.querySelectorAll(sel)].find(e => !layer?.contains(e) && !e.disabled); } catch { el = null; }
    if (!el) return false;
    el.click();
    return true;
  }
  // prepare and action share one vocabulary; neither ever saves.
  async function perform(spec) {
    if (!spec) return;
    const before = new Set(document.querySelectorAll('dialog[open]'));
    let m;
    if ((m = /^openEditor:([a-zA-Z]+):new$/.exec(spec))) {
      const ed = document.querySelector('#editor');
      if (ed?.open) { if (tourDialogs.has(ed)) ed.close(); else return; }
      ctx.openEditor?.(m[1], 'new', {demo: true, tour: true});
    } else if (spec === 'openDrawer') setDrawer(true);
    else if (spec === 'chooseImage') ctx.chooseImage?.(() => {}, {tour: true});
    else if (spec === 'selectFirstRow') {
      const row = document.querySelector('[data-tour="row-first"]');
      const box = row?.querySelector('[data-pl-select], .pl-check input[type="checkbox"], input[type="checkbox"]');
      if (box && !box.checked) box.click();
      else if (!box) clickTarget('select-toggle');
    } else if (spec === 'filterOneCategory') {
      // The product drag handles only show when the list is filtered to one category in shop order.
      const cat = document.querySelector('[data-pl-filter="cat"]');
      const first = cat && [...cat.options].find(o => o.value);
      if (cat && first && !cat.value) { cat.value = first.value; cat.dispatchEvent(new Event('change', {bubbles: true})); filteredByTour = true; }
      const sort = document.querySelector('[data-pl-sort]');
      if (sort && sort.value !== 'manual' && [...sort.options].some(o => o.value === 'manual')) { sort.value = 'manual'; sort.dispatchEvent(new Event('change', {bubbles: true})); filteredByTour = true; }
    } else if ((m = /^click:(.+)$/.exec(spec))) clickTarget(m[1]);
    await raf();
    trackDialogs(before);
    lastBefore = before;
    // Some dialogs open only after a request (the staff list). Keep noticing them for a few seconds,
    // so finish() and stop() can close them; one that opens after the tour ended is closed at once.
    let n = 0;
    const iv = setInterval(() => {
      for (const d of document.querySelectorAll('dialog[open]')) {
        if (before.has(d) || d === hub || tourDialogs.has(d)) continue;
        if (!run && layer?.dataset.mode !== 'step') { try { d.close(); } catch { /* gone */ } } else tourDialogs.add(d);
      }
      if (++n > 25) clearInterval(iv);
    }, 160);
  }
  // Undo what filterOneCategory changed on the products list.
  function clearTourFilter() {
    if (!filteredByTour) return;
    filteredByTour = false;
    const cat = document.querySelector('[data-pl-filter="cat"]');
    if (cat && cat.value) { cat.value = ''; cat.dispatchEvent(new Event('change', {bubbles: true})); }
  }

  // ── rendering ──────────────────────────────────────────────────────────────────────────────────────────
  function bubbleHtml({kicker, title, body, note, dots, buttons, missing}) {
    return `<button type="button" class="tour-x icon-button" data-tour-btn="close" aria-label="Close the tour">✕</button>
<div class="tour-bubble__mascot">${mascotImg(mascotSrc(), 56)}</div>
<div class="tour-bubble__main">
${kicker ? `<span class="eyebrow red tour-kicker">${esc(kicker)}</span>` : ''}
${missing ? `<p class="tour-missing">${esc(missing)}</p>` : ''}
<h2 id="tour-title">${esc(title)}</h2>
<p class="tour-body">${esc(body)}</p>
${note ? `<p class="tour-note">${esc(note)}</p>` : ''}
${dots || ''}
<div class="tour-actions">${buttons}</div>
</div><span class="tour-arrow" aria-hidden="true"></span>`;
  }
  const dotsHtml = (i, n) => `<div class="tour-dots" aria-hidden="true">${n <= 16 ? `<span class="tour-dots__row">${Array.from({length: n}, (_, k) => `<i class="${k === i ? 'on' : k < i ? 'past' : ''}"></i>`).join('')}</span>` : ''}<span class="tour-dots__count">${i + 1} / ${n}</span></div>`;
  function focusBubble() {
    const b = layer?.querySelector('.tour-bubble');
    if (!b || b.hidden) return;
    const btn = ['[data-tour-btn="next"]', '[data-tour-btn="start"]', '[data-tour-start]', '[data-tour-btn="action"]', 'button'].map(q => b.querySelector(q)).find(Boolean);
    try { (btn || b).focus({preventScroll: true}); } catch { /* ignore */ }
  }
  function paint(mode, html, announce, {animate = true} = {}) {
    ensureLayer();
    layer.dataset.mode = mode;
    const bubble = layer.querySelector('.tour-bubble');
    bubble.innerHTML = html;
    bubble.hidden = false;
    bubble.classList.toggle('is-greeting', mode === 'greet');
    bubble.classList.remove('enter');
    if (animate && !reduced()) { void bubble.offsetWidth; bubble.classList.add('enter'); }
    raise();
    if (announce) live.textContent = announce;
    observe(mode === 'step' ? target : null);
    place();
    requestAnimationFrame(place);
    focusBubble();
  }

  async function show(i) {
    if (!run) return;
    const my = ++token;
    run.i = Math.max(0, Math.min(i, run.steps.length - 1));
    const step = run.steps[run.i];
    saveProgress(markStep(progress(), run.chapter.id, run.i));
    writeRun(session, {chapter: run.chapter.id, step: run.i, staffId: staffId()});

    // 1. a step that works inside an open dialog (editor, picker…) keeps it when its target is already there
    let el = step.prepare ? find(step) : null;
    if (!el) {
      if (!step.prepare) closeTourDialogs();
      // 2. route
      const navKey = step.route + '/' + (step.sub || '');
      const here = (typeof location !== 'undefined' ? location.hash.slice(1).split('?')[0] : '') === step.route;
      if (step.route && (navKey !== lastNav || !here)) {
        closeTourDialogs();
        try { ctx.go?.(step.route, step.sub); } catch { /* keep touring */ }
        lastNav = navKey;
        await raf();
        if (my !== token) return;
      }
      // 3. prepare, unless the target is already on screen
      el = find(step);
      if (!el && step.prepare) {
        closeTourDialogs();
        await perform(step.prepare);
        if (my !== token) return;
      }
    }
    // 4. phone drawer for nav targets
    if (!el && isPhoneWidth()) {
      const inDrawer = document.querySelector(step.target);
      if (inDrawer && inSidebar(inDrawer)) setDrawer(true);
    }
    if (!el) {
      // while we look (up to 2.5s), show the step centred so the screen never looks frozen
      const early = setTimeout(() => { if (my === token && run) { target = null; paintStep(step, null, {waiting: true}); } }, 350);
      el = await waitFor(step, step.action ? 900 : 2500, my);
      clearTimeout(early);
    }
    if (my !== token) return;
    if (lastBefore) trackDialogs(lastBefore);
    if (drawerByTour && !inSidebar(el)) setDrawer(false);
    const box = el ? clipBox(el) : null;
    if (el && box) {
      // Inside the editor sheet: scroll its own area so the target clears the sticky nav and footer.
      const r = el.getBoundingClientRect(), room = box.bottom - box.top;
      const phone = isPhoneWidth();
      const limit = phone ? Math.min(box.bottom, box.top + room * 0.55) : box.bottom;
      if (r.top < box.top + 4 || r.bottom > limit - 4) {
        const keepT = el.style.scrollMarginTop, keepB = el.style.scrollMarginBottom;
        el.style.scrollMarginTop = Math.round(Math.max(box.jumpH + 8, phone ? innerHeight * 0.06 : 8)) + 'px';
        el.style.scrollMarginBottom = Math.round(box.footH + 8) + 'px';
        try { el.scrollIntoView({block: phone || r.height > room * 0.6 ? 'start' : 'center', inline: 'nearest', behavior: 'auto'}); } catch { /* old browsers */ }
        el.style.scrollMarginTop = keepT; el.style.scrollMarginBottom = keepB;
      }
      await raf();
      if (my !== token) return;
    } else if (el) {
      const r = el.getBoundingClientRect();
      const out = r.top < 70 || r.bottom > innerHeight - (isPhoneWidth() ? innerHeight * 0.45 : 40) || r.left < 0 || r.right > innerWidth;
      if (isPhoneWidth()) {
        // phone: park the target near the top so the bottom sheet does not cover it; when the page cannot scroll
        // that far, place() flips the sheet to the top instead
        const keep = el.style.scrollMarginTop;
        el.style.scrollMarginTop = Math.round(innerHeight * 0.14) + 'px';
        try { el.scrollIntoView({block: 'start', inline: 'nearest', behavior: 'auto'}); } catch { /* old browsers */ }
        el.style.scrollMarginTop = keep;
      } else if (out) { try { el.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'auto'}); } catch { /* old browsers */ } }
      await raf();
      if (my !== token) return;
    }
    paintStep(step, el);
  }
  function paintStep(step, el, {waiting = false} = {}) {
    const n = run.steps.length, last = run.i === n - 1;
    const deskCard = !!el && isPhoneWidth() && step.desktopOnly;
    const missing = waiting ? 'Finding it on your screen…' : !el ? (step.action ? '' : MICROCOPY.missingTarget) : deskCard ? MICROCOPY.phoneOnlyCard : '';
    const buttons = [
      step.action && !el ? `<button type="button" class="btn ghost tiny tour-do" data-tour-btn="action">${esc(step.actionLabel || 'Do it for me')}</button>` : '',
      run.i > 0 ? `<button type="button" class="btn ghost tiny" data-tour-btn="back">Back</button>` : '',
      `<button type="button" class="btn primary tiny" data-tour-btn="next">${last ? 'Finish' : (!el && !waiting && !step.action ? 'Skip' : 'Next')}</button>`
    ].join('') + `<span class="tour-links"><button type="button" class="tour-link" data-tour-btn="skip">Skip chapter</button></span>`;
    target = deskCard ? null : el;
    paint('step', bubbleHtml({kicker: run.chapter.title, title: step.title, body: step.body, note: (!el && !waiting) || deskCard ? step.note : '', missing, dots: dotsHtml(run.i, n), buttons}), waiting ? '' : `Step ${run.i + 1} of ${n}: ${step.title}. ${step.body}`, {animate: !waiting});
  }

  function start(chapterId, step = 0) {
    const chapter = chapterById(chapterId);
    const steps = chapter ? filterSteps(chapterId, filterOpts()) : [];
    if (!steps.length) { ctx.toast?.('That part of the tour is not available for your account.'); return false; }
    if (hub?.open) hub.close();
    const fresh = !run;
    run = {chapter, steps, i: 0};
    if (fresh) { lastNav = ''; listen(true); watchDialogs(); }
    ensureLayer();
    show(Math.min(Math.max(0, step | 0), steps.length - 1));
    return true;
  }
  function stop({keepSession = false} = {}) {
    token++;
    if (!keepSession) writeRun(session, null);
    closeTourDialogs();
    clearTourFilter();
    lastBefore = null;
    if (drawerByTour) setDrawer(false);
    drawerByTour = false;
    run = null; target = null;
    if (layer) {
      delete layer.dataset.mode;
      layer.removeAttribute('data-dim');
      if (isOpen()) hidePop();
      if (layer.parentElement !== document.body) document.body.appendChild(layer);
      layer.querySelector('.tour-bubble').hidden = true;
      layer.querySelector('.tour-spot').hidden = true;
    }
    listen(false);
    ro?.disconnect();
  }
  function nextChapterAfter(id) {
    const list = chaptersFor({role: role(), canPublish: canPublish()});
    const p = progress();
    const idx = list.findIndex(c => c.id === id);
    return list.slice(idx + 1).find(c => !p.chapters[c.id]?.done) || null;
  }
  function finish() {
    if (!run) return;
    const ch = run.chapter;
    saveProgress(markDone(progress(), ch.id));
    writeRun(session, null);
    closeTourDialogs();
    clearTourFilter();
    lastBefore = null;
    if (drawerByTour) setDrawer(false);
    const nxt = nextChapterAfter(ch.id);
    run = null; target = null; token++;
    const buttons = `${nxt ? `<button type="button" class="btn primary tiny" data-tour-start="${esc(nxt.id)}">Next: ${esc(nxt.title)}</button>` : ''}<button type="button" class="btn ${nxt ? 'ghost' : 'primary'} tiny" data-tour-start="hub">All chapters</button><button type="button" class="btn ghost tiny" data-tour-btn="close">Done</button>`;
    paint('done', bubbleHtml({kicker: ch.title, title: 'Chapter done!', body: nxt ? `Nice riding. Want to carry on with ${nxt.title}?` : 'Nice riding. You have seen everything in this chapter.', buttons}), `${ch.title} finished.`);
  }
  const next = () => { if (!run) return; if (run.i >= run.steps.length - 1) finish(); else show(run.i + 1); };
  const back = () => { if (run && run.i > 0) show(run.i - 1); };
  function skipChapter() {
    if (!run) return;
    const nxt = nextChapterAfter(run.chapter.id);
    stop();
    if (nxt) start(nxt.id);
  }
  async function doAction() {
    if (!run) return;
    const step = run.steps[run.i], my = token;
    await perform(step.action);
    const el = await waitFor(step, 2500, my);
    if (lastBefore) trackDialogs(lastBefore);
    if (my !== token) return;
    if (el) show(run.i); else ctx.toast?.("I couldn't do that here. Try it yourself, then tap Next.");
  }

  // ── greeting ───────────────────────────────────────────────────────────────────────────────────────────
  function greet() {
    const p = progress();
    if (p.greeted || run) return false;
    if (!chaptersFor({role: role(), canPublish: canPublish()}).length) return false;
    listen(true); watchDialogs();
    target = null;
    paint('greet', bubbleHtml({title: MICROCOPY.greetingTitle, body: MICROCOPY.greetingBody, buttons: '<button type="button" class="btn primary tiny" data-tour-btn="start">Start the tour</button><button type="button" class="btn ghost tiny" data-tour-btn="later">Later</button>'}), MICROCOPY.greetingTitle + ' ' + MICROCOPY.greetingBody);
    return true;
  }
  function markGreeted() { saveProgress({...progress(), greeted: true}); }

  // ── events ─────────────────────────────────────────────────────────────────────────────────────────────
  function onLayerClick(e) {
    const b = e.target.closest('[data-tour-btn]');
    if (!b) return;
    const what = b.dataset.tourBtn;
    if (what === 'next') next();
    else if (what === 'back') back();
    else if (what === 'skip') skipChapter();
    else if (what === 'action') doAction();
    else if (what === 'close') { if (layer?.dataset.mode === 'greet') markGreeted(); stop(); }
    else if (what === 'start') { markGreeted(); stop(); start('getting-around'); }
    else if (what === 'later') { markGreeted(); stop(); ctx.toast?.('No problem. Tap the ? button any time for the tour.'); }
  }
  function onKey(e) {
    if (!layer?.dataset.mode) return;
    const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (layer.dataset.mode === 'greet') markGreeted();
      stop();
      return;
    }
    if (typing || layer.dataset.mode !== 'step') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
  }
  function currentSub() {
    const tab = document.querySelector('.subtabs .active, [data-tour^="tab-"].active, [data-tour^="tab-"][aria-selected="true"]');
    return tab?.dataset.sub || (tab?.dataset.tour || '').replace(/^tab-/, '') || undefined;
  }
  function explain({route, sub, editorType} = {}) {
    const ed = document.querySelector('#editor');
    const r = route || (typeof location !== 'undefined' ? location.hash.slice(1).split('?')[0] : '') || 'home';
    const type = editorType || (ed?.open ? ed.dataset.type || ctx.editorType : undefined);
    let id = chapterForRoute(r, sub || currentSub(), {editorType: type});
    if (!filterSteps(id, filterOpts()).length) id = 'getting-around';
    if (type && ed?.open) lastNav = (chapterById(id)?.route || '') + '/' + (chapterById(id)?.sub || '');
    return start(id);
  }
  function onDocClick(e) {
    const el = e.target.closest?.('[data-tour-start], [data-tour="explain"], [data-tour="topbar-tour"], [data-tour-reset]');
    if (!el) return;
    if (el.hasAttribute('data-tour-reset')) { e.preventDefault(); reset(); ctx.toast?.('Tour progress reset. I will greet you again next time.'); return; }
    const v = el.getAttribute('data-tour-start') || (el.dataset.tour === 'explain' ? 'auto' : 'hub');
    e.preventDefault();
    if (layer?.dataset.mode === 'greet') markGreeted();
    if (v === 'hub') { stop(); openHub(); return; }
    if (v === 'auto') { stop(); explain({editorType: el.dataset.editorType}); return; }
    stop();
    start(v, Number(el.getAttribute('data-tour-step')) || 0);
  }
  document.addEventListener('click', onDocClick);

  // ── hub ────────────────────────────────────────────────────────────────────────────────────────────────
  function openHub() {
    if (!hub?.isConnected) {
      hub = document.createElement('dialog');
      hub.id = 'tour-hub';
      hub.className = 'modal tour-hub';
      hub.setAttribute('aria-labelledby', 'tour-hub-title');
      document.body.appendChild(hub);
      bindHub(ctx, hub, api);
    }
    hub.innerHTML = renderHub(ctx, {chapters: chaptersFor({role: role(), canPublish: canPublish()}), progress: progress(), mascotSrc: mascotSrc(), phone: isPhoneWidth()});
    if (!hub.open) { try { hub.showModal(); } catch { hub.setAttribute('open', ''); } }
    hub.querySelector('[data-tour-start]')?.focus({preventScroll: true});
  }
  function reset() { clearProgress(storage, staffId()); writeRun(session, null); if (hub?.open) openHub(); }
  function restartAll() { const p = progress(); saveProgress({greeted: p.greeted, chapters: {}}); if (hub?.open) openHub(); }
  function resume() {
    const r = readRun(session);
    if (!r || (r.staffId != null && String(r.staffId) !== String(staffId()))) return false;
    return start(r.chapter, r.step);
  }
  function destroy() { stop(); document.removeEventListener('click', onDocClick); dialogObserver?.disconnect(); dialogObserver = null; layer?.remove(); hub?.remove(); layer = hub = null; }

  const api = {
    start, explain, resume, greet, openHub, stop: () => stop(), next, back, skipChapter, raise, reset, restartAll, destroy,
    progress, running: () => !!run, current: () => run ? {chapter: run.chapter.id, step: run.i, total: run.steps.length, id: run.steps[run.i]?.id, anchor: anchorOf(run.steps[run.i])} : null
  };
  return api;
}
