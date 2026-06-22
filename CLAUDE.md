# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ai Mini-Mart — a single-page retail storefront (browse → cart → checkout → client-side PDF order sheet for staff). Plain HTML + CSS + vanilla JS, **no build step, no framework, no package dependencies**. The brand display name is "Ai Mini-Mart"; code identifiers and the localStorage namespace still use `mymart`/`my-mart`.

## Commands

```bash
npm start          # node server.js — zero-dependency static server on http://localhost:5173
```

There is **no build, lint, type-check, or test tooling** — `npm start` is the only script. Don't add a bundler/transpiler unless asked; the project intentionally runs the source files directly.

Verification is manual in a browser (open localhost:5173). When checking behavior programmatically, the app exposes its internals as globals (no module scope), so you can drive it from the devtools console: e.g. `addToCart('p13', 2, 'Dark')`, `openDetail('p09')`, `setLang('th')`, `state.cart`.

First load needs internet: product images come from `picsum.photos` and jsPDF/AutoTable load from a CDN (`<script>` tags in `index.html`).

## Architecture

### Global scripts, ordered by dependency
The five `js/*` files are plain `<script>` tags (NOT ES modules) loaded in a fixed order in `index.html`; each defines top-level `const`/`function` globals the next ones rely on. **Order matters** — do not reorder:

```
data.js     PRODUCTS, CATEGORIES, productImages()   — product catalog (prices in THB)
i18n.js     LANGS, I18N                              — translation dictionary
currency.js RATES, CURRENCIES, convert*/formatMoney* — money conversion + formatting
pdf.js      buildOrderSheet/download/shareOrderSheet — jsPDF order sheet (depends on currency.js)
app.js      state, render*, wire(), init()           — everything else; consumes all of the above
```

### State + persistence (`app.js`)
One module-level `state` object is the single source of truth. `LS.get/set` persist a subset under `mymart.*` localStorage keys via `persist()`: `cart`, `favorites`, `lang`, `currency`, `theme`. `init()` **sanitizes stale storage** (it resets a removed `USD` currency and migrates the old `{id: qty}` cart format) — keep this guard working if you change those shapes. Rendering is full-innerHTML re-render per section (`renderGrid`, `renderCart`, `renderChips`, `renderMenus`, `renderDetail`) with event delegation in `wire()`, not per-element listeners.

### Cart is keyed by product **and** variant
`state.cart` is `{ "<id>::<variant>": { id, variant, qty } }` (see `lineKeyOf`). The same product in two variants is two separate lines — code that touches the cart must go through `lineKeyOf` / `cartEntries`, never assume one entry per product id.

### i18n / currency / theme are parallel "switcher" systems
- **i18n:** `t(key)` reads `I18N[state.lang]` with English fallback. `applyI18n()` fills DOM nodes tagged `data-i18n` / `data-i18n-attr`. Add a language → entry in `LANGS` + an `I18N['xx']` object (missing keys fall back to en). The font stack in `styles.css` includes Noto Khmer/Thai/SC for the non-Latin scripts.
- **currency:** every price lives once in `data.js` as `priceTHB`; everything else converts at render time via `convertPrice`/`money()`. `CURRENCIES` + `RATES` are THB (base) and KHR only.
- **theme:** CSS custom properties scoped to `[data-theme="..."]` (`light` = the default orange identity, `dark`, `festival`). `setTheme` flips the attribute on `<html>`.

### Products carry variants + stock, not ratings
Each `PRODUCTS` entry has `inStock`, `unit` (e.g. "250 g"), `variantLabel`, and `variants: [{ label, swatch, img }]`. `productImages(p)` = the variant images; cards auto-cross-fade through them (`startRotation`/`fadeTo`, disabled under `prefers-reduced-motion`) and the detail popup uses them as the variant picker.

### Images: picsum + a hang-proof fallback
`fallbackImg()` returns an inline SVG data-URI placeholder. `onerror` handles failed loads, but a *slow/blocked* host never errors — so `armFallbacks()` is a watchdog that swaps any still-unloaded `img[data-fb]` after 3.5s. Call it after any render that injects new images.

### PDF has two output paths (`pdf.js`)
`buildOrderSheet()` is **async** (it loads + canvas-encodes item images) and returns a jsPDF doc. Two wrappers:
- `downloadOrderSheet` → save + open, **keeps the cart** (the "Download PDF" button).
- `shareOrderSheet` → Web Share API file share (Telegram/LINE/etc.), falling back to download; this is the real checkout (`shareOrder` clears the cart). On most desktop browsers `navigator.canShare({files})` is false, so it downloads.

PDF money uses `formatMoneyPDF` (ASCII currency **code**, e.g. `THB 1,290.00`) because jsPDF's Helvetica/WinAnsi can't render `฿`/`៛` and corrupts the digits. Item images embed via canvas→dataURL with a solid swatch tile fallback when CORS/timeout blocks pixel access.

## Gotchas

- **`[hidden] { display:none !important }`** in `styles.css` is load-bearing. Several components set `display: flex/grid` via class, which would otherwise override the `hidden` attribute — the drawer's cart/checkout/done view state machine (`showDrawerView`) and the detail modal rely on this rule. Don't remove it.
- The header logo is the user's `assets/logo.png`; `assets/logo.svg` is only an `onerror` fallback.
- jsPDF's `pdf_no` / phone fields still exist as i18n keys but are no longer used in the sheet — don't reintroduce them assuming they're wired.
