import {partnerLayout} from './brand-partners.mjs';

export function brandPartners(brands, imageUrl) {
  const section = document.querySelector('[data-brand-partners]');
  if (!section) return;
  const visible = brands.filter(b => b.visible !== false && imageUrl(b.image));
  if (!visible.length) { section.hidden = true; return; }
  const window = section.querySelector('.brand-partners__window');
  const track = section.querySelector('.brand-partners__track');
  const group = document.createElement('div');
  group.className = 'brand-partners__group';
  const list = document.createElement('ul');
  list.className = 'brand-partners__list';
  list.setAttribute('aria-label', 'Brand partners');
  for (const brand of visible) {
    const item = document.createElement('li');
    item.className = 'brand-partners__tile';
    const logo = document.createElement('img');
    logo.src = imageUrl(brand.image);
    logo.alt = brand.alt || brand.name;
    logo.loading = 'lazy';
    logo.decoding = 'async';
    item.append(logo); list.append(item);
  }
  group.append(list); track.replaceChildren(group);
  const duplicate = node => {
    const copy = node.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    copy.removeAttribute('aria-label');
    copy.querySelectorAll('img').forEach(img => { img.alt = ''; });
    return copy;
  };
  let width = 0;
  const layout = () => {
    const nextWidth = window.clientWidth;
    if (!nextWidth || nextWidth === width) return;
    width = nextWidth;
    const tile = list.firstElementChild.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
    const {repeats, distance, duration} = partnerLayout(visible.length, width, tile, gap);
    group.replaceChildren(list);
    for (let i = 1; i < repeats; i++) group.append(duplicate(list));
    track.replaceChildren(group, duplicate(group));
    track.style.setProperty('--partner-distance', `${distance}px`);
    track.style.setProperty('--partner-duration', `${duration}s`);
  };
  const observer = new ResizeObserver(layout);
  observer.observe(window); layout();
  const button = section.querySelector('[data-partner-pause]');
  const setPaused = paused => {
    section.dataset.paused = String(paused);
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? 'Resume brand scrolling' : 'Pause brand scrolling');
    button.querySelector('span').textContent = paused ? 'Play' : 'Pause';
  };
  // Reduced-motion visitors can choose to start the loop without changing device settings.
  setPaused(matchMedia('(prefers-reduced-motion: reduce)').matches);
  button.addEventListener('click', () => {
    const paused = section.dataset.paused !== 'true';
    section.dataset.motionEnabled = String(!paused);
    setPaused(paused);
  });
  addEventListener('pagehide', () => observer.disconnect(), {once: true});
}
