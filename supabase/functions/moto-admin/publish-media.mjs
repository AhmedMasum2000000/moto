// Publishing copies each picture and data sheet the website uses from the private
// bucket into the public one. A file only needs copying once: later publishes reuse
// it. Copying every file on every publish made publishing slower with each new
// photo, until it ran past the function's time limit and failed, so photos staff
// had uploaded never reached the website.
//
// store: {
//   media(ids)       -> rows {id, path, mime_type} for those ids
//   publicNames()    -> Set of file names already in the public bucket
//   copy(row, name)  -> copies that file into the public bucket under name
//   url(name)        -> public URL of that name
// }
import {UUID, assert} from './schema.mjs';

const EXT = {'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'};
export const publicName = row => row.id + '.' + (EXT[row.mime_type] || 'webp');

export async function publishMedia(refs, store, {parallel = 4} = {}) {
  const ids = [...new Set(refs)];
  for (const id of ids) assert(UUID.test(id), 'Invalid picture reference.');
  if (!ids.length) return {urls: {}, copied: 0};
  const rows = await store.media(ids);
  const byId = new Map(rows.map(r => [String(r.id).toLowerCase(), r]));
  const have = await store.publicNames();
  const urls = {}, todo = [];
  for (const id of ids) {
    const row = byId.get(id.toLowerCase());
    assert(row, 'A picture or data sheet could not be published.');
    const name = publicName(row);
    urls[id] = store.url(name);
    if (!have.has(name)) todo.push([row, name]);
  }
  for (let i = 0; i < todo.length; i += parallel) {
    await Promise.all(todo.slice(i, i + parallel).map(([row, name]) => store.copy(row, name)));
  }
  return {urls, copied: todo.length};
}
