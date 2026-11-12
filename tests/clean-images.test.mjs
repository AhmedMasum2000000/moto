import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {cleanImages, CLEANED} from '../cms/clean-images.mjs';

const id = 'f13cfce9-7043-4adb-8310-a923ef57895b';

test('original uploads are shown with their cleaned copy', () => {
  const out = cleanImages({products: [
    {image: `https://x.supabase.co/storage/v1/object/public/moto-public/${id}.jpg`},
    {image: `media:${id}`, gallery: [{src: `media:${id}`}]},
    {image: 'assets/icons/engine-oil.png'},
  ]});
  assert.equal(out.products[0].image, CLEANED[id]);
  assert.equal(out.products[1].image, CLEANED[id]);
  assert.equal(out.products[1].gallery[0].src, CLEANED[id]);
  assert.equal(out.products[2].image, 'assets/icons/engine-oil.png');
});

test('content without those uploads is returned untouched', () => {
  const c = {products: [{image: 'media:00000000-0000-0000-0000-000000000000'}]};
  assert.equal(cleanImages(c), c);
});

test('every cleaned copy ships with the site', () => {
  for (const path of Object.values(CLEANED)) assert.ok(existsSync(new URL('../' + path, import.meta.url)), path);
});
