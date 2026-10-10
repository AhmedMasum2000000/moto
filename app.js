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

    // Anything else that sticks to the top (the shop's category rail) has to
    // sit below the nav while it is showing, and take its place once it hides.
    const setOffset = hidden => document.documentElement.style.setProperty(
      '--nav-h', hidden ? '0px' : Math.round(nav.getBoundingClientRect().height) + 'px');
    setOffset(false);
    window.addEventListener('resize', () => setOffset(nav.classList.contains('is-hidden')), { passive: true });

    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      nav.classList.toggle('is-stuck', y > 24);
      const hide = y > 400 && y > last && !document.body.classList.contains('is-locked');
      nav.classList.toggle('is-hidden', hide);
      setOffset(hide);
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
    const track = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      tmx = (cx - r.left) / r.width;
      tmy = (cy - r.top) / r.height;
    };
    window.addEventListener('mousemove', e => track(e.clientX, e.clientY), { passive: true });
    window.addEventListener('touchmove', e => {
      const t = e.touches[0];
      if (t) track(t.clientX, t.clientY);
    }, { passive: true });

    resize();

    let visible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(canvas);
    }

    // Scroll velocity feeds the field: the wheel spins up and the glyphs run
    // hotter while the page is moving, then settle when the reader stops.
    let spin = 0, heat = 0, lastY = window.scrollY, vel = 0;
    window.addEventListener('scroll', () => {
      vel = clamp(Math.abs(window.scrollY - lastY) / 45, 0, 1);
      lastY = window.scrollY;
    }, { passive: true });

    let t0 = performance.now(), prev = t0;
    onFrame(now => {
      if (!visible || !cols) return;
      const dt = Math.min((now - prev) / 1000, 0.05); prev = now;
      heat = lerp(heat, vel, 0.08); vel *= 0.9;
      spin += dt * (1 + heat * 5);
      const t = reduced() ? 0 : (now - t0) / 1000 + spin * 2;
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

          const hot = f > 0.72 - heat * 0.18;
          ctx.fillStyle = hot
            ? `rgba(220,18,56,${clamp(f * 1.15, 0, 1).toFixed(3)})`
            : `rgba(198,196,204,${clamp(f * 0.62, 0, 1).toFixed(3)})`;
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
     Magnetic buttons — the primary actions lean toward the pointer, so the
     cursor is pulled to the thing we want clicked before the reader decides.
     ===================================================================== */
  function magnetic() {
    if (reduced() || window.matchMedia('(pointer: coarse)').matches) return;
    $$('[data-magnetic]').forEach(el => {
      let rx = 0, ry = 0, tx = 0, ty = 0, live = false, stop = null;
      const pull = e => {
        const r = el.getBoundingClientRect();
        tx = (e.clientX - (r.left + r.width / 2)) * 0.3;
        ty = (e.clientY - (r.top + r.height / 2)) * 0.4;
      };
      el.addEventListener('mouseenter', () => {
        if (live) return;
        live = true;
        stop = onFrame(() => {
          rx = lerp(rx, tx, 0.18); ry = lerp(ry, ty, 0.18);
          el.style.transform = `translate3d(${rx.toFixed(2)}px, ${ry.toFixed(2)}px, 0)`;
          if (!live && Math.abs(rx) < 0.1 && Math.abs(ry) < 0.1) {
            el.style.transform = ''; stop && stop(); stop = null;
          }
        });
      });
      el.addEventListener('mousemove', pull);
      el.addEventListener('mouseleave', () => { tx = 0; ty = 0; live = false; });
    });
  }

  /* =======================================================================
     Pointer-reactive tilt on cards
     ===================================================================== */
  function tilt() {
    if (reduced() || window.matchMedia('(pointer: coarse)').matches) return;
    $$('[data-tilt]').forEach(el => {
      el.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform =
          `perspective(900px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 5).toFixed(2)}deg)`;
      });
      el.addEventListener('mouseleave', () => { el.style.transform = ''; });
      el.style.transition = 'transform .5s var(--ease)';
      el.addEventListener('mouseenter', () => { el.style.transition = 'transform .12s linear'; });
    });
  }

  /* =======================================================================
     The spine — a red thread that fills as the reader descends, with a dot
     per chapter that lights when that chapter is the one on screen.
     ===================================================================== */
  function spine() {
    const root = $('.spine');
    const fill = $('.spine__fill');
    if (!root || !fill) return;

    const marks = $$('[data-reveal].chapter__no, .chapter__no');
    const dots = marks.map(() => {
      const d = document.createElement('span');
      d.className = 'spine__dot';
      root.appendChild(d);
      return d;
    });

    const place = () => {
      const docH = document.documentElement.scrollHeight;
      marks.forEach((m, i) => {
        const top = m.getBoundingClientRect().top + window.scrollY;
        dots[i].style.top = `${(top / docH) * 100}%`;
      });
    };
    place();
    window.addEventListener('resize', place, { passive: true });
    window.addEventListener('load', place);

    let cur = 0;
    onFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const target = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
      cur = lerp(cur, target, 0.12);
      fill.style.transform = `scaleY(${cur.toFixed(4)})`;
      const vh = window.innerHeight;
      marks.forEach((m, i) => {
        const r = m.getBoundingClientRect();
        dots[i].classList.toggle('is-on', r.top < vh * 0.6 && r.bottom > 0);
      });
    });
  }

  /* =======================================================================
     Sticky action bar — appears once the reader is past the hero, so the
     next step is always one thumb-reach away on a phone.
     ===================================================================== */
  function actionBar() {
    const bar = $('.actionbar');
    if (!bar) return;
    window.addEventListener('scroll', () => {
      bar.classList.toggle('is-up', window.scrollY > window.innerHeight * 0.75);
    }, { passive: true });
  }

  /* =======================================================================
     Touch motion. A phone has no cursor, so magnetic pull and pointer tilt
     never fire. These give the same aliveness from the finger and from
     scroll position instead.
     ===================================================================== */
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

  // The rail is a native snap carousel on small screens. Drive the progress
  // bar from its own scrollLeft, and fade the cards either side of centre.
  function railTouch() {
    $$('[data-rail]').forEach(root => {
      const track = $('.rail__track', root);
      const bar = $('.rail__bar i', root);
      if (!track) return;
      const cards = $$('.rail__card', track);

      const update = () => {
        if (!isTouch() && window.innerWidth > 860) return;
        const max = track.scrollWidth - track.clientWidth;
        const p = max > 0 ? clamp(track.scrollLeft / max, 0, 1) : 0;
        if (bar) bar.style.transform = `scaleX(${clamp(p, 0.05, 1) * 5})`;
        const mid = track.scrollLeft + track.clientWidth / 2;
        cards.forEach(c => {
          const centre = c.offsetLeft + c.offsetWidth / 2;
          c.classList.toggle('is-off', Math.abs(centre - mid) > c.offsetWidth * 0.62);
        });
      };
      track.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update, { passive: true });
      update();
    });
  }

  // Scroll-linked lift: whatever sits nearest the middle of a phone screen
  // gets the emphasis a hover would have given it on a desktop.
  function scrollFocus() {
    if (!isTouch() || reduced()) return;
    const svcs = $$('.svc');
    const tilts = $$('[data-tilt]');
    if (!svcs.length && !tilts.length) return;

    onFrame(() => {
      const mid = window.innerHeight * 0.5;

      svcs.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) {
          el.classList.remove('is-focus');
          return;
        }
        const centre = r.top + r.height / 2;
        el.classList.toggle('is-focus', Math.abs(centre - mid) < r.height * 0.6);
      });

      tilts.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -100 || r.top > window.innerHeight + 100) return;
        const d = (r.top + r.height / 2 - mid) / window.innerHeight;  // -1..1
        el.style.transform = `translate3d(0, ${(d * -7).toFixed(2)}px, 0)`;
      });
    });
  }

  /* =======================================================================
     Footer wordmark. Drawn as an SVG stroke so it stays smooth at display
     size; the viewBox is fitted to the rendered glyphs so the word always
     spans the full width, whatever the word or the loaded font turns out
     to be. The dash length is derived from that measurement so the draw-on
     paces the same for a short word as a long one.
     ===================================================================== */
  function wordmark() {
    const fit = () => {
      $$('.footer__word').forEach(svg => {
        const text = $('text', svg);
        if (!text) return;
        let box;
        try { box = text.getBBox(); } catch { return; }
        if (!box.width) return;
        const pad = 4;
        svg.setAttribute('viewBox',
          `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
        const len = (box.width + box.height) * 3.2;
        text.style.strokeDasharray = len;
        if (!svg.classList.contains('is-in')) text.style.strokeDashoffset = len;
      });
    };
    fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    window.addEventListener('resize', fit, { passive: true });
  }

  /* =======================================================================
     Service tabs. The grid is a list of titles; choosing one opens its
     detail below. Panels start visible in the markup and are hidden here,
     so a reader without JavaScript still gets all eight in full.
     ===================================================================== */
  function serviceTabs() {
    const detail = $('[data-svc-detail]');
    const tabs = $$('[data-svc]');
    if (!detail || !tabs.length) return;
    const panels = $$('[data-panel]', detail);

    const show = (id, moveFocus) => {
      let hit = false;
      panels.forEach(p => {
        const on = p.dataset.panel === id;
        p.hidden = !on;
        p.classList.toggle('is-in', on);
        if (on) hit = true;
      });
      if (!hit) return false;
      tabs.forEach(t => {
        const on = t.dataset.svc === id;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        if (on && moveFocus) t.focus();
      });
      return true;
    };

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        show(tab.dataset.svc);
        history.replaceState(null, '', '#' + tab.dataset.svc);
        // on a phone the detail opens below the fold, so bring it into view
        if (window.innerWidth <= 860) {
          detail.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        }
      });

      // a tablist is arrow-navigable
      tab.addEventListener('keydown', e => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        const step = keys[e.key];
        if (!step) return;
        e.preventDefault();
        const i = tabs.indexOf(tab);
        show(tabs[(i + step + tabs.length) % tabs.length].dataset.svc, true);
      });
    });

    // deep link: /#tyres opens that panel, on load and on any later hash change
    const fromHash = () => {
      const wanted = location.hash.replace('#', '');
      if (!wanted || !show(wanted)) show(tabs[0].dataset.svc);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
  }

  /* =======================================================================
     Fitment check. Type, then brand, then model — each step unlocks the next.
     The chosen vehicle is remembered and shown on the shop page. We never
     claim a part fits: the page narrows it down, the counter confirms it.
     ===================================================================== */
  const FIT_KEY = 'mm.vehicle.v1';
  const SITE = 'https://ahmedmasum2000000.github.io/moto/';
  const PHONE = '8801711154387';

  function vehicleData() {
    const el = $('#vehicle-data');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch { return null; }
  }

  function readVehicle() {
    try {
      const v = JSON.parse(localStorage.getItem(FIT_KEY));
      return v && v.brand && v.model && (v.type === 'bike' || v.type === 'car') ? v : null;
    } catch { return null; }
  }

  // Saving or forgetting the ride tells every listener on the page at once,
  // so the garage bar under the slider updates without a reload.
  function saveVehicle(v) {
    try { localStorage.setItem(FIT_KEY, JSON.stringify(v)); } catch {}
    window.dispatchEvent(new CustomEvent('mm:vehicle', { detail: v }));
  }
  function forgetVehicle() {
    try { localStorage.removeItem(FIT_KEY); } catch {}
    window.dispatchEvent(new CustomEvent('mm:vehicle', { detail: null }));
  }

  const ICONS = {
    drop:   '<path d="M12 3s-6 6.2-6 10.6a6 6 0 0 0 12 0C18 9.2 12 3 12 3z"/><path d="M9.6 14.4a2.5 2.5 0 0 0 2.4 2.4"/>',
    tyre:   '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-5.7 5.7a1.9 1.9 0 0 0 2.7 2.7l5.7-5.7a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.4-.4-2.4z"/>',
    chat:   '<path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.5-4.4a8.4 8.4 0 1 1 15.5-4.5z"/><path d="M9 10.5h6M9 13.5h4"/>',
    helmet: '<path d="M3.5 16a8.5 8.5 0 0 1 17 0v2.5h-17z"/><path d="M12 7.5V13h8.4"/>',
    bell:   '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    phone:  '<path d="M5 3.5h3l1.5 4-2 1.2a11 11 0 0 0 5 5l1.2-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 3 5.7 2 2 0 0 1 5 3.5z"/>',
    pin:    '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    wash:   '<path d="M7 4s-3 3.2-3 5.5a3 3 0 0 0 6 0C10 7.2 7 4 7 4zM17 9s-3.5 3.7-3.5 6.4a3.5 3.5 0 0 0 7 0C20.5 12.7 17 9 17 9z"/>',
    spray:  '<path d="M8.5 9h7v11.5h-7z"/><path d="M10.5 9V6h3v3M16 5h2.5M16 2.8l2-1M16 7.2l2 1"/>',
  };
  const ico = name => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const wa = text => `https://wa.me/${PHONE}?text=${encodeURIComponent(text)}`;

  /* =======================================================================
     Fitment scanner. Type the model and jump straight to it, or tap through
     bike-or-car, brand, model. The ride is saved to the visitor's garage and
     every page reads it back: the shop names it, the booking form fills it
     in, and this widget greets it on the next visit. Fit itself is confirmed
     at the counter — nothing here claims a part fits.
     ===================================================================== */
  function fitment() {
    const root = $('[data-fitment]');
    const DATA = vehicleData();
    if (!root || !DATA) return;

    const picker   = $('[data-fit-picker]', root);
    const result   = $('[data-fit-result]', root);
    const status   = $('[data-fit-status]', root);
    const live     = $('[data-fit-live]', root);
    const brandsEl = $('[data-fit-brands]', root);
    const modelsEl = $('[data-fit-models]', root);
    const stepEls  = $$('[data-step]', root);
    const segs     = $$('[data-fit-seg]', root);
    const stepNote = $('[data-fit-stepcount]', root);
    const q        = $('[data-fit-q]', root);
    const suggest  = $('[data-fit-suggest]', root);
    const remind   = $('[data-fit-remind]', root);

    const has = (t, b, m) => !!(DATA[t] && (!b || (DATA[t][b] && (!m || DATA[t][b].includes(m)))));
    const count = t => Object.values(DATA[t] || {}).reduce((s, m) => s + m.length, 0);

    // every number on the widget is counted from the data it ships with
    $$('[data-type-count]', root).forEach(el => { el.textContent = `${count(el.dataset.typeCount)} models`; });
    const makers = new Set([...Object.keys(DATA.bike || {}), ...Object.keys(DATA.car || {})]).size;
    const countEl = $('[data-fit-count]', root);
    if (countEl) countEl.textContent = `${count('bike') + count('car')} models · ${makers} makers · bike & car`;

    const state = { type: null, brand: null, model: null };
    let shownBrands, shownModels, current = null, scanT = 0;
    const launchTimers = new WeakMap();

    const say = msg => { if (live) live.textContent = msg; };
    const setStatus = (s, label) => { status.dataset.state = s; $('span', status).textContent = label; };
    const chip = (v, n, i, on) =>
      `<button type="button" class="fit__chip" data-v="${esc(v)}" aria-pressed="${on}" style="--i:${i}">` +
      `${esc(v)}${n != null ? `<small>${n}</small>` : ''}</button>`;

    function render() {
      $$('[data-fit-type]', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fitType === state.type)));

      // lists are rebuilt only when what they list changes, so picking a chip
      // does not replay the entry animation of the row it sits in
      if (shownBrands !== state.type) {
        shownBrands = state.type;
        const brands = state.type ? Object.keys(DATA[state.type]) : [];
        brandsEl.innerHTML = brands.map((b, i) => chip(b, DATA[state.type][b].length, i, b === state.brand)).join('');
      } else {
        $$('.fit__chip', brandsEl).forEach(c => c.setAttribute('aria-pressed', String(c.dataset.v === state.brand)));
      }
      const key = `${state.type}|${state.brand}`;
      if (shownModels !== key) {
        shownModels = key;
        const models = state.type && state.brand ? DATA[state.type][state.brand] : [];
        modelsEl.innerHTML = models.map((m, i) => chip(m, null, i, m === state.model)).join('');
      } else {
        $$('.fit__chip', modelsEl).forEach(c => c.setAttribute('aria-pressed', String(c.dataset.v === state.model)));
      }

      stepEls[1].toggleAttribute('data-locked', !state.type);
      stepEls[2].toggleAttribute('data-locked', !state.brand);

      const done = [state.type, state.brand, state.model].filter(Boolean).length;
      segs.forEach((s, i) => s.classList.toggle('is-on', i < done));
      stepNote.textContent = done >= 3 ? 'Locked in' : `Step ${done + 1} of 3`;
      if (!state.model) setStatus(done ? 'scanning' : 'ready', done ? 'Scanning' : 'Ready');
    }

    // a choice higher up the chain clears everything below it
    function pick(next, fromKeyboard) {
      if (!has(next.type, next.brand, next.model)) return;
      clearTimeout(scanT);
      state.type = next.type || null;
      state.brand = next.brand || null;
      state.model = next.model || null;
      render();

      if (state.model) { lock(); return; }
      if (state.brand) {
        say(`${state.brand}: ${DATA[state.type][state.brand].length} models. Pick yours.`);
        if (fromKeyboard) { const c = $('.fit__chip', modelsEl); if (c) c.focus(); }
      } else if (state.type) {
        say(`${Object.keys(DATA[state.type]).length} ${state.type} makers. Pick the badge.`);
        if (fromKeyboard) { const c = $('.fit__chip', brandsEl); if (c) c.focus(); }
      }
    }

    function lock() {
      const v = { type: state.type, brand: state.brand, model: state.model, savedAt: Date.now() };
      saveVehicle(v);
      setStatus('scanning', 'Scanning');
      root.classList.add('is-scanning');
      picker.inert = true;
      clearTimeout(scanT);
      scanT = setTimeout(() => {
        picker.inert = false;
        root.classList.remove('is-scanning');
        showResult(v, false);
      }, reduced() ? 0 : 680);
    }

    function actionsFor(v) {
      const name = `${v.brand} ${v.model}`;
      const book = s => `book.html?service=${encodeURIComponent(s)}&vehicle=${encodeURIComponent(name)}`;
      // the catalogue is motorcycle stock, so a car never gets sent to it
      if (v.type === 'car') return {
        primary: { href: book('Servicing'), label: `Book a service for my ${v.model}` },
        tiles: [
          { i: 'chat',  t: 'Ask about parts', s: 'WhatsApp the bay', ext: 1,
            href: wa(`Assalamu alaikum, Moto Market. I drive a ${name}. Which parts and engine oil can you get for it?`) },
          { i: 'wash',  t: 'Wash it',         s: 'Foam wash & detail',   href: book('Washing') },
          { i: 'spray', t: 'Paint work',      s: 'Panel or full respray', href: book('Painting') },
          { i: 'bell',  t: 'Service reminder', s: 'Add it to your calendar', remind: 1 },
          { i: 'phone', t: 'Call the bay',    s: '+880 1711-154387', href: 'tel:+8801711154387' },
          { i: 'pin',   t: 'Directions',      s: 'R.A. Khan Chowdhury Rd', ext: 1,
            href: 'https://maps.google.com/?q=R.A.+Khan+Chowdhury+Road+Kushtia+7000' },
        ],
      };
      return {
        primary: { href: wa(`Assalamu alaikum, Moto Market. I ride a ${name}. Can you confirm which parts fit it?`),
                   label: `Check what fits my ${v.model}`, ext: 1 },
        tiles: [
          { i: 'drop',   t: 'Engine oil',      s: 'Dealer brands, sealed',  href: 'shop.html?cat=oil' },
          { i: 'tyre',   t: 'Tyres',           s: 'Fitted while you wait',  href: 'shop.html?cat=tyres' },
          { i: 'wrench', t: 'Book a service',  s: 'Price agreed first',     href: book('Servicing') },
          { i: 'wrench', t: 'Spare parts',     s: 'Genuine & aftermarket', href: 'shop.html?cat=parts' },
          { i: 'helmet', t: 'Riding gear',     s: 'Certified lids only',    href: 'shop.html?cat=helmets' },
          { i: 'bell',   t: 'Service reminder', s: 'Add it to your calendar', remind: 1 },
        ],
      };
    }

    function showResult(v, returning) {
      const plan = actionsFor(v);
      current = v;
      picker.hidden = true;
      result.hidden = false;
      root.classList.add('is-matched');
      setStatus('matched', 'Saved');

      $('[data-fit-welcome]', result).textContent = returning ? 'Welcome back — still riding this?' : 'Locked in';
      $('[data-fit-ride-brand]', result).textContent = v.brand;
      $('[data-fit-ride-model]', result).textContent = v.model;
      const cta = $('[data-fit-primary]', result);
      cta.href = plan.primary.href;
      if (plan.primary.ext) { cta.target = '_blank'; cta.rel = 'noopener'; } else { cta.removeAttribute('target'); cta.removeAttribute('rel'); }
      $('[data-fit-primary-l]', cta).textContent = plan.primary.label;

      $('[data-fit-actions]', result).innerHTML = plan.tiles.map(a => a.remind
        ? `<button type="button" class="fit__act" data-remind-toggle aria-expanded="false" aria-controls="fit-remind">${ico(a.i)}<b>${esc(a.t)}</b><small>${esc(a.s)}</small></button>`
        : `<a class="fit__act" href="${esc(a.href)}"${a.ext ? ' target="_blank" rel="noopener"' : ''}>${ico(a.i)}<b>${esc(a.t)}</b><small>${esc(a.s)}</small></a>`
      ).join('');

      remind.hidden = true;
      $('[data-remind-name]', remind).textContent = `${v.brand} ${v.model}`;
      setReminder(2);

      say(returning ? `Welcome back. Your saved ride is the ${v.brand} ${v.model}.`
                    : `Matched: ${v.brand} ${v.model}. Saved to your garage.`);
      if (!returning) { result.focus({ preventScroll: true }); bringIntoView(); }
    }

    function bringIntoView() {
      if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    }

    function backToPicker(keep) {
      clearTimeout(scanT);
      picker.inert = false;
      root.classList.remove('is-scanning');
      current = null;
      result.hidden = true;
      picker.hidden = false;
      root.classList.remove('is-matched');
      state.type = keep ? keep.type : null;
      state.brand = keep ? keep.brand : null;
      state.model = null;
      render();
    }

    /* -- service reminder: a real calendar event, nothing stored by us ---- */
    let icsUrl = null, months = 2;
    const pad = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    function addMonths(n) {
      const d = new Date();
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
      // 31 January plus one month is the end of February, not 3 March
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      return d;
    }
    // RFC 5545 text escaping and 75-octet line folding
    const icsText = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const fold = line => line.length <= 73 ? line : line.match(/.{1,73}/g).join('\r\n ');

    function setReminder(n) {
      months = n;
      const v = current;
      if (!v) return;
      const name = `${v.brand} ${v.model}`;
      const day = addMonths(n);
      const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      const bookUrl = `${SITE}book.html?service=Servicing&vehicle=${encodeURIComponent(name)}`;
      const title = `Service my ${name} - Moto Market`;
      const details = `Time to service your ${name}.\nBook a slot: ${bookUrl}\nCall: +880 1711-154387`;
      const place = 'Moto Market, R.A. Khan Chowdhury Road, Kushtia 7000';

      $$('[data-remind-months]', remind).forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.remindMonths) === n)));
      $('[data-remind-date]', remind).textContent =
        day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

      $('[data-remind-google]', remind).href = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
        `&text=${encodeURIComponent(title)}&dates=${ymd(day)}/${ymd(next)}` +
        `&details=${encodeURIComponent(details)}&location=${encodeURIComponent(place)}`;

      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
      const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moto Market//Service reminder//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${ymd(day)}-${Math.random().toString(36).slice(2, 10)}@moto-market`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(day)}`,
        `DTEND;VALUE=DATE:${ymd(next)}`,
        `SUMMARY:${icsText(title)}`,
        `DESCRIPTION:${icsText(details)}`,
        `LOCATION:${icsText(place)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(`Time to service your ${name}`)}`, 'TRIGGER:PT9H', 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR',
      ].map(fold).join('\r\n') + '\r\n';
      if (icsUrl) URL.revokeObjectURL(icsUrl);
      icsUrl = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      $('[data-remind-ics]', remind).href = icsUrl;
    }

    /* -- type-it search ------------------------------------------------ */
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const INDEX = [];
    ['bike', 'car'].forEach(type => Object.entries(DATA[type] || {}).forEach(([brand, models]) =>
      models.forEach(model => INDEX.push({ type, brand, model, m: norm(model), k: norm(brand + model) }))));
    let hits = [], active = -1;

    const closeSuggest = () => {
      suggest.hidden = true;
      q.setAttribute('aria-expanded', 'false');
      q.removeAttribute('aria-activedescendant');
      active = -1;
    };
    const setActive = i => {
      const opts = $$('[data-hit]', suggest);
      if (!opts.length) return;
      active = (i + opts.length) % opts.length;
      opts.forEach((o, j) => { o.classList.toggle('is-active', j === active); o.setAttribute('aria-selected', String(j === active)); });
      q.setAttribute('aria-activedescendant', opts[active].id);
      opts[active].scrollIntoView({ block: 'nearest' });
    };
    const markIn = (text, n) => {
      // highlight the typed run inside the model name, ignoring spacing
      let i = 0, start = -1, end = -1, seen = '';
      const plain = text.toLowerCase();
      for (; i < plain.length; i++) {
        if (!/[a-z0-9]/.test(plain[i])) continue;
        if (start < 0 && n.startsWith(plain[i]) && norm(plain.slice(i)).startsWith(n)) { start = i; seen = ''; }
        if (start >= 0) { seen += plain[i]; if (seen.length === n.length) { end = i + 1; break; } }
      }
      return start < 0 || end < 0 ? esc(text)
        : esc(text.slice(0, start)) + '<mark>' + esc(text.slice(start, end)) + '</mark>' + esc(text.slice(end));
    };

    function renderSuggest() {
      const n = norm(q.value);
      if (!n) { closeSuggest(); return; }
      hits = INDEX
        .map(e => ({ e, s: e.m.startsWith(n) ? 0 : e.k.startsWith(n) ? 1 : e.m.includes(n) ? 2 : e.k.includes(n) ? 3 : -1 }))
        .filter(x => x.s >= 0)
        .sort((a, b) => a.s - b.s || a.e.k.localeCompare(b.e.k))
        .slice(0, 8)
        .map(x => x.e);

      suggest.innerHTML = hits.length
        ? hits.map((h, i) =>
            `<li class="fit__opt" role="option" id="fit-opt-${i}" aria-selected="false" data-hit="${i}">` +
            `<span class="fit__opt-tag">${h.type}</span><span>${esc(h.brand)} <b>${markIn(h.model, n)}</b></span></li>`).join('')
        : `<li class="fit__opt fit__opt--none" role="option" aria-selected="false" aria-disabled="true">` +
            `<a href="${esc(wa(`Assalamu alaikum, Moto Market. I ride a ${q.value.trim()}. Can you check parts for it?`))}" target="_blank" rel="noopener">` +
            `Not listed? Send “${esc(q.value.trim())}” to the bay on <b>WhatsApp →</b></a></li>`;
      suggest.hidden = false;
      q.setAttribute('aria-expanded', 'true');
      if (hits.length) setActive(0); else { active = -1; q.removeAttribute('aria-activedescendant'); }
    }

    function choose(h) {
      q.value = '';
      closeSuggest();
      pick({ type: h.type, brand: h.brand, model: h.model });
    }

    q.addEventListener('input', renderSuggest);
    q.addEventListener('focus', () => { if (q.value) renderSuggest(); });
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (suggest.hidden) renderSuggest(); else setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (suggest.hidden) renderSuggest(); else setActive(active - 1); }
      else if (e.key === 'Enter') { if (!suggest.hidden && active >= 0 && hits[active]) { e.preventDefault(); choose(hits[active]); } }
      else if (e.key === 'Escape') { if (!suggest.hidden) { e.preventDefault(); e.stopPropagation(); closeSuggest(); } }
    });
    // keep focus in the input while an option is pressed, so blur cannot close the list first
    suggest.addEventListener('mousedown', e => { if (e.target.closest('.fit__opt')) e.preventDefault(); });
    suggest.addEventListener('click', e => {
      const o = e.target.closest('[data-hit]');
      if (o && hits[o.dataset.hit]) choose(hits[o.dataset.hit]);
    });
    q.addEventListener('blur', e => {
      if (e.relatedTarget && suggest.contains(e.relatedTarget)) return;
      setTimeout(() => { if (!suggest.contains(document.activeElement)) closeSuggest(); }, 150);
    });
    suggest.addEventListener('focusout', e => { if (!suggest.contains(e.relatedTarget) && e.relatedTarget !== q) closeSuggest(); });

    /* -- quick picks: common machines, labelled as picks, not as rankings -- */
    const QUICK = [['bike', 'Yamaha', 'FZS FI V3'], ['bike', 'Bajaj', 'Pulsar NS160'], ['bike', 'Suzuki', 'Gixxer SF 155'],
                   ['bike', 'TVS', 'Apache RTR 160 4V'], ['bike', 'Honda', 'CB Hornet 160R'], ['car', 'Toyota', 'Axio']];
    $('[data-fit-quick]', root).innerHTML = QUICK.filter(([t, b, m]) => has(t, b, m))
      .map(([t, b, m]) => `<button type="button" class="fit__qp" data-quick="${t}|${esc(b)}|${esc(m)}" aria-label="${esc(`${b} ${m}`)}">${esc(m)}</button>`)
      .join('');

    // The card's red highlight follows a mouse or stylus. Touch and keyboard
    // selection still get the same visible pressed state and motion cues.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && !reduced()) {
      $$('[data-fit-type]', root).forEach(button => {
        button.addEventListener('pointermove', e => {
          const box = button.getBoundingClientRect();
          button.style.setProperty('--fit-x', `${e.clientX - box.left}px`);
          button.style.setProperty('--fit-y', `${e.clientY - box.top}px`);
        }, { passive: true });
        button.addEventListener('pointerleave', () => {
          button.style.removeProperty('--fit-x');
          button.style.removeProperty('--fit-y');
        });
      });
    }

    /* -- one delegated click handler for everything inside the card ------- */
    root.addEventListener('click', e => {
      const kb = e.detail === 0;   // a click raised by Enter or Space
      const t = e.target.closest('[data-fit-type]');
      if (t) {
        if (!reduced()) {
          clearTimeout(launchTimers.get(t));
          t.classList.remove('is-launching');
          void t.offsetWidth; // replay the short launch on repeat taps
          t.classList.add('is-launching');
          launchTimers.set(t, setTimeout(() => t.classList.remove('is-launching'), 550));
        }
        pick({ type: t.dataset.fitType }, kb);
        return;
      }
      const c = e.target.closest('.fit__chip');
      if (c && brandsEl.contains(c)) { pick({ type: state.type, brand: c.dataset.v }, kb); return; }
      if (c && modelsEl.contains(c)) { pick({ type: state.type, brand: state.brand, model: c.dataset.v }, kb); return; }
      const qp = e.target.closest('[data-quick]');
      if (qp) { const [type, brand, model] = qp.dataset.quick.split('|'); pick({ type, brand, model }, kb); return; }
      if (e.target.closest('[data-fit-change]')) {
        backToPicker(current || readVehicle());
        say('Pick a different model, or start over with bike or car.');
        const first = $('.fit__chip', modelsEl) || $('[data-fit-type]', root);
        if (first) first.focus({ preventScroll: true });
        return;
      }
      if (e.target.closest('[data-fit-forget]')) {
        forgetVehicle();
        backToPicker(null);
        bringIntoView();
        say('Ride forgotten.');
        toast('Ride forgotten');
        const first = $('[data-fit-type]', root);
        if (first) first.focus({ preventScroll: true });
        return;
      }
      const tog = e.target.closest('[data-remind-toggle]');
      if (tog) {
        const open = remind.hidden;
        remind.hidden = !open;
        tog.setAttribute('aria-expanded', String(open));
        if (open) { setReminder(months); remind.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
        return;
      }
      const mo = e.target.closest('[data-remind-months]');
      if (mo) { setReminder(Number(mo.dataset.remindMonths)); return; }
      if (e.target.closest('[data-remind-google], [data-remind-ics]')) toast('Reminder ready — save it in your calendar');
    });

    // the garage bar elsewhere on the page can forget the ride too
    window.addEventListener('mm:vehicle', e => {
      if (!e.detail && (!result.hidden || root.classList.contains('is-scanning'))) backToPicker(null);
    });

    // the garage bar's Change link lands here and opens the picker on the saved ride
    function changeFromHash() {
      if (location.hash !== '#fitment-change') return;
      history.replaceState(null, '', '#fitment');
      backToPicker(readVehicle());
      root.scrollIntoView({ block: 'start' });
      const first = $('.fit__chip', modelsEl) || $('[data-fit-type]', root);
      if (first) first.focus({ preventScroll: true });
    }
    window.addEventListener('hashchange', changeFromHash);

    // returning visitor: open straight onto their saved ride
    const saved = readVehicle();
    if (saved && has(saved.type, saved.brand, saved.model)) {
      Object.assign(state, { type: saved.type, brand: saved.brand, model: saved.model });
      render();
      showResult(saved, true);
    } else {
      render();
    }
    changeFromHash();
  }

  // The garage bar names the saved ride on other parts of the site, offers a
  // person to confirm the fit, and — on the shop — invites a visitor who has
  // not saved one yet to do it.
  function fitBar() {
    const bar = $('[data-fitbar]');
    if (!bar) return;
    const prompt = bar.hasAttribute('data-fitbar-prompt');
    const label = $('[data-fitbar-label]', bar);
    const nameEl = $('[data-fitbar-name]', bar);
    const waEl = $('[data-fitbar-wa]', bar);
    const change = $('[data-fitbar-change]', bar);
    const clear = $('[data-fitbar-clear]', bar);

    const draw = e => {
      const v = e && e.detail !== undefined ? e.detail : readVehicle();
      bar.classList.toggle('is-empty', !v);
      if (!v) {
        bar.hidden = !prompt;
        if (label) label.textContent = 'No ride saved';
        nameEl.textContent = 'What do you ride?';
        if (waEl) waEl.hidden = true;
        if (clear) clear.hidden = true;
        if (change) change.textContent = 'Save my ride →';
        return;
      }
      const name = `${v.brand} ${v.model}`;
      bar.hidden = false;
      if (label) label.textContent = 'Your ride';
      nameEl.textContent = name;
      if (waEl) {
        waEl.hidden = false;
        waEl.textContent = v.type === 'car' ? 'Ask about parts on WhatsApp' : 'Check the fit on WhatsApp';
        waEl.href = wa(v.type === 'car'
          ? `Assalamu alaikum, Moto Market. I drive a ${name}. Which parts and engine oil can you get for it?`
          : `Assalamu alaikum, Moto Market. I ride a ${name}. Can you confirm which parts fit it?`);
      }
      if (clear) clear.hidden = false;
      if (change) change.textContent = 'Change';
    };

    if (clear) clear.addEventListener('click', () => { forgetVehicle(); toast('Ride forgotten');
      const f = change || $('[data-fit-type]'); if (f) f.focus(); });
    window.addEventListener('mm:vehicle', draw);
    draw();
  }

  /* =======================================================================
     Search. The index is generated from the catalogue and the page markup,
     so it cannot drift from what is actually on the site. Matching is a
     plain substring pass over title and category — with 70 entries that is
     instant, and it keeps behaviour predictable for a shop's own staff.
     ===================================================================== */
  function search() {
    const box = $('[data-search]');
    const input = $('[data-search-input]');
    const list = $('[data-search-results]');
    if (!box || !input || !list) return;

    const INDEX = window.MM_SEARCH || [];
    let hits = [], active = -1, lastFocus = null;

    const open = () => {
      lastFocus = document.activeElement;
      box.hidden = false;
      document.body.classList.add('is-locked');
      requestAnimationFrame(() => {
        box.classList.add('is-open');
        input.focus();
        input.select();
      });
      render();
    };

    const close = () => {
      box.classList.remove('is-open');
      document.body.classList.remove('is-locked');
      setTimeout(() => { box.hidden = true; }, 300);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    };

    const mark = (text, q) => {
      const i = text.toLowerCase().indexOf(q);
      if (!q || i < 0) return esc(text);
      return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) +
             '</mark>' + esc(text.slice(i + q.length));
    };

    const render = () => {
      const q = input.value.trim().toLowerCase();
      hits = !q ? INDEX.filter(e => e.g === 'Page' || e.g === 'Service')
                : INDEX.filter(e => (e.t + ' ' + e.k).toLowerCase().includes(q));
      hits = hits.slice(0, 24);
      active = hits.length ? 0 : -1;

      if (!hits.length) {
        list.innerHTML = `<p class="searchbox__empty">Nothing matched “${esc(input.value.trim())}”. ` +
          `Call <a class="red" href="tel:+8801711154387">+880 1711-154387</a> — if it exists, we can get it.</p>`;
        return;
      }

      let html = '', group = null;
      hits.forEach((h, i) => {
        if (h.g !== group) { group = h.g; html += `<p class="searchbox__group">${esc(group)}</p>`; }
        html += `<a class="searchbox__hit${i === 0 ? ' is-active' : ''}" role="option" href="${esc(h.u)}" data-hit="${i}">` +
                `<b>${mark(h.t, q)}</b><span>${esc(h.p ? '৳' + h.p.toLocaleString('en-US') : h.k)}</span></a>`;
      });
      list.innerHTML = html;
    };

    const move = step => {
      const nodes = $$('[data-hit]', list);
      if (!nodes.length) return;
      active = (active + step + nodes.length) % nodes.length;
      nodes.forEach((n, i) => n.classList.toggle('is-active', i === active));
      nodes[active].scrollIntoView({ block: 'nearest' });
    };

    $$('[data-search-open]').forEach(b => b.addEventListener('click', open));
    $$('[data-search-close]').forEach(b => b.addEventListener('click', close));
    input.addEventListener('input', render);

    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        const node = $$('[data-hit]', list)[active];
        if (node) { e.preventDefault(); window.location.href = node.getAttribute('href'); }
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !box.hidden) { close(); return; }
      // "/" is the shortcut every shop assistant already knows from a browser
      if (e.key === '/' && box.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault(); open();
      }
    });
  }

  /* =======================================================================
     Carousels. Native scrolling does the moving, so touch, trackpad and the
     keyboard all behave the way the platform already does; the arrows and
     dots just drive scrollLeft. Everything derives from measurement, so a
     row that fits shows no controls at all.
     ===================================================================== */
  function carousels() {
    $$('[data-carousel]').forEach(root => {
      const track = $('.carousel__track', root);
      const prev = $('[data-car="-1"]', root);
      const next = $('[data-car="1"]', root);
      const dots = $('[data-car-dots]', root);
      if (!track) return;

      const page = () => {
        // move by whole items, never leaving one half-cut at the edge
        const item = track.firstElementChild;
        if (!item) return track.clientWidth;
        const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        const step = item.getBoundingClientRect().width + gap;
        return Math.max(step, Math.floor(track.clientWidth / step) * step);
      };

      const sync = () => {
        const max = track.scrollWidth - track.clientWidth;
        const overflows = max > 2;

        [prev, next].forEach(b => { if (b) b.hidden = !overflows; });
        if (dots) dots.hidden = !overflows;
        root.classList.toggle('is-start', track.scrollLeft <= 2);
        root.classList.toggle('is-end', track.scrollLeft >= max - 2);
        if (prev) prev.disabled = track.scrollLeft <= 2;
        if (next) next.disabled = track.scrollLeft >= max - 2;

        if (!dots || !overflows) return;
        const pages = Math.max(1, Math.ceil(track.scrollWidth / track.clientWidth));
        if (dots.children.length !== pages) {
          dots.replaceChildren(...Array.from({ length: pages }, (_, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('aria-label', `Go to page ${i + 1}`);
            b.addEventListener('click', () => {
              track.scrollTo({ left: i * track.clientWidth, behavior: reduced() ? 'auto' : 'smooth' });
            });
            return b;
          }));
        }
        const at = Math.round(track.scrollLeft / track.clientWidth);
        [...dots.children].forEach((d, i) => d.classList.toggle('is-on', i === at));
      };

      const go = dir => track.scrollBy({ left: dir * page(), behavior: reduced() ? 'auto' : 'smooth' });
      [prev, next].forEach(b => b && b.addEventListener('click', () => go(Number(b.dataset.car))));

      track.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); go(-1); }
      });

      let tick = null;
      track.addEventListener('scroll', () => {
        if (tick) return;
        tick = requestAnimationFrame(() => { tick = null; sync(); });
      }, { passive: true });

      // Autoplay, for the banner slider only. It stops for good on any
      // deliberate input, pauses off-screen and while the tab is hidden, so
      // it never fights a reader or burns battery in a background tab.
      const every = Number(root.dataset.autoplay || 0);
      if (every && !reduced()) {
        let timer = null, stopped = false, visible = true;
        const tick = () => {
          if (stopped || !visible || document.hidden) return;
          const max = track.scrollWidth - track.clientWidth;
          if (max <= 2) return;
          const next = track.scrollLeft >= max - 2 ? 0 : track.scrollLeft + page();
          track.scrollTo({ left: next, behavior: 'smooth' });
        };
        const start = () => { if (!timer && !stopped) timer = setInterval(tick, every); };
        const stopForGood = () => { stopped = true; clearInterval(timer); timer = null; };

        ['pointerdown', 'keydown', 'wheel'].forEach(ev =>
          root.addEventListener(ev, stopForGood, { passive: true, once: true }));
        root.addEventListener('mouseenter', () => { clearInterval(timer); timer = null; });
        root.addEventListener('mouseleave', start);
        document.addEventListener('visibilitychange', () => document.hidden ? clearInterval(timer) || (timer = null) : start());

        if ('IntersectionObserver' in window) {
          new IntersectionObserver(es => {
            visible = es[0].isIntersecting;
            visible ? start() : (clearInterval(timer), timer = null);
          }, { threshold: 0.3 }).observe(root);
        } else start();
      }

      window.addEventListener('resize', sync, { passive: true });
      // card widths settle after fonts land, so measure again then
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
      // images decide the track's real width, so measure again as they land
      $$('img', track).forEach(img => {
        if (!img.complete) img.addEventListener('load', sync, { once: true });
      });
      sync();
      // a band revealed by the filter was zero-width while hidden
      window.addEventListener('mm:urlchange', () => requestAnimationFrame(sync));
    });
  }

  /* =======================================================================
     Sort the flat catalogue. Featured is the authored order, kept so the
     sort can always be undone; the rest re-append the same nodes.
     ===================================================================== */
  function sorting() {
    const sel = $('[data-sort]');
    const grid = $('[data-grid]');
    if (!sel || !grid) return;
    const cards = $$('.card', grid);
    cards.forEach((c, i) => { c.dataset.order = i; });
    const by = {
      featured: (a, b) => a.dataset.order - b.dataset.order,
      save:     (a, b) => b.dataset.save - a.dataset.save || a.dataset.order - b.dataset.order,
      low:      (a, b) => a.dataset.price - b.dataset.price,
      high:     (a, b) => b.dataset.price - a.dataset.price,
      dealer:   (a, b) => b.dataset.dealer - a.dataset.dealer || a.dataset.order - b.dataset.order,
    };
    sel.addEventListener('change', () => {
      cards.slice().sort(by[sel.value] || by.featured).forEach(c => grid.appendChild(c));
    });
  }

  /* =======================================================================
     Brand marks on cards. Any product whose name starts with a dealer brand
     gets that brand's real mark in the corner of its art — the same chip the
     reference shows on every card, here only where the brand is genuine.
     ===================================================================== */
  function brandChips() {
    const MARKS = [['Liqui Moly','liqui-moly'],['Eurogrip','eurogrip'],['Castrol','castrol'],['Motorex','motorex'],
      ['Pirelli','pirelli'],['Maxima','maxima'],['Mobil','mobil'],['Motul','motul'],['Shell','shell'],
      ['Bajaj','bajaj'],['CEAT','ceat'],['MRF','mrf'],['CST','cst'],['BP','bp']];
    $$('.card').forEach(card => {
      const name = ($('.card__name', card) || {}).textContent || '';
      const hit = MARKS.find(([b]) => name.startsWith(b + ' '));
      const art = $('.card__art', card);
      if (!hit || !art || $('.card__brand', art)) return;
      const img = document.createElement('img');
      img.className = 'card__brand';
      img.src = `assets/brands/${hit[1]}.webp`;
      img.alt = hit[0];
      img.loading = 'lazy'; img.decoding = 'async';
      art.appendChild(img);
    });
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
      const kit = e.target.closest('[data-kit]');
      if (kit) {
        let list = [];
        try { list = JSON.parse(kit.dataset.kit); } catch {}
        const items = cart.read();
        list.forEach(it => {
          const hit = items.find(i => i.id === it.id);
          if (hit) hit.qty += 1; else items.push({ ...it, qty: 1 });
        });
        cart.write(items);
        toast(`${list.length} items added`);
        openDrawer(true);
        return;
      }
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

  /* =======================================================================
     Which menu item is "current" follows the URL, not the page file: the
     shop serves five of the six menu entries through ?cat=, so marking it
     once in the markup would leave Shop lit while the reader is in Tyres.
     ===================================================================== */
  function currentNav() {
    const links = $$('.nav__link, .menu__link');
    if (!links.length) return;

    const mark = () => {
      const here = location.pathname.split('/').pop() || 'index.html';
      const cat = new URL(location.href).searchParams.get('cat');

      const parts = a => {
        const url = new URL(a.getAttribute("href"), document.baseURI);
        return { file: url.pathname.split('/').pop() || 'index.html',
                 cat: url.searchParams.get('cat'),
                 hash: url.hash };
      };

      links.forEach(a => {
        const l = parts(a);
        // a link only counts as current when file, category and hash all agree;
        // a link without a hash is not current while the reader sits on one
        const on = l.file === here &&
                   (l.cat ? l.cat === cat : !cat) &&
                   (l.hash ? l.hash === location.hash : !location.hash);
        if (on) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });

      // a category or section with no menu entry of its own still belongs to
      // its page, so fall back to that page's plain link
      if (!links.some(a => a.hasAttribute('aria-current'))) {
        links.forEach(a => {
          const l = parts(a);
          if (l.file === here && !l.cat && !l.hash) a.setAttribute('aria-current', 'page');
        });
      }
    };
    mark();
    window.addEventListener('mm:urlchange', mark);
    window.addEventListener('popstate', mark);
  }

  /* The menu has its own moving highlight; pointer and keyboard share it. */
  function navMotion() {
    const menu = $('.nav__menu');
    if (!menu) return;
    const links = $$('.nav__link', menu);
    if (!links.length) return;
    const marker = document.createElement('span');
    marker.className = 'nav__highlight';
    marker.setAttribute('aria-hidden', 'true');
    menu.prepend(marker);
    let hovered = null;

    const sync = () => {
      const focused = links.find(link => link === document.activeElement);
      const link = hovered || focused || links.find(link => link.getAttribute('aria-current') === 'page');
      if (!link || !menu.getClientRects().length) {
        marker.classList.remove('is-on');
        return;
      }
      const box = link.getBoundingClientRect();
      const parent = menu.getBoundingClientRect();
      marker.style.setProperty('--highlight-x', `${box.left - parent.left}px`);
      marker.style.width = `${box.width}px`;
      marker.style.height = `${box.height}px`;
      marker.style.top = `${box.top - parent.top}px`;
      marker.classList.add('is-on');
    };

    links.forEach((link, i) => {
      const signal = document.createElement('span');
      signal.className = 'nav__signal';
      signal.setAttribute('aria-hidden', 'true');
      link.prepend(signal);
      link.style.setProperty('--nav-delay', `${i * 75}ms`);
      link.style.setProperty('--signal-delay', `${i * -0.65}s`);
      link.classList.add('nav__enter');
      link.addEventListener('animationend', e => {
        if (e.target === link) link.classList.remove('nav__enter');
      });
      link.addEventListener('pointerenter', () => { hovered = link; sync(); });
      link.addEventListener('pointermove', e => {
        if (reduced()) return;
        const box = link.getBoundingClientRect();
        link.style.setProperty('--pointer-x', `${((e.clientX - box.left) / box.width) * 100}%`);
      }, { passive: true });
      link.addEventListener('focus', sync);
      link.addEventListener('blur', () => requestAnimationFrame(sync));
    });
    menu.addEventListener('pointerleave', () => { hovered = null; sync(); });
    window.addEventListener('mm:urlchange', sync);
    window.addEventListener('popstate', sync);
    window.addEventListener('resize', sync, { passive: true });
    if (document.fonts?.ready) document.fonts.ready.then(sync);
    const pause = () => menu.classList.toggle('is-paused', document.hidden);
    document.addEventListener('visibilitychange', pause);
    pause();
    sync();
  }

  function mobileMenu() {
    const menu = $('[data-menu]');
    if (!menu) return;
    const burger = $('[data-menu-open]');

    const set = open => {
      menu.hidden = !open;
      if (open) requestAnimationFrame(() => menu.classList.add('is-open'));
      else menu.classList.remove('is-open');
      document.body.classList.toggle('is-locked', open);
      if (burger) burger.setAttribute('aria-expanded', String(open));
      if (open) { const first = $('.menu__link', menu); if (first) first.focus(); }
      else if (burger) burger.focus();
    };
    // let the slide finish before the panel leaves the layout
    const close = () => { menu.classList.remove('is-open'); setTimeout(() => { menu.hidden = true; }, 450);
                          document.body.classList.remove('is-locked');
                          if (burger) burger.setAttribute('aria-expanded', 'false'); };

    $$('[data-menu-open]').forEach(b => b.addEventListener('click', () => set(true)));
    $$('[data-menu-close]').forEach(b => b.addEventListener('click', close));
    $$('.menu__link', menu).forEach(a => a.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) close(); });
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
    const bands = $$('[data-band]');
    const cards = $$('.card[data-cat]');   // buttons also carry data-cat
    const countEl = $('[data-result-count]');

    const apply = (key, scroll) => {
      let n = 0;
      if (bands.length) {
        // the shop is organised in category bands: show the whole band
        bands.forEach(b => {
          const on = key === 'all' || b.dataset.band === key;
          b.hidden = !on;
          // the deals row re-shows products that their own band already counts
          if (on && !b.hasAttribute('data-nocount')) n += $$('.card', b).length;
        });
      } else {
        cards.forEach(c => {
          const on = key === 'all' || c.dataset.cat === key;
          c.classList.toggle('is-hidden', !on);
          if (on) n++;
        });
      }
      chips.forEach(ch => ch.setAttribute('aria-pressed', String(ch.dataset.filter === key)));
      if (countEl) countEl.textContent = String(n).padStart(2, '0');
      const empty = $('[data-catalog-empty]');
      if (empty) empty.hidden = n > 0;

      const url = new URL(location.href);
      if (key === 'all') url.searchParams.delete('cat'); else url.searchParams.set('cat', key);
      history.replaceState(null, '', url);
      window.dispatchEvent(new Event('mm:urlchange'));

      // arriving from a link that names a category should land on it
      if (scroll && key !== 'all') {
        const band = $(`[data-band="${key}"]`);
        if (band) band.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      }
    };

    chips.forEach(ch => ch.addEventListener('click', () => apply(ch.dataset.filter, true)));
    const initial = new URL(location.href).searchParams.get('cat');
    apply(initial && chips.some(c => c.dataset.filter === initial) ? initial : 'all', false);
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

    // a ride saved in the fitment scanner, or passed in the link, fills itself in
    const veh = form.querySelector('[name="vehicle"]');
    if (veh && !veh.value) {
      const fromLink = new URL(location.href).searchParams.get('vehicle');
      const saved = readVehicle();
      veh.value = fromLink || (saved ? `${saved.brand} ${saved.model}` : '');
    }

    // don't let someone book yesterday — local date, since toISOString is UTC
    // and would still be on yesterday in Dhaka until 6am
    const date = form.querySelector('input[type="date"]');
    if (date) {
      const t = new Date();
      date.min = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    }

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
    magnetic();
    tilt();
    railTouch();
    scrollFocus();
    search();
    currentNav();
    navMotion();
    mobileMenu();
    brandChips();
    sorting();
    carousels();
    serviceTabs();
    fitment();
    fitBar();
    spine();
    actionBar();
    wordmark();
    const heroCanvas = $('.hero__ascii');
    if (heroCanvas) asciiField(heroCanvas);
    document.documentElement.classList.add('js-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})();
