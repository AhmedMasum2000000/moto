// Editable website texts that older content documents may not contain yet.
// Each field's default value equals the text the website showed before it became
// editable, so nothing changes for customers until staff edit it.
//   - text-defaults-js.mjs   : texts the scripts build (order form, booking, journal, finder…)
//   - text-defaults-html.mjs : fixed texts in the page HTML that now carry data-cms-text keys
// Both export `sections`: [{id, page:'index'|'shop'|'book', name, hint?, fields:[{id,kind:'text',label,value}]}]
// A section id that already exists in the document receives only the fields it is missing.
import {sections as jsSections} from './text-defaults-js.mjs';
import {sections as htmlSections} from './text-defaults-html.mjs';

export const defaultSections = [...jsSections, ...htmlSections];

const defaultsById = new Map();
for (const section of defaultSections) for (const f of section.fields) defaultsById.set(f.id, f.value);

// The default text for a field id ('' when unknown).
export function defaultText(id) { return defaultsById.get(id) ?? ''; }

// Current value of a text field in a content document, else its default.
export function cmsText(content, id, fallback) {
  for (const section of content?.content || []) {
    const field = section.fields?.find(f => f.id === id);
    if (field && typeof field.value === 'string' && field.value.trim()) return field.value;
  }
  return fallback ?? defaultText(id);
}

// Adds missing sections and missing fields (by id) without touching existing values.
// Idempotent. Returns the same document object.
export function withContentDefaults(doc) {
  if (!doc || !Array.isArray(doc.content)) return doc;
  const taken = new Set(doc.content.flatMap(s => (s.fields || []).map(f => f.id)));
  for (const def of defaultSections) {
    const missing = def.fields.filter(f => !taken.has(f.id));
    if (!missing.length) continue;
    let section = doc.content.find(s => s.id === def.id);
    if (!section) {
      section = {id: def.id, name: def.name, page: def.page, visible: true, fields: []};
      if (def.hint) section.hint = def.hint;
      doc.content.push(section);
    }
    for (const f of missing) { section.fields.push({...f}); taken.add(f.id); }
  }
  doc.content.forEach((s, i) => { s.order = i; });
  return doc;
}
