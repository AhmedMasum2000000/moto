import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CHAPTERS, STEPS, SECTIONS, anchorOf, anchorsUsed, chaptersFor, stepsFor, chapterForRoute, searchChapters, allowed} from '../control-room/tour/steps.mjs';
import {readProgress, writeProgress, clearProgress, readRun, writeRun, markStep, markDone, progressKey, RUN_KEY} from '../control-room/tour/tour.mjs';
import {renderHub, explainButtonHtml, chapterResultsHtml, mascotImg} from '../control-room/tour/hub.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = p => existsSync(root + p) ? readFileSync(root + p, 'utf8') : '';
const memory = (init = {}) => { const m = new Map(Object.entries(init)); return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m}; };

test('step ids are unique and every chapter has steps', () => {
  const ids = STEPS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate step id');
  assert.equal(new Set(CHAPTERS.map(c => c.id)).size, CHAPTERS.length);
  for (const c of CHAPTERS) {
    assert.ok(c.steps.length > 0, c.id + ' is empty');
    assert.ok(SECTIONS.some(s => s.id === c.section), c.id + ' has an unknown section');
    assert.ok(c.title && c.blurb && c.keywords.length, c.id + ' needs a title, blurb and keywords');
  }
  assert.equal(CHAPTERS.length, 16);
});

test('every step targets a data-tour anchor, with short plain text', () => {
  for (const s of STEPS) {
    assert.match(s.target, /^\[data-tour="[a-zA-Z0-9_-]+"\]$/, s.id + ' target');
    assert.ok(anchorOf(s), s.id);
    assert.ok(s.title.length > 0 && s.title.length <= 60, s.id + ' title length ' + s.title.length);
    assert.ok(s.body.length > 0 && s.body.length <= 280, s.id + ' body length ' + s.body.length);
    assert.doesNotMatch(s.title + s.body + (s.note || ''), /[<>]/, s.id + ' must be plain text');
    assert.ok(s.route, s.id + ' needs a route');
    for (const v of [s.prepare, s.action]) if (v) assert.match(v, /^(openEditor:[a-zA-Z]+:new|openDrawer|selectFirstRow|filterOneCategory|chooseImage|click:.+)$/, s.id + ' prepare/action ' + v);
  }
  assert.ok(STEPS.some(s => s.action), 'at least one "Do it for me" step');
});

