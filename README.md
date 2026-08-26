# Moto Market — motomarket.com.bd

Marketing + booking + parts-catalogue site for **Moto Market**, Kushtia.
*More than a service center · 360°*

## What it is

Three static pages, zero build step, zero dependencies.

| File | Purpose |
| --- | --- |
| `index.html` | The guided journey — hero, story chapters, services, process rail, trust, contact |
| `shop.html` | Catalogue across five sub-categories with filters and a persistent cart |
| `book.html` | Service booking that turns into a pre-written WhatsApp / email message |
| `styles.css` | The whole design system |
| `app.js` | The motion engine |

## Running it

It's plain HTML. Open `index.html`, or serve the folder:

```sh
python3 -m http.server 8000
```

Deploys as-is to Netlify, Vercel, GitHub Pages, or any shared host — just upload the folder.

## Design

Near-black `#0a0a0b`, off-white `#f4f2ef`, one red `#e11d2e` taken from the logo.
Type carries the page; the red is only ever an accent. Both fonts (Inter, IBM Plex Mono)
load from Google Fonts and fall back to system stacks if they don't.

## Motion

Everything runs off a single shared `requestAnimationFrame` loop and `IntersectionObserver` —
no scroll-jacking, no libraries.

- **ASCII field** — the hero is a live canvas of monospace glyphs driven by a spinning-wheel
  field function; it drifts toward the pointer.
- **ASCII frame players** — hand-drawn art cycled frame by frame in the story panels.
- **Reveals** — word-by-word headline splits, clip-path wipes, staggered fades.
- **Rail** — the process section scrolls sideways as you scroll down (falls back to a
  swipeable carousel under 860px).
- **Marquees** — speed reacts to scroll velocity and direction.
- Count-ups, text scramble, magnetic cursor, scroll progress bar, auto-hiding nav.

`prefers-reduced-motion: reduce` disables all of it and the page still reads correctly.

## Commerce

The cart is `localStorage`-backed (`mm.cart.v1`) and shared across pages. There is **no
payment backend** — checkout composes an itemised WhatsApp message to +880 1711-154387.
Same pattern for bookings. Swapping in a real checkout means replacing that one handler
in `app.js`.

Product data lives inline in `shop.html`. To add an item, copy an `article.card` block and
set `data-cat`, `data-add`, `data-name`, `data-cat` and `data-price` on its Add button.

## Business details

- **Phone** +880 1711-154387
- **Email** motolubebangladesh@gmail.com
- **Workshop** R.A. Khan Chowdhury Road, Kushtia 7000, Khulna Division
- **Facebook** https://www.facebook.com/share/1MLq6PjxjY/

Prices in the catalogue are placeholders — confirm them before going live.
