// control-room/lib/csv.mjs: writing, parsing and the import plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {toCsv, parseCsv, cell, productsCsv, productRows, templateCsv, planImport, importLabel, wholeNumber, PRODUCT_COLUMNS, LIMITS_IMPORT} from '../control-room/lib/csv.mjs';
import {normalise} from '../cms/content-model.mjs';
import {validateContent} from '../supabase/functions/moto-admin/schema.mjs';

const seed = () => JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json', import.meta.url), 'utf8'));
const valid = d => validateContent(structuredClone(d));
const NOW = new Date('2026-11-10T08:00:00.000Z');
const plan = (d, text) => planImport(d, parseCsv(text), {now: NOW});
const header = 'id,name,sku,brand,category,subcategory,price,sale,quantity,unit,stock,visible,featured,tags,description,image,gallery';

test('toCsv: BOM, CRLF and RFC 4180 quoting', () => {
  const out = toCsv([{a: 'plain', b: 'with, comma'}, {a: 'say "hi"', b: 'two\nlines'}, {a: 1500, b: true}], ['a', 'b']);
  assert.ok(out.startsWith('﻿'));
  assert.equal(out, '﻿a,b\r\nplain,"with, comma"\r\n"say ""hi""","two\nlines"\r\n1500,yes\r\n');
  assert.equal(toCsv([[1, 2]], [{key: 'x', label: 'X'}, {key: 'y', label: 'Y', value: r => r[1] * 2}]), '﻿X,Y\r\n1,4\r\n');
  assert.equal(cell(null), '');
  assert.equal(cell(' pad'), '" pad"');
});

