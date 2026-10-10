// The same published banners drive the homepage background and the control room.
export function homeBackground(root, banners, imageUrl = value => value) {
  if (!root) return;
  const backdrop = root.querySelector('[data-hero-backdrop]');
  const frames = [...backdrop.querySelectorAll('[data-hero-frame]')];
  const controls = root.querySelector('[data-hero-controls]');
  const pause = root.querySelector('[data-hero-pause]');
  const next = root.querySelector('[data-hero-next]');
  const count = root.querySelector('[data-hero-count]');
  if (!banners.length) { backdrop.hidden = true; controls.hidden = true; return; }
  controls.hidden = banners.length < 2;
  let current = 0, cursor = 0, front = 0, timer = null, busy = false, visible = true, disposed = false;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const paint = (frame, index) => {
    const banner = banners[index];
    const picture = frames[frame];
    const image = document.createElement('img');
    image.alt = ''; image.decoding = 'async';
    image.style.objectPosition = `${Number(banner.focalX ?? 50)}% ${Number(banner.focalY ?? 50)}%`;
    if (banner.mobileImage) {
      const source = document.createElement('source');
      source.media = '(max-width: 600px)'; source.srcset = imageUrl(banner.mobileImage);
      picture.replaceChildren(source, image);
    } else picture.replaceChildren(image);
    image.src = imageUrl(banner.image);
    return image;
  };
  const sync = () => {
    root.dataset.heroSlide = String(current);
    count.textContent = `${String(current + 1).padStart(2, '0')} / ${String(banners.length).padStart(2, '0')}`;
    pause.setAttribute('aria-label', paused ? 'Play banner slideshow' : 'Pause banner slideshow');
    pause.setAttribute('aria-pressed', String(paused));
    pause.querySelector('span').textContent = paused ? '▶' : 'Ⅱ';
  };
  const stop = () => { clearInterval(timer); timer = null; };
  const start = () => {
    if (!timer && !paused && visible && !document.hidden && !root.querySelector('.fit')?.contains(document.activeElement) && banners.length > 1 && !disposed)
      timer = setInterval(advance, 6500);
  };
  async function advance() {
    if (busy || disposed || banners.length < 2) return;
    busy = true;
    const destination = (cursor + 1) % banners.length, back = 1 - front;
    cursor = destination;
    const image = paint(back, destination);
    try { await image.decode(); } catch { /* Keep the previous banner if an image fails. */ }
    if (!disposed && image.naturalWidth) {
      frames[front].classList.remove('is-active'); frames[back].classList.add('is-active');
      front = back; current = destination; sync();
    }
    busy = false;
  }
  paint(0, 0); frames[0].classList.add('is-active'); frames[1].classList.remove('is-active'); sync();
  pause.addEventListener('click', () => { paused = !paused; paused ? stop() : start(); sync(); });
  next.addEventListener('click', () => { stop(); advance(); start(); });
  // Typing and reading the tools never compete with a background transition.
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) start(); });
  const visibility = () => document.hidden ? stop() : start();
  document.addEventListener('visibilitychange', visibility);
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting; visible ? start() : stop();
  }, { threshold: .15 });
  observer.observe(root); start();
  window.addEventListener('pagehide', () => {
    disposed = true; stop(); observer.disconnect(); document.removeEventListener('visibilitychange', visibility);
  }, { once: true });
}
