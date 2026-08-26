/* =========================================================================
   MOTO MARKET — motion engine
   No dependencies. Everything degrades to a readable static page.
   ========================================================================= */
(() => {
  'use strict';

  const RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => RM.matches;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp  = (a, b, t) => a + (b - a) * t;

  /* --- one rAF loop shared by every scroll-driven effect ----------------- */
  const frame = { subs: new Set(), running: false };
  function onFrame(fn) {
    frame.subs.add(fn);
    if (!frame.running) { frame.running = true; requestAnimationFrame(tick); }
    return () => frame.subs.delete(fn);
  }
  function tick(t) {
    frame.subs.forEach(fn => fn(t));
    requestAnimationFrame(tick);
  }

  /* =======================================================================
     Scroll progress bar
     ===================================================================== */
  function progressBar() {
    const el = $('.progress');
    if (!el) return;
    let cur = 0;
    onFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const target = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
      cur = lerp(cur, target, 0.14);
      el.style.transform = `scaleX(${cur})`;
    });
  }

  /* =======================================================================
     Nav: stick + hide on scroll down
     ===================================================================== */
  function navBehaviour() {
    const nav = $('.nav');
    if (!nav) return;
    let last = window.scrollY;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      nav.classList.toggle('is-stuck', y > 24);
      nav.classList.toggle('is-hidden', y > 400 && y > last && !document.body.classList.contains('is-locked'));
      last = y;
    }, { passive: true });
  }

  /* =======================================================================
     Custom cursor
     ===================================================================== */
  function cursor() {
    const el = $('.cursor');
    if (!el || window.matchMedia('(pointer: coarse)').matches) return;
    let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y;
    window.addEventListener('mousemove', e => {
      tx = e.clientX; ty = e.clientY;
      el.classList.add('is-live');
    }, { passive: true });
    document.addEventListener('mouseover', e => {
      const hot = e.target.closest('a, button, .svc, .card, input, select, textarea, label');
      el.classList.toggle('is-hot', !!hot);
    });
    onFrame(() => {
      x = lerp(x, tx, 0.2); y = lerp(y, ty, 0.2);
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });
  }

  /* =======================================================================
     Reveal on enter + word-split headlines
     ===================================================================== */
  function splitHeadlines() {
    $$('[data-split]').forEach(el => {
      if (el.dataset.splitDone) return;
      const words = el.textContent.trim().split(/\s+/);
      el.textContent = '';
      el.classList.add('split');
      words.forEach((w, i) => {
        const outer = document.createElement('span');
        outer.className = 'split__word';
        const inner = document.createElement('span');
        inner.textContent = w;
        inner.style.setProperty('--d', `${i * 55}ms`);
        outer.appendChild(inner);
        el.appendChild(outer);
        if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
      });
      el.dataset.splitDone = '1';
    });
  }

  function reveals() {
    const items = $$('[data-reveal], [data-split]');
    if (!items.length) return;
    if (!('IntersectionObserver' in window)) {
      items.forEach(el => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    items.forEach(el => io.observe(el));

    // Anything already on screen at load plays straight away — the observer's
    // bottom margin would otherwise leave first-viewport content invisible.
    requestAnimationFrame(() => {
      items.forEach(el => {
        if (el.getBoundingClientRect().top < window.innerHeight * 0.98) {
          el.classList.add('is-in');
          io.unobserve(el);
        }
      });
    });
  }

  /* =======================================================================
     Count-up numbers
     ===================================================================== */
  function counters() {
    const nums = $$('[data-count]');
    if (!nums.length) return;
    const run = el => {
      const to = parseFloat(el.dataset.count);
      const dur = 1500;
      const t0 = performance.now();
      const step = now => {
        const p = clamp((now - t0) / dur, 0, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = to * eased;
        el.textContent = to % 1 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US');
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if (reduced() || !('IntersectionObserver' in window)) {
      nums.forEach(el => { el.textContent = Number(el.dataset.count).toLocaleString('en-US'); });
      return;
    }
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
    }), { threshold: 0.5 });
    nums.forEach(el => io.observe(el));
  }

  /* =======================================================================
     Marquee — velocity reacts to scroll direction
     ===================================================================== */
  function marquees() {
    $$('.marquee').forEach(root => {
      const track = $('.marquee__track', root);
      if (!track) return;
      const base = parseFloat(root.dataset.speed || '0.6');
      const dir  = root.dataset.dir === 'rtl' ? -1 : 1;

      // duplicate content until it comfortably overflows twice
      const original = track.innerHTML;
      let guard = 0;
      while (track.scrollWidth < root.offsetWidth * 2 && guard++ < 12) {
        track.innerHTML += original;
      }
      const half = track.scrollWidth / 2;
      let x = 0, boost = 0, lastY = window.scrollY;

      window.addEventListener('scroll', () => {
        boost = clamp((window.scrollY - lastY) * 0.35, -22, 22);
        lastY = window.scrollY;
      }, { passive: true });

      if (reduced()) return;
      onFrame(() => {
        boost = lerp(boost, 0, 0.06);
        x -= (base + Math.abs(boost) * 0.4) * dir + boost * dir;
        if (x <= -half) x += half;
        if (x > 0) x -= half;
        track.style.transform = `translate3d(${x}px,0,0)`;
      });
    });
  }

  /* =======================================================================
     Parallax + horizontal rail driven by scroll
     ===================================================================== */
  function scrollDriven() {
    const rails = $$('[data-rail]');
    const paras = $$('[data-parallax]');
    if (!rails.length && !paras.length) return;

    const state = new Map();
    onFrame(() => {
      const vh = window.innerHeight;

      paras.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        const p = (r.top + r.height / 2 - vh / 2) / vh;   // -1..1
        const amt = parseFloat(el.dataset.parallax || '30');
        el.style.transform = `translate3d(0, ${(-p * amt).toFixed(2)}px, 0)`;
      });

      rails.forEach(root => {
        const track = $('.rail__track', root);
        const bar = $('.rail__bar i', root);
        if (!track) return;
        const r = root.getBoundingClientRect();
        const travel = Math.max(0, track.scrollWidth - window.innerWidth + 32);
        // progress across the sticky-ish window
        const span = r.height - vh;
        const p = span > 0 ? clamp(-r.top / span, 0, 1) : clamp((vh - r.top) / (vh + r.height), 0, 1);
        const prev = state.get(root) || 0;
        const next = reduced() ? p : lerp(prev, p, 0.12);
        state.set(root, next);
        track.style.transform = `translate3d(${(-next * travel).toFixed(2)}px,0,0)`;
        if (bar) bar.style.transform = `scaleX(${clamp(next, 0.05, 1) * 5})`;
      });
    });
  }

  /* =======================================================================
     ASCII field renderer (hero)
     A canvas full of monospace glyphs whose density follows a moving
     field — wave interference + a spinning "wheel" + cursor ripple.
     ===================================================================== */
  const RAMP = ' .·:-=+*#%@';

  function asciiField(canvas) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let cols = 0, rows = 0, cw = 0, ch = 0, dpr = 1;
    let mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5;
    const fontSize = () => (window.innerWidth < 700 ? 9 : 13);

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || canvas.parentElement.clientWidth;
      const h = canvas.clientHeight || canvas.parentElement.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      const fs = fontSize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${fs}px ui-monospace, "IBM Plex Mono", monospace`;
      ctx.textBaseline = 'top';
      cw = ctx.measureText('M').width || fs * 0.6;
      ch = fs * 1.18;
      cols = Math.ceil(w / cw);
      rows = Math.ceil(h / ch);
    }

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      tmx = (e.clientX - r.left) / r.width;
      tmy = (e.clientY - r.top) / r.height;
    }, { passive: true });

    resize();

    let visible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(canvas);
    }

    let t0 = performance.now();
    onFrame(now => {
      if (!visible || !cols) return;
      const t = reduced() ? 0 : (now - t0) / 1000;
      mx = lerp(mx, tmx, 0.06); my = lerp(my, tmy, 0.06);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const ar = (cols * cw) / (rows * ch || 1);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const u = (x / cols - 0.5) * 2 * ar;
          const v = (y / rows - 0.5) * 2;

          // spinning wheel: radial spokes + rim
          const dx = u - (mx - 0.5) * 0.9;
          const dy = v - (my - 0.5) * 0.9;
          const rad = Math.hypot(dx, dy);
          const ang = Math.atan2(dy, dx);
          const spokes = Math.cos(ang * 12 + t * 1.9) * Math.exp(-Math.pow(rad * 1.5, 2)) * 1.4;
          const rim  = Math.exp(-Math.pow((rad - 0.62 - Math.sin(t * 0.5) * 0.04) * 9, 2)) * 1.5;
          const hub  = Math.exp(-Math.pow(rad * 9, 2)) * 1.5;

          // road: travelling waves under the wheel
          const road = Math.sin(u * 1.8 + t * 1.2) * 0.34 + Math.sin(v * 6.5 - t * 2.4) * 0.2;

          let f = spokes + rim + hub + road;
          f = (f + 1) / 2;                       // 0..1
          f *= 1 - Math.pow(Math.abs(v), 2.1) * 0.42;   // vignette top/bottom

          const idx = clamp(Math.floor(f * RAMP.length), 0, RAMP.length - 1);
          const chr = RAMP[idx];
          if (chr === ' ') continue;

          const hot = f > 0.72;
          ctx.fillStyle = hot
            ? `rgba(225,29,46,${clamp(f * 1.15, 0, 1).toFixed(3)})`
            : `rgba(196,194,189,${clamp(f * 0.62, 0, 1).toFixed(3)})`;
          ctx.fillText(chr, x * cw, y * ch);
        }
      }
    });
  }

  /* =======================================================================
     ASCII frame players — cycle hand-made art frames in a <pre>
     ===================================================================== */
  const ART = {
    wrench: [
`     .-\"\"-.                 .-\"\"-.
    /  __  \\               /  __  \\
   |  /  \\  |=============|  |  |  |
   |  \\__/  |             |  \\__/  |
    \\      /               \\      /
     '-..-'                 '-..-'
   ................................
      T O R Q U E   T O   S P E C`,
`     .-\"\"-.                 .-\"\"-.
    /  ##  \\               /  ##  \\
   |  |##|  |=============|  |##|  |
   |  \\##/  |             |  \\##/  |
    \\      /               \\      /
     '-..-'                 '-..-'
   ::::::::::::::::::::::::::::::::
      T O R Q U E   T O   S P E C`,
`     .-\"\"-.                 .-\"\"-.
    /  __  \\               /  __  \\
   |  /  \\  |=============|  |  |  |
   |  \\__/  |             |  \\__/  |
    \\      /               \\      /
     '-..-'                 '-..-'
   ################################
      M O T O   M A R K E T   3 6 0`
    ],
    drop: [
`         .
        / \\
       /   \\
      /     \\
     |   .   |
     |  ' '  |
      \\     /
       '---'
   10W-40  FULL SYNTH`,
`         .
        /|\\
       /:::\\
      /:::::\\
     |:::::::|
     |:::::::|
      \\:::::/
       '---'
   10W-40  FULL SYNTH`,
`         .
        / \\
       /~~~\\
      /~~~~~\\
     |~~~~~~~|
     |~~~~~~~|
      \\~~~~~/
       '---'
   10W-40  FULL SYNTH`
    ],
    helmet: [
`        _.-''''-._
      .'  ______  '.
     /  .'      '.  \\
    |  /  ______  \\  |
    | |  /      \\  | |
    | | |________| | |
     \\ \\          / /
      '.\\________/.'
        '-.____.-'
      DOT / ECE 22.06`,
`        _.-''''-._
      .'  ______  '.
     /  .'######'.  \\
    |  /  ######  \\  |
    | |  /######\\  | |
    | | |########| | |
     \\ \\          / /
      '.\\________/.'
        '-.____.-'
      DOT / ECE 22.06`
    ]
  };

  function asciiPlayers() {
    $$('[data-ascii]').forEach(pre => {
      const frames = ART[pre.dataset.ascii];
      if (!frames) return;
      pre.textContent = frames[0];
      if (reduced() || frames.length < 2) return;
      let i = 0, live = false;
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(es => { live = es[0].isIntersecting; }, { threshold: 0.2 }).observe(pre);
      } else live = true;
      setInterval(() => {
        if (!live) return;
        i = (i + 1) % frames.length;
        pre.textContent = frames[i];
      }, 420);
    });
  }

  /* =======================================================================
     Scramble text on reveal / hover
     ===================================================================== */
  function scramble() {
    const CHARS = '█▓▒░#@%*+=-:.';
    const run = el => {
      const final = el.dataset.final || el.textContent;
      el.dataset.final = final;
      let f = 0;
      const total = 18;
      const id = setInterval(() => {
        f++;
        const done = Math.floor((f / total) * final.length);
        el.textContent = final.slice(0, done) +
          final.slice(done).replace(/\S/g, () => CHARS[(Math.random() * CHARS.length) | 0]);
        if (f >= total) { clearInterval(id); el.textContent = final; }
      }, 32);
    };
    const els = $$('[data-scramble]');
    if (!els.length) return;
    if (reduced() || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
    }), { threshold: 0.6 });
    els.forEach(el => io.observe(el));
    els.forEach(el => el.addEventListener('mouseenter', () => run(el)));
  }

  /* =======================================================================
     Toast
     ===================================================================== */
  let toastTimer;
  function toast(msg) {
    let el = $('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add('is-up'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-up'), 2600);
  }

  /* =======================================================================
     Cart — localStorage backed, shared across pages
     ===================================================================== */
  const CART_KEY = 'mm.cart.v1';
  const cart = {
    read() {
      try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
      catch { return []; }
    },
    write(items) {
      try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch {}
      cart.render();
    },
    add(item) {
      const items = cart.read();
      const hit = items.find(i => i.id === item.id);
      if (hit) hit.qty += 1; else items.push({ ...item, qty: 1 });
      cart.write(items);
      toast(`${item.name} added`);
    },
    bump(id, delta) {
      let items = cart.read();
      const hit = items.find(i => i.id === id);
      if (!hit) return;
      hit.qty += delta;
      if (hit.qty <= 0) items = items.filter(i => i.id !== id);
      cart.write(items);
    },
    total() { return cart.read().reduce((s, i) => s + i.price * i.qty, 0); },
    count() { return cart.read().reduce((s, i) => s + i.qty, 0); },
    render() {
      const n = cart.count();
      $$('[data-cart-count]').forEach(el => {
        el.textContent = n;
        el.style.display = n ? '' : 'none';
      });
      const body = $('[data-cart-body]');
      if (!body) return;
      const items = cart.read();
      body.innerHTML = items.length
        ? items.map(i => `
          <div class="drawer__line">
            <div>
              <h4>${esc(i.name)}</h4>
              <p class="label">${esc(i.cat)}</p>
              <div class="qty">
                <button type="button" data-qty="-1" data-id="${esc(i.id)}" aria-label="Decrease quantity">−</button>
                <span>${i.qty}</span>
                <button type="button" data-qty="1" data-id="${esc(i.id)}" aria-label="Increase quantity">+</button>
              </div>
            </div>
            <div class="card__price">৳${(i.price * i.qty).toLocaleString('en-US')}</div>
          </div>`).join('')
        : `<p class="lede" style="font-size:1rem">Your cart is empty. The table is waiting.</p>`;

      const tot = $('[data-cart-total]');
      if (tot) tot.textContent = `৳${cart.total().toLocaleString('en-US')}`;
      const wa = $('[data-cart-wa]');
      if (wa) {
        const lines = items.map(i => `• ${i.name} ×${i.qty} — ৳${i.price * i.qty}`).join('\n');
        const text = items.length
          ? `Assalamu alaikum, Moto Market. I'd like to order:\n${lines}\n\nTotal: ৳${cart.total()}`
          : `Assalamu alaikum, Moto Market. I'd like to ask about a part.`;
        wa.href = `https://wa.me/8801711154387?text=${encodeURIComponent(text)}`;
      }
    }
  };

  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function cartWiring() {
    cart.render();

    document.addEventListener('click', e => {
      const add = e.target.closest('[data-add]');
      if (add) {
        cart.add({
          id: add.dataset.add,
          name: add.dataset.name,
          cat: add.dataset.cat || '',
          price: Number(add.dataset.price) || 0
        });
        openDrawer(true);
        return;
      }
      const q = e.target.closest('[data-qty]');
      if (q) { cart.bump(q.dataset.id, Number(q.dataset.qty)); return; }
      if (e.target.closest('[data-drawer-open]'))  { openDrawer(true);  return; }
      if (e.target.closest('[data-drawer-close]')) { openDrawer(false); return; }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') openDrawer(false);
    });
  }

  function openDrawer(open) {
    const d = $('.drawer'); const s = $('.scrim');
    if (!d) return;
    d.classList.toggle('is-open', open);
    if (s) s.classList.toggle('is-open', open);
    document.body.classList.toggle('is-locked', open);
    d.setAttribute('aria-hidden', String(!open));
  }

  /* =======================================================================
     Shop filters
     ===================================================================== */
  function filters() {
    const chips = $$('[data-filter]');
    if (!chips.length) return;
    const cards = $$('[data-cat]');
    const countEl = $('[data-result-count]');

    const apply = key => {
      let n = 0;
      cards.forEach(c => {
        const show = key === 'all' || c.dataset.cat === key;
        c.classList.toggle('is-hidden', !show);
        if (show) n++;
      });
      chips.forEach(ch => ch.setAttribute('aria-pressed', String(ch.dataset.filter === key)));
      if (countEl) countEl.textContent = String(n).padStart(2, '0');
      const url = new URL(location.href);
      if (key === 'all') url.searchParams.delete('cat'); else url.searchParams.set('cat', key);
      history.replaceState(null, '', url);
    };

    chips.forEach(ch => ch.addEventListener('click', () => apply(ch.dataset.filter)));
    const initial = new URL(location.href).searchParams.get('cat');
    apply(initial && chips.some(c => c.dataset.filter === initial) ? initial : 'all');
  }

  /* =======================================================================
     Booking form — no backend; hands off to WhatsApp / mail
     ===================================================================== */
  function bookingForm() {
    const form = $('[data-booking]');
    if (!form) return;

    // prefill service from ?service=
    const want = new URL(location.href).searchParams.get('service');
    if (want) {
      const hit = form.querySelector(`input[name="service"][value="${CSS.escape(want)}"]`);
      if (hit) hit.checked = true;
    }

    // don't let someone book yesterday
    const date = form.querySelector('input[type="date"]');
    if (date) date.min = new Date().toISOString().slice(0, 10);

    form.addEventListener('submit', e => {
      e.preventDefault();
      const d = new FormData(form);
      const services = d.getAll('service');
      if (!services.length) { toast('Pick at least one service'); return; }

      const body =
`NEW BOOKING — MOTO MARKET

Name:     ${d.get('name')}
Phone:    ${d.get('phone')}
Vehicle:  ${d.get('vehicle') || '—'}
Services: ${services.join(', ')}
Date:     ${d.get('date') || '—'}
Slot:     ${d.get('slot') || '—'}

Notes:
${d.get('notes') || '—'}`;

      const out = $('[data-booking-out]');
      if (out) {
        out.hidden = false;
        $('[data-book-wa]', out).href =
          `https://wa.me/8801711154387?text=${encodeURIComponent(body)}`;
        $('[data-book-mail]', out).href =
          `mailto:motolubebangladesh@gmail.com?subject=${encodeURIComponent('Booking — ' + d.get('name'))}&body=${encodeURIComponent(body)}`;
        out.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
      }
      toast('Booking ready — send it through');
    });
  }

  /* =======================================================================
     Boot
     ===================================================================== */
  function boot() {
    splitHeadlines();
    reveals();
    progressBar();
    navBehaviour();
    cursor();
    counters();
    marquees();
    scrollDriven();
    asciiPlayers();
    scramble();
    cartWiring();
    filters();
    bookingForm();
    const heroCanvas = $('.hero__ascii');
    if (heroCanvas) asciiField(heroCanvas);
    document.documentElement.classList.add('js-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})();
