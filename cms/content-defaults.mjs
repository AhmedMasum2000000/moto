// Editable website texts that older content documents may not contain yet.
// Each field's default value equals the text the website showed before it became
// editable, so nothing changes for customers until staff edit it.
//   - text-defaults-js.mjs   : texts the scripts build (order form, booking, journal, finder…)
//   - text-defaults-html.mjs : fixed texts in the page HTML that now carry data-cms-text keys
// Both export `sections`: [{id, page:'index'|'shop'|'book', name, hint?, fields:[{id,kind:'text',label,value}]}]
// A section id that already exists in the document receives only the fields it is missing.
import {sections as jsSections} from './text-defaults-js.mjs';
import {sections as htmlSections} from './text-defaults-html.mjs';
import {normalise, PINNED_BOTTOM} from './content-model.mjs';

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

// Page-structure entries: built-in page sections that had no content entry of their own. An entry
// lets staff hide the section and order it in the layout; `adopt` lists existing text fields that
// belong to it and are moved into it (same ids and values, so the page reads exactly as before).
export const structuralSections = [
  {id: 'shop-catalog', page: 'shop', name: 'Shop · all products', hint: 'The product grid with its filters and sorting.', adopt: []},
  {id: 'shop-kits', page: 'shop', name: 'Shop · bundles', hint: 'Kits riders buy together.', adopt: ['shop-kits-label', 'shop-kits-title', 'shop-kits-intro']},
  {id: 'shop-partners', page: 'shop', name: 'Shop · brand partners', hint: 'The strip of brand logos under the products.', adopt: ['shop-partners-label', 'shop-partners-title']},
];

// Upgrades the document to the current shape (content-model normalise: subcategory records,
// gallery objects, sections, layout, brand groups), then adds missing sections and missing fields
// (by id) without touching existing values. Idempotent. Changes and returns the same document object.
export function withContentDefaults(doc) {
  if (!doc || !Array.isArray(doc.content)) return doc;
  if (doc.schemaVersion !== undefined || Array.isArray(doc.categories)) Object.assign(doc, normalise(doc));
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
  for (const def of structuralSections) {
    let section = doc.content.find(s => s.id === def.id);
    if (!section) {
      section = {id: def.id, name: def.name, page: def.page, visible: true, hint: def.hint, fields: []};
      const footer = doc.content.findIndex(s => (PINNED_BOTTOM[def.page] || []).includes(s.id));
      doc.content.splice(footer < 0 ? doc.content.length : footer, 0, section);
    }
    if (!Array.isArray(section.fields)) section.fields = [];
    for (const id of def.adopt) {
      if (section.fields.some(f => f.id === id)) continue;
      const owner = doc.content.find(s => s !== section && (s.fields || []).some(f => f.id === id));
      if (!owner) continue;
      const i = owner.fields.findIndex(f => f.id === id);
      section.fields.push(...owner.fields.splice(i, 1));
    }
  }
  doc.content.forEach((s, i) => { s.order = i; });
  return doc;
}
