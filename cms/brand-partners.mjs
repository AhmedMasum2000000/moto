// Repeat short logo lists enough to cover the viewport throughout a full loop.
export function partnerLayout(count, viewport, tile, gap) {
  if (!count || viewport <= 0 || tile <= 0) return {repeats: 0, distance: 0, duration: 0};
  const cycle = count * (tile + gap);
  const repeats = Math.max(1, Math.ceil(viewport / cycle));
  const distance = cycle * repeats;
  return {repeats, distance, duration: distance / 32};
}

export function addPartnerSection(content) {
  if (content.content.some(s => s.id === 'index-brand-partners')) return;
  const footer = content.content.findIndex(s => s.id === 'index-section-5');
  content.content.splice(footer < 0 ? content.content.length : footer, 0, {
    id: 'index-brand-partners', name: 'Brands We Carry', page: 'index', visible: true,
    hint: 'Edit the heading here. Add, replace, hide or reorder the logos under Website → Brand logos.',
    fields: [{id: 'home-partner-title', kind: 'text', label: 'Heading', value: 'Brands We Carry'}]
  });
  content.content.forEach((section, order) => { section.order = order; });
}