// Scans the files the Integrator wires anchors into. A literal data-tour="x" counts; so does a quoted 'x' token in
// a file that builds data-tour from a variable (data-tour="${...}"), and tab-<sub> when the file builds
// data-tour="tab-${...}" and mentions the sub id.
function anchorSources() {
  const files = ['control-room/app.js', 'control-room/index.html', 'control-room/tour/hub.mjs',
    ...(existsSync(root + 'control-room/ui') ? readdirSync(root + 'control-room/ui').filter(f => f.endsWith('.mjs')).map(f => 'control-room/ui/' + f) : [])];
  return files.map(f => ({f, src: read(f)})).filter(x => x.src);
}
function missingAnchors(names = [...anchorsUsed()]) {
  const sources = anchorSources();
  const has = name => sources.some(({src}) => {
    if (src.includes(`data-tour="${name}"`) || src.includes(`data-tour='${name}'`) || src.includes(`'data-tour', '${name}'`) || src.includes(`'data-tour','${name}'`)) return true;
    const dynamic = /data-tour=["']?\$\{/.test(src) || /data-tour=["']?'\s*\+/.test(src) || /setAttribute\(\s*['"]data-tour['"]\s*,\s*[a-zA-Z_$]/.test(src);
    const quoted = new RegExp(`['"\`]${name}['"\`]`).test(src);
    if (dynamic && quoted) return true;
    const pre = /data-tour=["']([a-z]+-)\$\{/g; let m;
    while ((m = pre.exec(src))) if (name.startsWith(m[1]) && new RegExp(`['"\`]${name.slice(m[1].length)}['"\`]`).test(src)) return true;
    return false;
  });
  return names.filter(n => !has(n)).sort();
}

test('every anchor the tour uses exists in app.js, index.html or ui/*.mjs', t => {
  const missing = missingAnchors();
  const integrated = /tour\/tour\.mjs/.test(read('control-room/app.js'));
  const msg = `${missing.length} data-tour anchor(s) missing (add them in control-room/app.js, index.html or ui/*.mjs):\n  ${missing.join('\n  ')}`;
  if (missing.length && !integrated) {
    // Wave 1: the Integrator has not wired the tour into app.js yet, so the shell anchors cannot exist.
    t.todo(msg);
    t.diagnostic(msg);
    return;
  }
  assert.deepEqual(missing, [], msg);
});

test('role filter: service, editor, publisher, phone', () => {
  const service = chaptersFor({role: 'service'}).map(c => c.id);
  // Service staff load no website draft (moto-admin load returns only requests), so they only have Requests and Store settings.
  assert.deepEqual(service, ['getting-around', 'requests', 'settings']);
  for (const c of chaptersFor({role: 'service'})) for (const s of c.steps) assert.ok(!s.roles || s.roles.includes('service'), s.id);
  assert.deepEqual(stepsFor('settings', {role: 'service'}).map(s => s.id), ['set-password'], 'service only sees their own sign-in');

  const editor = chaptersFor({role: 'editor'}).flatMap(c => c.steps).map(s => anchorOf(s));
  assert.ok(!editor.includes('team-list') && !editor.includes('history-list'), 'editors skip team and history');
  assert.ok(!editor.includes('publish-button') && !editor.includes('topbar-publish'), 'editor without publish right');
  const publisher = chaptersFor({role: 'editor', canPublish: true}).flatMap(c => c.steps).map(s => anchorOf(s));
  assert.ok(publisher.includes('publish-button') && publisher.includes('topbar-publish'));
  assert.ok(!publisher.includes('team-list'));
  const owner = chaptersFor({role: 'owner'}).flatMap(c => c.steps).map(s => anchorOf(s));
  assert.ok(owner.includes('team-list') && owner.includes('history-list') && owner.includes('publish-button'));
  assert.equal(chaptersFor({role: 'owner'}).length, CHAPTERS.length);

  assert.ok(stepsFor('getting-around', {role: 'owner', phone: true}).some(s => anchorOf(s) === 'menu-button'));
  assert.ok(!stepsFor('getting-around', {role: 'owner', phone: false}).some(s => anchorOf(s) === 'menu-button'), 'phone-only step skipped on desktop');
  assert.equal(allowed(null), false);
  assert.deepEqual(stepsFor('nope', {role: 'owner'}), []);
});

test('progress storage survives corrupt JSON, missing storage and throwing storage', () => {
  const empty = {greeted: false, chapters: {}};
  assert.deepEqual(readProgress(memory({[progressKey('u1')]: '{not json'}), 'u1'), empty);
  assert.deepEqual(readProgress(memory({[progressKey('u1')]: '[1,2]'}), 'u1'), empty);
  assert.deepEqual(readProgress(memory({[progressKey('u1')]: 'null'}), 'u1'), empty);
  assert.deepEqual(readProgress(null, 'u1'), empty);
  const boom = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); }};
  assert.deepEqual(readProgress(boom, 'u1'), empty);
  assert.equal(writeProgress(boom, 'u1', empty), false);
  assert.doesNotThrow(() => clearProgress(boom, 'u1'));
  assert.doesNotThrow(() => writeRun(boom, {chapter: 'home', step: 1}));
  assert.equal(readRun(boom), null);

  // unknown chapters and bad step values are cleaned
  const dirty = memory({[progressKey('u1')]: JSON.stringify({greeted: true, chapters: {home: {done: true, step: 2, at: 5}, ghost: {done: true}, products: {step: -4}, layout: 'x'}})});
  assert.deepEqual(readProgress(dirty, 'u1'), {greeted: true, chapters: {home: {done: true, step: 2, at: 5}, products: {done: false, step: 0, at: 0}}});

  // round trip, per staff member
  const s = memory();
  let p = markStep(readProgress(s, 'a'), 'products', 3, 10);
  writeProgress(s, 'a', p);
  assert.deepEqual(readProgress(s, 'a').chapters.products, {done: false, step: 3, at: 10});
  assert.deepEqual(readProgress(s, 'b'), empty, 'progress is per staff user');
  p = markDone(readProgress(s, 'a'), 'products', 11);
  assert.deepEqual(p.chapters.products, {done: true, step: 0, at: 11});
  assert.equal(progressKey('a'), 'moto-tour:v1:a');

  const ss = memory();
  writeRun(ss, {chapter: 'layout', step: 4, staffId: 'a'});
  assert.deepEqual(readRun(ss), {chapter: 'layout', step: 4, staffId: 'a'});
  ss.setItem(RUN_KEY, '{"chapter":"ghost","step":1}');
  assert.equal(readRun(ss), null);
  ss.setItem(RUN_KEY, '{oops');
  assert.equal(readRun(ss), null);
  writeRun(ss, null);
  assert.equal(ss.getItem(RUN_KEY), null);
});

test('search finds chapters and explain maps routes to chapters', () => {
  assert.equal(searchChapters('add subcategory', {role: 'owner'})[0]?.id, 'categories');
  assert.equal(searchChapters('csv', {role: 'owner'})[0]?.id, 'products');
  assert.equal(searchChapters('publish', {role: 'owner'}).length > 0, true);
  assert.deepEqual(searchChapters('x', {role: 'owner'}), []);
  assert.ok(!searchChapters('add subcategory', {role: 'service'}).some(c => c.id === 'categories'), 'search respects roles');
  assert.equal(chapterForRoute('products', 'categories'), 'categories');
  assert.equal(chapterForRoute('products', 'products'), 'products');
  assert.equal(chapterForRoute('website', 'layout'), 'layout');
  assert.equal(chapterForRoute('website', 'banners'), 'website-tabs');
  assert.equal(chapterForRoute('requests'), 'requests');
  assert.equal(chapterForRoute('home', undefined, {editorType: 'product'}), 'product-editor');
  assert.equal(chapterForRoute('nowhere'), 'getting-around');
});

test('hub and helpers escape text', () => {
  const evil = {...CHAPTERS[0], id: 'x"><script>', title: '<img src=x onerror=alert(1)>', blurb: '"&\'', steps: CHAPTERS[0].steps};
  const html = renderHub({}, {chapters: [evil], progress: {chapters: {}}});
  assert.ok(!html.includes('<img src=x') && !html.includes('<script>'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(chapterResultsHtml({}, [evil]).includes('&lt;img'));
  assert.ok(explainButtonHtml({}, {chapter: '"><b>'}).includes('&quot;&gt;&lt;b&gt;'));
  assert.ok(mascotImg('assets/mascot/guide.webp', 96).includes('mascot--96'));
  const resumed = renderHub({}, {chapters: chaptersFor({role: 'owner'}), progress: {chapters: {products: {done: false, step: 4}, home: {done: true, step: 0}}}});
  assert.match(resumed, /Resume step 5/);
  assert.match(resumed, /1 of 16 chapters done/);
});

test('the mascot is one file: guide.webp is a byte copy of cookie-rider.webp', () => {
  const a = readFileSync(root + 'assets/mascot/cookie-rider.webp'), b = readFileSync(root + 'control-room/assets/mascot/guide.webp');
  assert.ok(a.equals(b));
});
