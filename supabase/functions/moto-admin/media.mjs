// Media library actions (media-update, media-delete) for the moto-admin Edge Function.
// Pure logic with an injected store, so tests/backend.test.mjs can exercise auth, role and the
// "still in use" refusal without Deno or a database. index.ts passes a store backed by Supabase.
import {mediaReferences, UUID, assert} from './schema.mjs';

export const MEDIA_NAME_MAX = 120;
export const MEDIA_ALT_MAX = 150;
// How many recent published versions are checked before a file may be deleted.
export const MEDIA_REVISIONS_CHECKED = 10;

export const canManageMedia = staff => !!staff && staff.active !== false && (staff.role === 'owner' || staff.role === 'editor');

// {id, name?, alt?, hidden?} → {id, patch}. Only the fields that are present are changed.
export function validateMediaUpdate(body) {
  assert(body && typeof body.id === 'string' && UUID.test(body.id), 'Choose a file from the library.');
  const patch = {};
  if (body.name !== undefined) {
    assert(typeof body.name === 'string', 'Enter a display name.');
    const name = body.name.trim();
    assert(name.length >= 1 && name.length <= MEDIA_NAME_MAX, `Use a display name of 1 to ${MEDIA_NAME_MAX} characters.`);
    patch.name = name;
  }
  if (body.alt !== undefined) {
    assert(body.alt === null || typeof body.alt === 'string', 'Enter the picture description as text.');
    const alt = String(body.alt ?? '').trim();
    assert(alt.length <= MEDIA_ALT_MAX, `Keep the picture description under ${MEDIA_ALT_MAX} characters.`);
    patch.alt = alt || null;
  }
  if (body.hidden !== undefined) {
    assert(typeof body.hidden === 'boolean', 'Choose whether the file is hidden.');
    patch.hidden = body.hidden;
  }
  assert(Object.keys(patch).length > 0, 'Nothing to change.');
  return {id: body.id.toLowerCase(), patch};
}

// The documents a file must not be used in before it may be deleted: the draft, the live site and
// the last MEDIA_REVISIONS_CHECKED versions (their draft content and their published content).
export function mediaDocuments({draft, live, revisions} = {}) {
  const docs = [];
  if (draft?.content) docs.push({label: 'Saved draft', content: draft.content});
  if (live?.content) docs.push({label: 'Live website', content: live.content});
  (Array.isArray(revisions) ? revisions : []).slice(0, MEDIA_REVISIONS_CHECKED).forEach((r, i) => {
    const when = r?.created_at ? new Date(r.created_at) : null;
    const label = 'Earlier version' + (when && !Number.isNaN(when.getTime()) ? ' of ' + when.toISOString().slice(0, 10) : ' ' + (i + 1));
    if (r?.content) docs.push({label, content: r.content});
    if (r?.public_content) docs.push({label, content: r.public_content});
  });
  return docs;
}

// Labels of the documents that use the file. Draft documents hold 'media:<id>'; published documents
// hold the public URL …/moto-public/<id>.<ext>, so both forms are found.
export function mediaUsedIn(id, docs) {
  const want = String(id || '').toLowerCase(), needle = '/' + want + '.';
  if (!want) return [];
  const out = [];
  for (const d of docs || []) {
    if (!d || d.content == null) continue;
    let hit = mediaReferences(d.content).has(want) || [...mediaReferences(d.content)].some(r => String(r).toLowerCase() === want);
    if (!hit) { try { hit = JSON.stringify(d.content).toLowerCase().includes(needle); } catch { hit = false; } }
    if (hit && !out.includes(d.label)) out.push(d.label);
  }
  return out;
}

// store: {getMedia(id), updateMedia(id, patch), documents(), deleteMedia(id), removeObject(path, media) → false on failure,
// audit(action, details)}. Returns {status, body}; never throws for expected refusals.
export async function mediaAction(action, body, {staff, store}) {
  try {
    assert(canManageMedia(staff), 'Only the owner or a content manager can change the photo library.');
    if (action === 'media-update') {
      const {id, patch} = validateMediaUpdate(body);
      const current = await store.getMedia(id);
      assert(current, 'This file is no longer in the library.');
      const media = await store.updateMedia(id, patch);
      await store.audit('media_updated', {media: id, fields: Object.keys(patch), hidden: patch.hidden});
      return {status: 200, body: {media}};
    }
    if (action === 'media-delete') {
      assert(body && typeof body.id === 'string' && UUID.test(body.id), 'Choose a file from the library.');
      const id = body.id.toLowerCase();
      const current = await store.getMedia(id);
      assert(current, 'This file is no longer in the library.');
      const usedIn = mediaUsedIn(id, mediaDocuments(await store.documents()));
      if (usedIn.length) {
        await store.audit('media_delete_refused', {media: id, usedIn});
        return {status: 409, body: {error: `This file is still used in: ${usedIn.join(', ')}. Remove it from those places first, or hide it from the library.`, code: 'MEDIA_IN_USE', usedIn}};
      }
      // Files first (the private original and the published copy), then the row: a failed removal
      // leaves the library entry in place, so nothing is orphaned and the owner can try again.
      const removed = await store.removeObject(current.path, current);
      if (removed === false) {
        await store.audit('media_delete_failed', {media: id, path: current.path});
        return {status: 500, body: {error: 'The file could not be removed from storage. Please try again.', code: 'STORAGE_ERROR'}};
      }
      await store.deleteMedia(id);
      await store.audit('media_deleted', {media: id, path: current.path, name: current.name, objectRemoved: true});
      return {status: 200, body: {deleted: true, id}};
    }
    return {status: 400, body: {error: 'Unknown action', code: 'INVALID_REQUEST'}};
  } catch (e) {
    return {status: 400, body: {error: e instanceof Error ? e.message : 'Unable to complete this action.', code: 'INVALID_REQUEST'}};
  }
}
