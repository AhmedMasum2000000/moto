// Pure parts of the structure and media UI (control-room/ui/layout.mjs, brand-groups.mjs, photos.mjs, io.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateContent} from '../supabase/functions/moto-admin/schema.mjs';
import {normalise, resolveLayout} from '../cms/content-model.mjs';
import {layoutRows, sectionDefaults, readSectionForm, KIND_PRESETS, sourceSummary, renderLayout, sectionFields, renderStructureCard} from '../control-room/ui/layout.mjs';
import {addBrandGroup, renderBrandGroups, groupOptions} from '../control-room/ui/brand-groups.mjs';
import {usageIndex, replaceRefs, libraryItems, renderPhotos, chooserHtml, mediaAlt} from '../control-room/ui/photos.mjs';
import {importFromText, importPreviewHtml, renderIoButtons} from '../control-room/ui/io.mjs';
import {deleteRecordIn} from '../control-room/lib/records.mjs';

const seed = () => JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json', import.meta.url)));
const ctxOf = (data, extra = {}) => ({data, role: 'owner', esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])), imageUrl: r => r, icon: () => '', media: [], mediaUrls: {}, ...extra});
const form = entries => { const f = new FormData(); for (const [k, v] of entries) f.append(k, v); return f; };

test('layout rows: pinned top and bottom around the saved order, for an old document too', () => {
  const rows = layoutRows(seed(), 'index');
  assert.equal(rows[0].ref, 'builtin:index-fitment'); assert(rows[0].pinned);
  assert.equal(rows.at(-1).ref, 'builtin:index-section-5'); assert(rows.at(-1).pinned);
  assert.deepEqual(rows.filter(r => !r.pinned).map(r => r.ref), resolveLayout(normalise(seed()), 'index'));
  const old = seed(); delete old.layout; delete old.sections; delete old.brandGroups;
  assert.equal(layoutRows(old, 'shop').filter(r => !r.pinned).length, 3);
});

test('every Add-section preset produces a section that validates once placed in the layout', () => {
  for (const p of KIND_PRESETS) for (const page of ['index', 'shop']) {
    const d = normalise(seed()), s = sectionDefaults(d, {page, preset: p.id});
    d.sections.push(s); d.layout[page].push('section:' + s.id);
    assert.doesNotThrow(() => validateContent(d), p.id + ' on ' + page);
    assert.ok(sourceSummary(d, s).length > 0);
  }
});

test('the section form inserts at the chosen position, moves between pages and validates', () => {
  const data = seed(), ctx = ctxOf(data), rec = sectionDefaults(data, {page: 'index', preset: 'deals'});
  const f = form([['kind', 'carousel'], ['page', 'index'], ['title', 'Deals <b>now</b>'], ['after', '__top'], ['sourceType', 'sale'], ['limit', '30'], ['sort', 'save'], ['visible', 'on'], ['buttonLabel', 'All deals'], ['buttonTarget', 'oil']]);
  const {next, section, label} = readSectionForm(ctx, f, rec, {isNew: true});
  assert.equal(label, 'Added section Deals <b>now</b>');
  assert.equal(next.layout.index[0], 'section:' + rec.id);
  assert.equal(section.limit, 24, 'limit is clamped to 24');
  assert.deepEqual(section.source, {type: 'sale'});
  assert.deepEqual(section.button, {label: 'All deals', target: 'oil'});
  validateContent(next);
  // Edit: move it to the shop after the catalogue.
  const ctx2 = ctxOf(next), f2 = form([['kind', 'grid'], ['page', 'shop'], ['title', 'Deals'], ['after', 'builtin:shop-catalog'], ['sourceType', 'products'], ['productIds', [next.products[1].id, 'missing', next.products[0].id].join(',')], ['limit', '6'], ['sort', 'manual']]);
  const r2 = readSectionForm(ctx2, f2, next.sections[0]);
  assert(!r2.next.layout.index.includes('section:' + rec.id));
  assert.equal(r2.next.layout.shop[1], 'section:' + rec.id);
  assert.deepEqual(r2.section.source.productIds, [next.products[1].id, next.products[0].id]);
  validateContent(r2.next);
});

test('FAQ, text and kits sections read their own fields only', () => {
  const data = seed(), ctx = ctxOf(data);
  const faq = readSectionForm(ctx, form([['kind', 'faq'], ['page', 'index'], ['title', 'FAQ'], ['faq-q', 'Open on Friday?'], ['faq-a', 'Yes'], ['faq-q', ''], ['faq-a', 'dropped'], ['sourceType', 'sale']]), sectionDefaults(data, {preset: 'faq'}), {isNew: true});
  assert.deepEqual(faq.section.items, [{q: 'Open on Friday?', a: 'Yes'}]);
  assert.equal(faq.section.source, undefined);
  validateContent(faq.next);
  const text = readSectionForm(ctx, form([['kind', 'text'], ['page', 'shop'], ['title', 'About'], ['body', '## Hello\n\nWorld']]), sectionDefaults(data, {preset: 'text'}), {isNew: true});
  assert.equal(text.section.body, '## Hello\n\nWorld');
  validateContent(text.next);
});

test('layout and editor markup escape staff text', () => {
  const d = normalise(seed()), s = sectionDefaults(d, {preset: 'promo'});
  s.title = '<img src=x onerror=alert(1)>'; d.sections.push(s); d.layout.index.push('section:' + s.id);
  const ctx = ctxOf(d);
  for (const html of [renderLayout(ctx, 'index'), sectionFields(ctx, s, {}), renderStructureCard(ctx)]) {
    assert(!html.includes('<img src=x'), 'unescaped title');
    assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  }
  assert(renderLayout(ctx, 'index').includes('data-tour="layout-list"'));
  assert(!renderLayout({...ctx, role: 'service'}, 'index').includes('data-lay-add'), 'service staff cannot add');
});

