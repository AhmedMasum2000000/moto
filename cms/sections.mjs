// Generated website sections (homepage and shop): which products a section shows, and its HTML.
// Pure: no DOM. Used by the storefront (cms/public.js) and by the control room for counts and previews.
// Every string reaches the markup through ctx.esc; every link through ctx.path(target); every picture
// through ctx.imageUrl(ref). No section kind has a raw-HTML field.

export const SECTION_KINDS = ['carousel', 'grid', 'categories', 'kits', 'brands', 'promo', 'faq', 'text'];
export const SOURCE_TYPES = ['category', 'subcategory', 'brand', 'products', 'sale', 'featured', 'newest', 'all'];
export const SORTS = ['manual', 'featured', 'low', 'high', 'save', 'newest'];

const lower = v => String(v ?? '').trim().toLowerCase();
const priceOf = p => Number(p.sale || p.price) || 0;
const savingOf = p => p.sale && p.price ? (p.price - p.sale) / p.price : 0;
const time = p => { const t = Date.parse(p.updatedAt || ''); return Number.isFinite(t) ? t : -Infinity; };
const visibleChild = c => c && typeof c === 'object' && c.visible !== false;
// Sort by key, keeping the incoming order for ties (Array.prototype.sort is stable).
const by = (list, key) => list.map((p, i) => ({p, i})).sort((a, b) => key(a.p, b.p) || a.i - b.i).map(x => x.p);

export function sectionLimit(section) {
  const n = Math.floor(Number(section?.limit ?? section?.source?.limit));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 48) : 12;
}

// The products a section shows, in order. Steps: source filter, drop hidden, sort, limit.
export function selectProducts(content, section) {
  const products = Array.isArray(content?.products) ? content.products : [];
  const source = section?.source || {type: 'all'};
  let list;
  switch (source.type) {
    case 'category': list = products.filter(p => p.category === source.category); break;
    case 'subcategory': list = products.filter(p => (!source.category || p.category === source.category) && !!source.subcategory && p.subcategory === source.subcategory); break;
    case 'brand': { const want = lower(source.brand); list = want ? products.filter(p => lower(p.brand) === want) : []; break; }
    case 'products': { const byId = new Map(products.map(p => [p.id, p])); list = (source.productIds || []).map(id => byId.get(id)).filter(Boolean); break; }
    case 'sale': list = products.filter(p => Number(p.sale) > 0); break;
    case 'featured': { const featured = products.filter(p => p.featured); list = featured.length ? featured : [...products]; break; }
    case 'newest': list = by(products, (a, b) => time(b) - time(a)); break;
    case 'all': list = [...products]; break;
    default: list = [];
  }
  const categories = new Map((content?.categories || []).map(c => [c.id, c]));
  list = list.filter(p => p && p.visible !== false && categories.has(p.category) && categories.get(p.category).visible !== false);
  switch (section?.sort || 'manual') {
    case 'featured': list = by(list, (a, b) => Number(!!b.featured) - Number(!!a.featured)); break;
    case 'low': list = by(list, (a, b) => priceOf(a) - priceOf(b)); break;
    case 'high': list = by(list, (a, b) => priceOf(b) - priceOf(a)); break;
    case 'save': list = by(list, (a, b) => savingOf(b) - savingOf(a) || (b.price - (b.sale || b.price)) - (a.price - (a.sale || a.price))); break;
    case 'newest': list = by(list, (a, b) => time(b) - time(a)); break;
    default: break; // manual: the source order (hand-picked order, newest order or array order)
  }
  return list.slice(0, sectionLimit(section));
}

// Visible subcategory objects of a category (string children from old documents become objects).
export function visibleChildren(category) {
  return (category?.children || []).map(c => typeof c === 'string' ? {id: c, name: c, visible: true} : c).filter(visibleChild);
}

