# Ai Mini-Mart 🛒

A polished single-page retail storefront: browse products, manage a cart, check out, and generate a print-ready **PDF order sheet** for staff to fulfill. Plain HTML + CSS + vanilla JS — **no build step, no framework, no dependencies**.

## Run

```bash
npm start
```

Then open **http://localhost:5173**. (`npm start` runs `server.js`, a zero-dependency static server.)

> First load needs internet: product images come from [picsum.photos](https://picsum.photos) and jsPDF/AutoTable load from a CDN. If an image host is slow or blocked, an attractive built-in placeholder tile is shown automatically.

## Features

- **Live search** by product name or tag
- **Favorites** — ⭐ star toggle per card + a Favorites view (persisted)
- **Category filters** — Electronics, Home, Apparel, Accessories, Tools, Grocery (multi-tag)
- **Product detail popup** — click any card for name, price, tag, unit size, and a variant picker
- **Variants & stock** — each product has variants (with colour swatches) and an In Stock / Out of Stock badge; card previews cross-fade through the variant images
- **7 languages** — English, ខ្មែរ, ไทย, 中文, Filipino, Indonesia, Tiếng Việt (English fallback for missing keys)
- **2 currencies** — THB ฿ (base) and KHR ៛ — with a configurable rate table
- **3 themes** — Light (joyful orange), Dark, Festival (CSS variables)
- **Cart drawer** — receipt-styled, with editable quantity (− + and a tap-to-type numpad field) and line + order totals. The same product in two variants is two separate lines.
- **Checkout** — name, address (location), order note
- **PDF order sheet** — A4, print-friendly, itemized table with item + variant images, grand total, and a staff footer
- **Checkout & send** — shares the PDF as a file via the Web Share API (Telegram / LINE / Messenger / WeChat…), falling back to a download on desktop

Cart, favorites, language, currency, and theme all persist in `localStorage` under the `mymart.*` namespace.

## Project layout

```
index.html        Markup + CDN script tags
styles.css        Theming (CSS variables) + all UI styles
server.js         Zero-dependency static server (npm start)
js/
  data.js         Product catalog + categories   (prices in THB base)
  i18n.js         Language dictionary             (add languages/labels here)
  currency.js     Exchange rates + money formatting
  pdf.js          jsPDF order-sheet generator
  app.js          State, rendering, event wiring
```

These five `js/*` files are plain `<script>` tags (not ES modules) loaded in a fixed dependency order — see [CLAUDE.md](CLAUDE.md) for the architecture details.

## Extending

- **Add a product** → copy a block in `js/data.js` (set `priceTHB`, optional `wasTHB`, `tags`, `inStock`, `unit`, `variants`).
- **Add a language** → add to `LANGS` and an `I18N['xx']` object in `js/i18n.js`. Missing keys fall back to English.
- **Add a currency** → add to `CURRENCIES` + `RATES` in `js/currency.js` (values are THB-based).
- **Add a theme** → copy a `[data-theme="…"]` block in `styles.css` and remap the tokens.

### The PDF is always English
The on-screen UI is fully multilingual, but the printed order sheet is **always in English**. jsPDF's built-in Helvetica only covers Latin (WinAnsi), so Khmer/Thai/Chinese labels — and even some locale-specific dates/numerals — render as garbage. Rather than embed heavy Unicode fonts (and jsPDF still can't *shape* Khmer/Thai), the sheet is built with an English-locked translator (`tPDF`) and the customer's selected language is noted in a `Language:` row instead. Prices likewise use ASCII currency **codes** (e.g. `THB 1,290.00`) for the same reason. If you ever need a localized PDF, you'd embed a Unicode TTF via `doc.addFont(...)` (CJK only — complex scripts need a shaping engine jsPDF lacks).