test('toCsv guards formula cells and parse reads them back', () => {
  assert.equal(cell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(cell('+880'), "'+880");
  assert.equal(cell(-5), '-5', 'numbers are not guarded');
  const d = normalise(seed());
  d.products[0].description = '=1+2';
  const round = plan(d, productsCsv(d));
  assert.equal(round.report.unchanged, d.products.length);
  assert.equal(round.next.products[0].description, '=1+2');
});

test('parseCsv: BOM, quotes, CRLF, embedded newlines, Bangla text, blank lines', () => {
  const text = '﻿name,description\r\n"হেলমেট, লাল","line one\r\nline ""two"""\r\n\r\nplain,\n"",x\n';
  assert.deepEqual(parseCsv(text), [['name', 'description'], ['হেলমেট, লাল', 'line one\r\nline "two"'], ['plain', ''], ['', 'x']]);
  assert.deepEqual(parseCsv('a,b'), [['a', 'b']]);
  assert.deepEqual(parseCsv('a,\n'), [['a', '']]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv(toCsv([{n: 'মোটুল\n"৭১০০"'}], ['n'])), [['n'], ['মোটুল\n"৭১০০"']]);
});

test('export: names for categories, | for gallery and tags; round trip changes nothing', () => {
  const d = normalise(seed());
  d.products[0].tags = ['synthetic', '10W-40'];
  d.products[0].gallery = [{ref: 'assets/icons/tyres.png', alt: 'Side'}, {ref: 'assets/icons/parts.png'}];
  const rows = productRows(d);
  const helmet = rows.find(r => r.id === 'hel-agv-k1');
  assert.equal(helmet.category, d.categories.find(c => c.id === 'helmets').name);
  assert.equal(helmet.subcategory, 'Helmets');
  assert.equal(rows[0].tags, 'synthetic|10W-40');
  assert.equal(rows[0].gallery, 'assets/icons/tyres.png|assets/icons/parts.png');
  const text = productsCsv(d);
  assert.equal(parseCsv(text)[0].join(','), header);
  const {next, report} = plan(d, text);
  assert.equal(report.unchanged, d.products.length);
  assert.equal(report.created + report.updated, 0);
  assert.equal(report.canImport, false, 'nothing to import');
  assert.equal(next.products[0].gallery[0].alt, 'Side', 'gallery alt text kept');
  assert.deepEqual(PRODUCT_COLUMNS.join(','), header);
});

test('template imports as one new product with a new category and subcategory', () => {
  const d = normalise(seed());
  const {next, report} = plan(d, templateCsv());
  assert.equal(report.created, 1);
  assert.deepEqual(report.newCategories, []);
  assert.ok(report.newSubs.length === 1);
  assert.equal(report.rows[0].status, 'new');
  valid(next);
});

test('matching: id, then sku (any case), then exact name', () => {
  const d = normalise(seed());
  d.products[1].sku = 'ABC-1';
  const a = d.products[0], b = d.products[1], c = d.products[2];
  const text = 'id,sku,name,price\n' + [
    `${a.id},,,${a.price + 1}`,
    `,abc-1,,${b.price + 1}`,
    `,,${c.name},${c.price + 1}`,
  ].join('\n');
  const {next, report} = plan(d, text);
  assert.equal(report.updated, 3);
  assert.equal(next.products[0].price, a.price + 1);
  assert.equal(next.products[1].price, b.price + 1);
  assert.equal(next.products[2].price, c.price + 1);
  assert.equal(next.products[0].updatedAt, NOW.toISOString());
  assert.equal(next.products.length, d.products.length);
  valid(next);
  // An unknown id falls through to the name.
  const byName = plan(d, `id,name,price\nnot-there,${c.name},5\n`);
  assert.equal(byName.report.updated, 1);
  assert.equal(byName.next.products[2].price, 5);
  // The same product twice is an error on the second row.
  const twice = plan(d, `id,price\n${a.id},${a.price + 1}\n${a.id},${a.price + 2}\n`);
  assert.equal(twice.report.errors.length, 1);
  assert.equal(twice.report.errors[0].row, 3);
});

test('missing categories and subcategories are created with content-model ids', () => {
  const d = normalise(seed());
  const text = header + '\n' + [
    ',Chain lube,,Motul,Chain care,Sprays,450,,10,can,In stock,yes,no,chain|lube,Keeps it quiet,,',
    ',Chain cleaner,,Motul,chain care,Sprays,400,350,,,in stock,,,,,,',
    ',হেলমেট লক,,,Accessories,তালা,300,,,,,,,,,,',
  ].join('\r\n');
  const {next, report} = plan(d, text);
  assert.equal(report.created, 3, JSON.stringify(report.errors));
  assert.deepEqual(report.newCategories, ['Chain care']);
  assert.deepEqual(report.newSubs.sort(), ['Accessories › তালা', 'Chain care › Sprays'].sort());
  const cat = next.categories.find(c => c.name === 'Chain care');
  assert.equal(cat.id, 'chain-care');
  assert.equal(cat.children[0].id, 'sub-sprays');
  const lube = next.products.find(p => p.name === 'Chain lube');
  assert.equal(lube.category, 'chain-care');
  assert.equal(lube.subcategory, 'sub-sprays');
  assert.deepEqual(lube.tags, ['chain', 'lube']);
  assert.equal(lube.unit, 'can');
  assert.equal(lube.quantity, 10);
  assert.equal(next.products.find(p => p.name === 'Chain cleaner').sale, 350);
  const lock = next.products.find(p => p.name === 'হেলমেট লক');
  assert.match(lock.subcategory, /^sub-x[0-9a-f]{8}$/);
  assert.match(lock.id, /^product-x[0-9a-f]{8}$/);
  assert.equal(importLabel(report), 'Imported 3 products (3 new)');
  valid(next);
});

test('row errors are listed and skipped; good rows still apply', () => {
  const d = normalise(seed());
  d.products[0].sku = 'TAKEN';
  const text = 'name,category,price,sale,sku,stock,visible,image,unit\n' + [
    'Good one,Parts,৳1,200,,,,,,,',
    'No price,Parts,,,,,,,',
    'Bad sale,Parts,100,150,,,,,',
    'Bad stock,Parts,100,,,maybe,,,',
    'Bad yes,Parts,100,,,,perhaps,,',
    'Bad image,Parts,100,,,,,https://evil.example/x.png,',
    'Long sku,Parts,100,,' + 'x'.repeat(61) + ',,,,',
    'Bad unit,Parts,100,,,,,,kg',
    ',Parts,100,,,,,,',
    'No category,,100,,,,,,',
    'Bangla digits,Parts,১৫০০,,,,,,',
  ].join('\n').replace('৳1,200', '"৳1,200"');
  const {next, report} = plan(d, text);
  assert.equal(report.created, 2, JSON.stringify(report.errors));
  assert.equal(next.products.find(p => p.name === 'Good one').price, 1200);
  assert.equal(next.products.find(p => p.name === 'Bangla digits').price, 1500);
  const rows = report.errors.map(e => e.row);
  assert.deepEqual(rows, [3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.match(report.errors.find(e => e.row === 4).message, /lower than the price/);
  assert.match(report.errors.find(e => e.row === 8).message, /SKU must be 60/);
  const dup = plan(d, `id,sku\n${d.products[1].id},taken\n`);
  assert.match(dup.report.errors[0].message, /SKU taken is already used by /);
  // Matching by SKU (any case) updates that product instead.
  assert.equal(plan(d, 'sku,price\ntaken,99999\n').next.products[0].price, 99999);
  assert.ok(report.rows.filter(r => r.status === 'error').length === 9);
  valid(next);
});

test('blank cells clear optional fields; missing columns leave fields alone', () => {
  const d = normalise(seed());
  const p = d.products.find(x => x.sale > 0);
  p.sku = 'KEEP'; p.tags = ['x'];
  const cleared = plan(d, `id,sale,tags,sku\n${p.id},,,\n`).next.products.find(x => x.id === p.id);
  assert.equal(cleared.sale, null);
  assert.equal(cleared.tags, undefined);
  assert.equal(cleared.sku, undefined);
  const kept = plan(d, `id,price\n${p.id},${p.price + 10}\n`).next.products.find(x => x.id === p.id);
  assert.equal(kept.sale, p.sale);
  assert.deepEqual(kept.tags, ['x']);
  assert.equal(kept.sku, 'KEEP');
  assert.equal(kept.name, p.name);
});

test('header problems stop the import; unknown columns are reported', () => {
  const d = normalise(seed());
  assert.equal(plan(d, 'foo,bar\n1,2\n').report.errors[0].row, 1);
  assert.equal(plan(d, 'name,name\na,b\n').report.errors.length, 1);
  const r = plan(d, 'Name,Price,Category,Colour\nNew thing,100,Parts,red\n');
  assert.deepEqual(r.report.ignoredColumns, ['Colour']);
  assert.equal(r.report.created, 1);
});

test('limits: 2000 products and 1.8 MB are checked', () => {
  const d = normalise(seed());
  const rows = [['name', 'category', 'price']];
  for (let i = 0; i < LIMITS_IMPORT.products - d.products.length + 1; i++) rows.push(['Item ' + i, 'Parts', '100']);
  const over = planImport(d, rows, {now: NOW});
  assert.equal(over.report.products, LIMITS_IMPORT.products + 1);
  assert.equal(over.report.overProducts, true);
  assert.equal(over.report.canImport, false);
  rows.pop();
  const at = planImport(d, rows, {now: NOW});
  assert.equal(at.report.products, LIMITS_IMPORT.products);
  assert.equal(at.report.overProducts, false);
  assert.equal(at.report.canImport, !at.report.overBytes);
  assert.ok(at.report.bytes > 0);
  const big = planImport(d, [['name', 'category', 'price', 'description'], ...Array.from({length: 400}, (_, i) => ['Long ' + i, 'Parts', '100', 'x'.repeat(4900)])], {now: NOW});
  assert.equal(big.report.overBytes, true);
  assert.equal(big.report.canImport, false);
});

test('wholeNumber reads taka amounts', () => {
  assert.equal(wholeNumber('৳1,350'), 1350);
  assert.equal(wholeNumber('1350.00'), 1350);
  assert.equal(wholeNumber('১৩৫০'), 1350);
  assert.equal(wholeNumber('1350 tk'), 1350);
  assert.equal(wholeNumber(''), null);
  assert.ok(Number.isNaN(wholeNumber('12.5')));
  assert.ok(Number.isNaN(wholeNumber('abc')));
});

test('object rows work too', () => {
  const d = normalise(seed());
  const r = planImport(d, [{Name: 'Object row', Category: 'parts', Price: 99}], {now: NOW});
  assert.equal(r.report.created, 1);
  assert.equal(r.next.products.at(-1).category, 'parts');
  valid(r.next);
});

test('a row whose id matches no product is added as new and says so', () => {
  const d = normalise(seed());
  const cat = d.categories[0];
  const r = plan(d, `${header}\r\ndoes-not-exist-123,Brand new thing,,,${cat.name},,500,,,,,,,,,,`);
  const row = r.report.rows.find(x => x.status === 'new');
  assert.ok(row, 'created');
  assert.match(row.message, /not found/);
});
