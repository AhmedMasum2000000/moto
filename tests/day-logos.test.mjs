import test from 'node:test';
import assert from 'node:assert/strict';
import {recolour} from '../cms/day-logos.mjs';

// w x h RGBA image filled by a painter function.
function image(w, h, paint) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(paint(x, y), (y * w + x) * 4);
  return {data, w, h};
}
const at = (img, x, y) => [...img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)];
const CLEAR = [0, 0, 0, 0], WHITE = [255, 255, 255, 255], RED = [220, 18, 56, 255];

test('white lettering on transparency is redrawn dark', () => {
  const img = image(10, 10, (x, y) => (x >= 3 && x <= 6 && y >= 3 && y <= 6 ? WHITE : CLEAR));
  assert.equal(recolour(img, img.w, img.h), true);
  const [r, g, b, a] = at(img, 4, 4);
  assert.ok(r < 60 && g < 60 && b < 60, 'letter is dark');
  assert.equal(a, 255, 'opacity kept');
  assert.deepEqual(at(img, 0, 0), CLEAR, 'transparent area untouched');
});

test('white inside a coloured badge stays white', () => {
  const img = image(12, 12, (x, y) => {
    if (x < 1 || y < 1 || x > 10 || y > 10) return CLEAR;
    return x >= 4 && x <= 7 && y >= 4 && y <= 7 ? WHITE : RED;
  });
  assert.equal(recolour(img, img.w, img.h), false);
  assert.deepEqual(at(img, 5, 5), WHITE);
});

test('a logo with a solid white background is left alone', () => {
  const img = image(8, 8, (x, y) => (x === 4 && y === 4 ? RED : WHITE));
  assert.equal(recolour(img, img.w, img.h), false);
  assert.deepEqual(at(img, 0, 0), WHITE);
});
