// Background worker for day-mode logos: fetches a logo, recolours it off the main
// thread and hands back a PNG (or null when the logo needs no change), so the page
// never freezes while logos are prepared.
import {recolour, MAX_SIDE} from './recolour.mjs?v=fb-1122';

self.onmessage = async ({data: {id, src}}) => {
  try {
    const response = await fetch(src, {mode: 'cors', credentials: 'omit'});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bitmap = await createImageBitmap(await response.blob());
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const pixels = ctx.getImageData(0, 0, w, h);
    if (!recolour(pixels, w, h)) { self.postMessage({id, blob: null}); return; }
    ctx.putImageData(pixels, 0, 0);
    self.postMessage({id, blob: await canvas.convertToBlob({type: 'image/png'})});
  } catch (error) {
    self.postMessage({id, error: String(error)});
  }
};