// The posts' restricted markdown: paragraphs, '## ' headings and '- ' lists. Everything else is text.
export function markdown(text, esc) {
  return String(text ?? '').split(/\n\s*\n/).map(block => {
    if (block.startsWith('## ')) return '<h2>' + esc(block.slice(3)) + '</h2>';
    if (block.split('\n').every(l => l.startsWith('- '))) return '<ul>' + block.split('\n').map(l => '<li>' + esc(l.slice(2)) + '</li>').join('') + '</ul>';
    return '<p>' + esc(block).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

const money = v => '৳' + Number(v || 0).toLocaleString('en-BD');

// One bundle card, the same markup the shop's "Kits riders buy together" grid uses.
export function kitHtml(kit, content, esc) {
  const catName = id => content.categories?.find(c => c.id === id)?.name || id;
  const products = (kit.productIds || []).map(id => content.products?.find(p => p.id === id)).filter(Boolean);
  if (!products.length) return '';
  const items = products.map(p => ({id: p.id, name: p.name, cat: catName(p.category), price: p.sale || p.price}));
  return `<article class="kit"><p class="label label--red">${items.length} items · one visit</p><h3 class="kit__title">${esc(kit.name)}</h3><p class="kit__sub">${esc(kit.description)}</p><ul class="kit__list">${items.map(p => `<li><span>${esc(p.name)}</span><b>${money(p.price)}</b></li>`).join('')}</ul><div class="kit__foot"><p class="kit__total"><small>Bundle total</small>${money(items.reduce((a, p) => a + p.price, 0))}</p><button class="btn btn--red btn--sm" data-kit="${esc(JSON.stringify(items))}" ${products.some(p => p.stock === 'Out of stock') ? 'disabled' : ''}>Add all ${items.length}</button></div></article>`;
}

const arrow = d => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="2"></path></svg>`;

function head(section, ctx, side = '') {
  const {esc} = ctx;
  const button = section.button?.label && section.button?.target
    ? `<a class="btn btn--ghost btn--sm" href="${esc(ctx.path(section.button.target))}">${esc(section.button.label)} →</a>` : '';
  const intro = section.intro ? `<p class="cms-gen__intro">${esc(section.intro)}</p>` : '';
  const title = section.title ? `<h2 class="band__title">${esc(section.title)}</h2>` : '';
  if (!title && !section.label && !intro && !button && !side) return '';
  return `<div class="band__head cms-gen__head"><div>${section.label ? `<p class="label label--red">${esc(section.label)}</p>` : ''}${title}${intro}</div><div class="cms-gen__side">${side}${button}</div></div>`;
}

function wrap(section, ctx, kind, inner) {
  const {esc} = ctx;
  const spacing = section.page === 'shop' ? 'cms-gen--shop' : 'cms-gen--index';
  const label = section.title ? ` aria-label="${esc(section.title)}"` : '';
  return `<section class="wrap cms-gen ${spacing} cms-gen--${kind}" id="${esc(section.id)}" data-cms-generated="${esc(section.id)}"${label}>${inner}</section>`;
}

// HTML for one generated section, or '' when it has nothing to show (the section is then omitted).
// ctx = {content, card(product) → html, esc, path(target) → href, markdown(text) → html, imageUrl(ref) → url}
export function renderSection(section, ctx) {
  if (!section || section.visible === false) return '';
  const {content, esc} = ctx;
  const img = ref => ctx.imageUrl ? ctx.imageUrl(ref) || '' : ref || '';
  const md = text => ctx.markdown ? ctx.markdown(text) : markdown(text, esc);
  switch (section.kind) {
    case 'carousel': {
      const list = selectProducts(content, section);
      if (!list.length) return '';
      const count = `<p class="label">${list.length} ${section.source?.type === 'sale' ? 'on offer' : list.length === 1 ? 'item' : 'items'}</p>`;
      const name = esc(section.title || 'products');
      return wrap(section, ctx, 'carousel', `<div class="band">${head(section, ctx, count)}<div class="carousel" data-carousel=""><button class="carousel__arrow carousel__arrow--prev" type="button" data-car="-1" aria-label="Previous ${name}" hidden="">${arrow('M10 2L4 8l6 6')}</button><div class="carousel__track" tabindex="0" role="group" aria-label="${name}">${list.map(p => ctx.card(p)).join('')}</div><button class="carousel__arrow carousel__arrow--next" type="button" data-car="1" aria-label="Next ${name}" hidden="">${arrow('M6 2l6 6-6 6')}</button><div class="carousel__dots" data-car-dots=""></div></div></div>`);
    }
    case 'grid': {
      const list = selectProducts(content, section);
      if (!list.length) return '';
      return wrap(section, ctx, 'grid', `${head(section, ctx, `<p class="label">${list.length} ${list.length === 1 ? 'item' : 'items'}</p>`)}<div class="grid-products cms-gen__grid">${list.map(p => ctx.card(p)).join('')}</div>`);
    }
    case 'categories': {
      const cats = (content.categories || []).filter(c => c.visible !== false);
      const count = (cat, sub) => (content.products || []).filter(p => p.visible !== false && p.category === cat && (!sub || p.subcategory === sub)).length;
      const parent = section.category ? cats.find(c => c.id === section.category) : null;
      if (section.category && !parent) return '';
      // Tiles without products would lead customers to an empty shop page, so they are skipped.
      const tiles = (parent
        ? visibleChildren(parent).map(c => ({name: c.name, image: c.image || parent.image, url: 'shop.html?cat=' + encodeURIComponent(parent.id) + '&sub=' + encodeURIComponent(c.id), n: count(parent.id, c.id)}))
        : cats.map(c => ({name: c.name, image: c.image, url: 'shop.html?cat=' + encodeURIComponent(c.id), n: count(c.id)}))).filter(t => t.n > 0);
      if (!tiles.length) return '';
      return wrap(section, ctx, 'categories', `${head(section, ctx)}<div class="cms-tiles">${tiles.map(t => `<a class="cms-tile" href="${esc(t.url)}">${img(t.image) ? `<img src="${esc(img(t.image))}" alt="" loading="lazy" decoding="async" width="96" height="96">` : '<span class="cms-tile__blank" aria-hidden="true"></span>'}<span class="cms-tile__name">${esc(t.name)}</span><span class="cms-tile__count">${t.n} ${t.n === 1 ? 'product' : 'products'} →</span></a>`).join('')}</div>`);
    }
    case 'kits': {
      const all = (content.kits || []).filter(k => k.visible !== false);
      const kits = (section.kitIds?.length ? section.kitIds.map(id => all.find(k => k.id === id)).filter(Boolean) : all).filter(k => (k.productIds || []).some(id => content.products?.some(p => p.id === id)));
      if (!kits.length) return '';
      return wrap(section, ctx, 'kits', `${head(section, ctx)}<div class="kits__grid">${kits.map(k => kitHtml(k, content, esc)).join('')}</div>`);
    }
    case 'brands': {
      const group = (content.brandGroups || []).find(g => g.id === section.group);
      if (section.group && (!group || group.visible === false)) return '';
      const brands = (content.brands || []).filter(b => b.visible !== false && (!section.group || b.group === section.group) && img(b.image));
      if (!brands.length) return '';
      return wrap(section, ctx, 'brands', `${head(section, ctx)}<div class="partners__row">${brands.map(b => `<span><img src="${esc(img(b.image))}" alt="${esc(b.alt || b.name)}" width="130" height="130" loading="lazy" decoding="async"></span>`).join('')}</div>`);
    }
    case 'promo': {
      const heading = section.heading || section.title;
      if (!heading && !section.text && !img(section.image)) return '';
      const button = section.button?.label && section.button?.target ? `<a class="btn btn--red" href="${esc(ctx.path(section.button.target))}">${esc(section.button.label)} →</a>` : '';
      const picture = img(section.image) ? `<img class="cms-promo__image" src="${esc(img(section.image))}" alt="" loading="lazy" decoding="async">` : '<span class="promo__slash" aria-hidden="true"></span>';
      return wrap(section, ctx, 'promo', `<div class="promo cms-promo${img(section.image) ? ' cms-promo--image' : ''}">${picture}<div class="promo__body">${section.label ? `<p class="label label--red">${esc(section.label)}</p>` : ''}${heading ? `<h2 class="promo__head">${esc(heading)}</h2>` : ''}${section.text ? `<p class="promo__sub">${esc(section.text)}</p>` : ''}${button ? `<p class="cms-promo__action">${button}</p>` : ''}</div></div>`);
    }
    case 'faq': {
      const items = (section.items || []).filter(i => i && String(i.q || '').trim() && String(i.a || '').trim());
      if (!items.length) return '';
      return wrap(section, ctx, 'faq', `${head(section, ctx)}<div class="cms-faq">${items.map(i => `<details><summary>${esc(i.q)}</summary><p>${esc(i.a).replace(/\n/g, '<br>')}</p></details>`).join('')}</div>`);
    }
    case 'text': {
      if (!String(section.body || '').trim()) return '';
      return wrap(section, ctx, 'text', `${head(section, ctx)}<div class="cms-post-body cms-gen__text">${md(section.body)}</div>`);
    }
    default: return '';
  }
}