test('brand groups: unique ids, limits, and deleting with reassignment', () => {
  const {next, group} = addBrandGroup(seed(), 'Batteries');
  assert.equal(group.id, 'batteries'); validateContent(next);
  assert.throws(() => addBrandGroup(next, 'batteries'), /already exists/);
  assert.throws(() => addBrandGroup(next, ''), /name/);
  assert.equal(addBrandGroup(next, 'Batteries!').group.id === 'batteries', false);
  const d = normalise(seed()), oil = d.brands.filter(b => b.group === 'oil').length;
  deleteRecordIn(d, 'brandGroup', 'oil', {reassignTo: 'tyres'});
  assert.equal(d.brands.filter(b => b.group === 'tyres').length >= oil, true);
  validateContent(d);
  assert(renderBrandGroups(ctxOf(seed())).includes('data-tour="brand-groups"'));
  assert.equal(groupOptions(seed())[0][0], '');
});

test('photo library: usage index, replace everywhere, filters and default alt', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000', d = seed();
  d.products[0].image = 'media:' + id; d.banners[0].image = 'media:' + id;
  const idx = usageIndex(d);
  assert.equal(idx.get('media:' + id).count, 2);
  assert(idx.get('media:' + id).types.has('banner'));
  const {next, count} = replaceRefs(d, 'media:' + id, 'media:abcdefab-e89b-12d3-a456-426614174000');
  assert.equal(count, 2); assert.equal(next.products[0].image, 'media:abcdefab-e89b-12d3-a456-426614174000');
  validateContent(next);
  const ctx = ctxOf(d, {media: [{id, name: 'Oil', alt: 'Oil bottle', mime_type: 'image/webp'}, {id: 'abcdefab-e89b-12d3-a456-426614174001', name: '<b>pds</b>', mime_type: 'application/pdf', hidden: true}]});
  const items = libraryItems(ctx);
  assert.equal(items.find(i => i.ref === 'media:' + id).uses, 2);
  assert(items.some(i => !i.uploaded && i.ref.startsWith('assets/')));
  assert.equal(mediaAlt(ctx, 'media:' + id), 'Oil bottle');
  const page = renderPhotos(ctx);
  assert(page.includes('data-tour="photos-upload"') && page.includes('data-tour="photos-filters"'));
  assert(!page.includes('<b>pds</b>'), 'hidden files are not listed by default');
  assert(chooserHtml(ctx).includes('data-tour="chooser-search"'));
});

test('spreadsheet import preview: counts, badges and escaping', () => {
  const ctx = ctxOf(seed());
  const csv = 'name,category,price\r\n<script>x</script> chain,Engine oil,500\r\nBad row,Engine oil,abc\r\n';
  const {report} = importFromText(ctx, csv);
  assert.equal(report.created, 1); assert.equal(report.errors.length, 1);
  const html = importPreviewHtml(ctx, report, 'list.csv');
  assert(!html.includes('<script>x'));
  assert(html.includes('1 new') && html.includes('data-io-confirm'));
  assert.equal(importFromText(ctx, '').report.canImport, false);
  assert(renderIoButtons(ctx).includes('data-tour="io-export"'));
  assert.equal(renderIoButtons({...ctx, role: 'service'}), '');
});

test('the section form refuses a FAQ question without an answer, an empty FAQ and an empty text', () => {
  const data = seed(), ctx = ctxOf(data);
  const faq = sectionDefaults(data, {page: 'index', preset: 'faq'});
  assert.deepEqual(faq.items, [], 'the FAQ preset makes no claim on the store\'s behalf');
  assert.throws(() => readSectionForm(ctx, form([['kind', 'faq'], ['page', 'index'], ['title', 'Q&A'], ['after', '__bottom'], ['faq-q', 'Do you deliver?'], ['faq-a', '']]), faq, {isNew: true}), /answer/i);
  assert.throws(() => readSectionForm(ctx, form([['kind', 'faq'], ['page', 'index'], ['title', 'Q&A'], ['after', '__bottom'], ['faq-q', ''], ['faq-a', '']]), faq, {isNew: true}), /at least one question/i);
  const ok = readSectionForm(ctx, form([['kind', 'faq'], ['page', 'index'], ['title', 'Q&A'], ['after', '__bottom'], ['faq-q', 'Do you deliver?'], ['faq-a', 'Yes, across Kushtia.']]), faq, {isNew: true});
  assert.deepEqual(ok.section.items, [{q: 'Do you deliver?', a: 'Yes, across Kushtia.'}]);
  validateContent(ok.next);
  const text = sectionDefaults(data, {page: 'index', preset: 'text'});
  assert.throws(() => readSectionForm(ctx, form([['kind', 'text'], ['page', 'index'], ['title', 'About'], ['body', '  ']]), text, {isNew: true}), /text/i);
});

test('a position from the other page is ignored: a new shop section lands before the bundles', () => {
  const data = seed(), ctx = ctxOf(data), rec = sectionDefaults(data, {page: 'shop', preset: 'deals'});
  const {next} = readSectionForm(ctx, form([['kind', 'carousel'], ['page', 'shop'], ['title', 'Deals'], ['after', 'builtin:index-brands'], ['sourceType', 'sale'], ['limit', '8'], ['sort', 'save'], ['visible', 'on']]), rec, {isNew: true});
  const shop = next.layout.shop, i = shop.indexOf('section:' + rec.id);
  assert.ok(i >= 0);
  assert.equal(shop[i + 1], 'builtin:shop-kits');
});
