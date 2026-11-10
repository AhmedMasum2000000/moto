import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as cheerio from 'cheerio';
import {defaultSections} from '../cms/content-defaults.mjs';
import {sections as htmlSections} from '../cms/text-defaults-html.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'cms/initial-content.json'), 'utf8'));
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
const load = file => cheerio.load(fs.readFileSync(path.join(root, file), 'utf8'));
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const seedIds = new Set(seed.content.flatMap(s => s.fields.map(f => f.id)));
const knownIds = new Set([...seedIds, ...defaultSections.flatMap(s => s.fields.map(f => f.id))]);

test('every data-cms-text / data-cms-placeholder key in the pages has a field', () => {
  const missing = [];
  for (const file of pages) {
    const $ = load(file);
    $('[data-cms-text]').each((_, el) => { const k = $(el).attr('data-cms-text'); if (!knownIds.has(k)) missing.push(`${file}: ${k}`); });
    $('[data-cms-placeholder]').each((_, el) => { const k = $(el).attr('data-cms-placeholder'); if (!knownIds.has(k)) missing.push(`${file}: ${k}`); });
  }
  assert.deepEqual(missing, []);
});

test('html default fields are well formed, unique and new', () => {
  const pagesAllowed = new Set(['index', 'shop', 'book']);
  const seen = new Set();
  for (const section of htmlSections) {
    assert.ok(pagesAllowed.has(section.page), section.id);
    const existing = seed.content.find(s => s.id === section.id);
    if (existing) assert.equal(existing.page, section.page, `${section.id} page`);
    for (const f of section.fields) {
      assert.equal(f.kind, 'text');
      assert.ok(f.label && f.value, f.id);
      assert.ok(!seen.has(f.id), `duplicate ${f.id}`);
      assert.ok(!seedIds.has(f.id), `${f.id} already exists in the seed`);
      seen.add(f.id);
    }
  }
  const all = defaultSections.flatMap(s => s.fields.map(f => f.id));
  assert.equal(new Set(all).size, all.length, 'field ids are unique across all default sections');
});

test('each html default equals the text the page shows today', () => {
  const docs = Object.fromEntries(['index.html', 'shop.html', 'book.html', 'posts.html', 'page.html'].map(f => [f, load(f)]));
  for (const section of htmlSections) for (const f of section.fields) {
    let found = 0;
    for (const [file, $] of Object.entries(docs)) {
      $(`[data-cms-text="${f.id}"]`).each((_, el) => { found++; assert.equal(norm($(el).text()), f.value, `${file} ${f.id}`); });
      $(`[data-cms-placeholder="${f.id}"]`).each((_, el) => { found++; assert.equal($(el).attr('placeholder'), f.value, `${file} ${f.id}`); });
    }
    assert.ok(found > 0, `${f.id} is used on a page`);
  }
});

test('shared texts are wired on every page that shows them', () => {
  for (const file of pages) {
    const $ = load(file);
    const has = id => $(`[data-cms-text="${id}"],[data-cms-placeholder="${id}"]`).length > 0;
    for (const id of ['actionbar-call', 'actionbar-call-sub', 'actionbar-wa', 'actionbar-wa-sub', 'search-placeholder', 'search-hint'])
      assert.ok(has(id), `${file} ${id}`);
    if ($('.actionbar .is-primary').length) assert.ok(has('actionbar-book') && has('actionbar-book-sub'), `${file} book`);
    if ($('.drawer').length) assert.ok(has('cart-title') && has('cart-total-label'), `${file} cart`);
    $('.footer__word text').each((_, el) => assert.ok($(el).attr('data-cms-text')?.startsWith('wordmark-'), `${file} wordmark`));
    $('.footer__sister').each((_, el) => {
      const b = $('b', el);
      assert.equal(b.attr('data-cms-setting'), 'parentCompany', `${file} sister`);
      assert.equal(b.text(), 'Motolube Bangladesh');
    });
  }
});

test('journal and custom-page footers reuse the homepage footer fields', () => {
  for (const file of ['posts.html', 'post.html', 'blog.html', 'page.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(html, /(journal|page)-footer-t\d/, file);
    const $ = load(file);
    assert.equal($('[data-cms-text="index-t209"]').text(), '©');
    assert.equal($('[data-cms-text="index-t210"]').text(), 'Moto Market · Kushtia, Bangladesh');
  }
});

test('phone links stay outside the editable text spans', () => {
  for (const id of ['shop-note', 'shop-empty']) {
    const $ = load('shop.html');
    const el = $(`[data-cms-text="${id}"]`);
    assert.equal(el.children().length, 0, id);
    assert.equal(el.parent().find('a[href^="tel:"]').length, 1, id);
  }
});

test('no new data-cms-section ids were added to the pages', () => {
  const sectionIds = new Set(seed.content.map(s => s.id));
  for (const file of pages) {
    const $ = load(file);
    $('[data-cms-section]').each((_, el) => assert.ok(sectionIds.has($(el).attr('data-cms-section')), `${file} ${$(el).attr('data-cms-section')}`));
  }
});

test('every built-in layout section exists on its page and each page has a generated-sections mount', async () => {
  const {BUILTINS, isPinned} = await import('../cms/content-model.mjs');
  for (const [page, ids] of Object.entries(BUILTINS)) {
    const $ = load(page + '.html');
    assert.equal($(`main [data-cms-sections="${page}"]`).length, 1, `${page} mount`);
    for (const id of ids) {
      const el = $(`[data-cms-section="${id}"]`);
      assert.equal(el.length, 1, `${page}: ${id}`);
      // movable parts are direct children of <main>, so the layout pass can reorder them
      if (!isPinned(id)) assert.equal(el.parent().prop('tagName'), 'MAIN', `${page}: ${id} sits directly in main`);
    }
  }
});
