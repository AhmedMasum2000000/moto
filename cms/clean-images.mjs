// Product photos that were uploaded with a black background baked in, and the
// cleaned copies (background cut out) that ship with the site in assets/products/.
// Content that still points at an original upload (as 'media:<id>' or as its storage
// URL) is shown with the cleaned copy instead. A photo a staff member replaces in the
// control room is no longer listed here, so their new upload is shown as is.
export const CLEANED = {
  'cefdeb7d-88da-41c0-a5ac-494b7d6ca84d': 'assets/products/motul-7100-4t-10w-40-1l.webp',
  '14fd9553-bc28-4606-bda7-70e33c9c7980': 'assets/products/motul-300v-10w40.webp',
  '131886dd-3815-4db3-83b9-fd73286397d1': 'assets/products/motul-3000-10w-30-4t.webp',
  '8eebebcd-2b2b-4123-98ac-f2719f425d44': 'assets/products/motul-3000-10w-40-4t.webp',
  'f13cfce9-7043-4adb-8310-a923ef57895b': 'assets/products/motul-3100-4t-20w50.webp',
  '8d90e513-2845-440e-9cbd-ae5225cf440e': 'assets/products/motul-5100-4t-10w40.webp',
  '272243e5-5266-49fe-9f40-05823a69b351': 'assets/products/motul-7100-4t-10w40.webp',
  '824cc25b-0ef5-467c-9773-6c49d2a09d7b': 'assets/products/motul-7100-4t-20w50.webp',
  'd9e5079b-4a45-4bf4-99e3-4a9ab445bb64': 'assets/products/motul-3100-4t-10w30.webp',
  'f9109191-d3cf-4c0f-b15d-d0dcb62be007': 'assets/products/motul-scooter-4t-10w-30.webp',
  'dc140035-80b9-4a52-b12c-1fffca470da7': 'assets/products/motul-7100-4t-10w30-12x1l.webp',
  '9983b12b-450c-4b3a-b4d7-6f309ddbefdf': 'assets/products/motul-3100-10w-40-4t.webp',
  'bfec129e-a134-49bd-aba5-60912067765a': 'assets/products/motul-7100-4t-10w30-20x1-2l.webp',
  '4bf32e96-7845-4d3e-a4a5-b020dbff644b': 'assets/products/motul-fork-oil-expert-20x350ml.webp',
  '32e76342-5b5a-4b19-829f-0885f9a70ea9': 'assets/products/motul-fork-oil-expert-40x175ml.webp',
  '7de2dd88-1a36-4b22-bc4d-a94334d2a35e': 'assets/products/motul-motocool-expert.webp',
};

const ids = Object.keys(CLEANED).join('|');
const ORIGINAL = new RegExp('"(?:media:(' + ids + ')|https://[^"]*/moto-public/(' + ids + ')\\.jpe?g)"', 'g');

export function cleanImages(content) {
  if (!content) return content;
  const text = JSON.stringify(content);
  const swapped = text.replace(ORIGINAL, (_, a, b) => JSON.stringify(CLEANED[a || b]));
  return swapped === text ? content : JSON.parse(swapped);
}
