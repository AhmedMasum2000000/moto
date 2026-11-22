import test from 'node:test';
import assert from 'node:assert/strict';
import {publishMedia, publicName} from '../supabase/functions/moto-admin/publish-media.mjs';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const rows = [{id: A, path: 'u/a.jpg', mime_type: 'image/jpeg'}, {id: B, path: 'u/b.pdf', mime_type: 'application/pdf'}];
function store(existing) {
  const copied = [], lookups = [];
  return {copied, lookups,
    media: async ids => { lookups.push(ids); return rows.filter(r => ids.includes(r.id)); },
    publicNames: async () => new Set(existing),
    copy: async (row, name) => { copied.push(name); },
    url: name => 'https://cdn/' + name};
}

test('only files not yet public are copied', async () => {
  const s = store([A + '.jpg']);
  const {urls, copied} = await publishMedia([A, B], s);
  assert.deepEqual(s.copied, [B + '.pdf']);
  assert.equal(copied, 1);
  assert.equal(urls[A], 'https://cdn/' + A + '.jpg');
  assert.equal(urls[B], 'https://cdn/' + B + '.pdf');
});

test('a publish with every file already public copies nothing and looks records up once', async () => {
  const s = store([A + '.jpg', B + '.pdf']);
  await publishMedia([A, B, A], s);
  assert.deepEqual(s.copied, []);
  assert.equal(s.lookups.length, 1);
  assert.deepEqual(s.lookups[0], [A, B]);
});

test('an unknown or malformed reference stops the publish', async () => {
  await assert.rejects(publishMedia(['not-a-uuid'], store([])));
  await assert.rejects(publishMedia(['33333333-3333-4333-8333-333333333333'], store([])));
});

test('public names keep the extension the website already uses', () => {
  assert.equal(publicName(rows[0]), A + '.jpg');
  assert.equal(publicName({id: A, mime_type: 'image/png'}), A + '.png');
  assert.equal(publicName({id: A, mime_type: 'image/webp'}), A + '.webp');
});
