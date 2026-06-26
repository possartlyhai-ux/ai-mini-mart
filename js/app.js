/* =========================================================================
 * app.js — UI state, rendering, and wiring
 * -------------------------------------------------------------------------
 * Depends (in load order) on: data.js, i18n.js, currency.js, pdf.js
 * Persists to localStorage: cart, favorites, language, currency, theme.
 * ========================================================================= */

'use strict';

/* ---------------- Persistence helpers ---------------- */
const LS = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem('mymart.' + key)) ?? fallback; } catch { return fallback; } },
  set(key, val) { localStorage.setItem('mymart.' + key, JSON.stringify(val)); },
};

/* ---------------- App state ---------------- */
const state = {
  lang:      LS.get('lang', 'en'),
  currency:  LS.get('currency', 'KHR'),
  theme:     LS.get('theme', 'light'),
  gridSize:  LS.get('grid', 'md'),          // card/view size: 'lg' | 'md' | 'sm'
  cart:      LS.get('cart', {}),            // { lineKey: { id, variant, qty } }
  favorites: LS.get('favorites', []),       // [productId]
  search:    '',
  category:  'all',
  favView:   false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------------- i18n: translate + apply ---------------- */
// t(key): active language with English fallback so labels never go blank.
function t(key) { return (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key; }

// tPDF(key): English-locked translator for the PDF order sheet. jsPDF's built-in
// Helvetica only covers Latin (WinAnsi), so Khmer/Thai/Chinese labels print as
// garbage. The printed staff sheet therefore always uses English labels while
// the on-screen UI stays fully multilingual. The customer's chosen language is
// still recorded on the sheet via order.langName (see buildOrder + pdf.js).
function tPDF(key) { return I18N.en[key] || key; }

// Latin/English names for the language line on the PDF (LANGS.label is native
// script, which would itself garble in Helvetica).
const LANG_EN_NAMES = { en: 'English', km: 'Khmer', th: 'Thai', zh: 'Chinese', fil: 'Filipino', id: 'Indonesian', vi: 'Vietnamese' };

// Walk the DOM and fill anything tagged with data-i18n / data-i18n-attr.
function applyI18n() {
  document.documentElement.lang = state.lang;
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-attr]').forEach(el => {
    el.dataset.i18nAttr.split(',').forEach(pair => {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr.trim(), t(key.trim()));
    });
  });
}

/* ---------------- Money helper (base THB -> active currency) ---------------- */
const money = (baseTHB) => convertPrice(baseTHB, state.currency);

// Hand-set-aware price. Staff set BOTH a THB and a KHR price in the admin; if the
// active currency is KHR and a KHR price was set (>0), show it verbatim — no FX.
// A blank KHR (0/undefined) falls back to converting from the THB base at RATES.
// priceMoney() returns the formatted string; amountIn() the raw active-currency number.
function amountIn(thb, khr, qty = 1) {
  if (state.currency === 'KHR' && Number(khr) > 0) return Number(khr) * qty;
  return convertRaw((Number(thb) || 0) * qty, state.currency);
}
const priceMoney = (p, qty = 1) => formatMoney(amountIn(p.priceTHB, p.priceKHR, qty), state.currency);

// Per-variant pricing. The live backend feed sets a price on EACH variant; the
// static data.js catalog only prices at the product level. Resolve from the
// chosen variant when it carries its own price, else fall back to the product —
// so picking variant 2 shows variant 2's price, and the static shop is untouched.
function variantOf(product, variant) {
  if (variant && typeof variant === 'object') return variant;
  return (product.variants || []).find(x => x.label === variant) || null;
}
const priceTHBof = (product, variant) => {
  const v = variantOf(product, variant);
  return v && v.priceTHB != null ? v.priceTHB : product.priceTHB;
};
const priceKHRof = (product, variant) => {
  const v = variantOf(product, variant);
  return v && v.priceTHB != null ? v.priceKHR : product.priceKHR;
};
const priceMoneyV = (product, variant, qty = 1) =>
  formatMoney(amountIn(priceTHBof(product, variant), priceKHRof(product, variant), qty), state.currency);

/* =========================================================================
 * RENDER: product grid
 * ========================================================================= */
function filteredProducts() {
  const q = state.search.trim().toLowerCase();
  return PRODUCTS.filter(p => {
    if (state.favView && !state.favorites.includes(p.id)) return false;
    if (state.category !== 'all' && !p.tags.includes(state.category)) return false;
    if (q) {
      const hay = (p.name + ' ' + p.tags.join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* =========================================================================
 * IMAGE ROTATION — each card cross-fades through its variant images.
 * Auto-advances every few seconds (paused under prefers-reduced-motion),
 * and a click on the image advances it immediately.
 * ========================================================================= */
const frames = {};   // productId -> current image index
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let rotationTimer;

const imagesById = (id) => productImages(PRODUCTS.find(p => p.id === id));

// Watchdog: <img onerror> handles failed loads, but a SLOW/blocked host can
// leave an image pending forever (no error fires). After a short wait, swap
// any still-unloaded image tagged with data-fb to the local SVG placeholder.
function armFallbacks(root = document) {
  root.querySelectorAll('img[data-fb]').forEach(img => {
    if (img.complete && img.naturalWidth > 0) return;
    const id = img.dataset.fb;
    setTimeout(() => {
      if (!(img.complete && img.naturalWidth > 0)) { img.src = fallbackImg(id); img.style.opacity = '1'; }
    }, 2000);
  });
}

// Fade an <img> to a new src (re-arming the slow-load watchdog afterward).
function fadeTo(img, src) {
  if (!img || img.getAttribute('src') === src) return;
  img.style.opacity = '0';
  setTimeout(() => {
    img.src = src; img.style.opacity = '1';
    const id = img.dataset.fb;
    if (id) setTimeout(() => { if (!(img.complete && img.naturalWidth > 0)) img.src = fallbackImg(id); }, 2000);
  }, 180);
}

function updateDots(card, idx) {
  card.querySelectorAll('.card__dots .dot').forEach((d, i) => d.classList.toggle('on', i === idx));
}
function updateDotsAll() {
  document.querySelectorAll('.card[data-id]').forEach(card => updateDots(card, frames[card.dataset.id] || 0));
}

// Advance one card to its next image (used on click).
function cycleCard(id) {
  const card = document.querySelector(`.card[data-id="${id}"]`);
  const imgs = imagesById(id);
  if (!card || imgs.length < 2) return;
  frames[id] = ((frames[id] || 0) + 1) % imgs.length;
  fadeTo(card.querySelector('.card__img'), imgs[frames[id]]);
  updateDots(card, frames[id]);
}

// Stop the auto-rotation timer (e.g. when the tab is backgrounded).
function stopRotation() { clearInterval(rotationTimer); }

// Auto-rotate every visible card, gently staggered so it reads as a wave.
function startRotation() {
  if (reduceMotion) return;
  clearInterval(rotationTimer);
  rotationTimer = setInterval(() => {
    document.querySelectorAll('.card[data-id]').forEach((card, i) => {
      const id = card.dataset.id;
      const imgs = imagesById(id);
      if (imgs.length < 2) return;
      setTimeout(() => {
        frames[id] = ((frames[id] || 0) + 1) % imgs.length;
        fadeTo(card.querySelector('.card__img'), imgs[frames[id]]);
        updateDots(card, frames[id]);
      }, i * 110);
    });
  }, 4000);
}

function renderGrid() {
  const grid = $('#grid');
  const list = filteredProducts();

  // View heading + count
  $('#view-title').textContent = state.favView ? t('favorites')
    : state.category === 'all' ? t('all') : t('cat_' + state.category);
  $('#result-count').textContent = list.length;
  renderBanner(list.length);

  // Empty state
  const empty = $('#empty');
  if (list.length === 0) {
    grid.innerHTML = '';
    empty.hidden = false;
    $('#empty-msg').textContent = state.favView && state.favorites.length === 0 ? t('no_favorites') : t('no_results');
  } else {
    empty.hidden = true;
  }

  grid.innerHTML = list.map(p => {
    const fav = state.favorites.includes(p.id);
    const tags = p.tags.slice(0, 2).map(tg => `<span class="tag">${t('cat_' + tg)}</span>`).join('');
    const imgs = productImages(p);
    const frame = frames[p.id] || 0;
    const dots = imgs.length > 1
      ? `<div class="card__dots" aria-hidden="true">${imgs.map((_, i) => `<i class="dot ${i === frame ? 'on' : ''}"></i>`).join('')}</div>`
      : '';
    return `
      <article class="card" data-id="${p.id}" data-detail="${p.id}">
        <div class="card__media" data-cycle="${p.id}" title="${t('quick_view')}">
          <img class="card__img" loading="lazy" src="${imgs[frame]}" alt="${p.name}" data-fb="${p.id}"
               onerror="this.onerror=null;this.src=fallbackImg('${p.id}')" />
          <div class="card__tags">${tags}</div>
          ${dots}
          <button class="fav" data-fav="${p.id}" aria-pressed="${fav}"
                  aria-label="${t('favorites')}: ${p.name}">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M12 3.6l2.47 5.01 5.53.8-4 3.9.94 5.5L12 16.9l-4.95 2.6.94-5.5-4-3.9 5.53-.8L12 3.6Z"
                fill="${fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="card__body">
          <h3 class="card__name" title="${p.name}">${p.name}</h3>
          <div class="card__meta">
            <span class="stock ${p.inStock ? 'stock--in' : 'stock--out'}">
              ${p.inStock ? t('in_stock') : t('out_of_stock')}
            </span>
            <span class="unit-chip">${p.unit}</span>
          </div>
          <div class="card__price">
            <span class="price-now">${priceMoney(p)}</span>
          </div>
          <button class="card__add" data-add="${p.id}" ${p.inStock ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M3 4h2l2 11h10l2-8H6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>${p.inStock ? t('add_to_cart') : t('out_of_stock')}</span>
          </button>
        </div>
      </article>`;
  }).join('');

  updateDotsAll();
  armFallbacks(grid);
}

// Local SVG fallback if picsum is unreachable (offline-friendly).
// Per-category tile colors for the offline placeholder.
const CAT_FALLBACK = {
  electronics: '#3B82F6', home: '#10B981', apparel: '#8B5CF6',
  accessories: '#F59E0B', tools: '#EF4444', grocery: '#14B8A6',
};
// Local placeholder shown when the product image host is unreachable. Keyed
// by product id so each card gets its category colour + icon (looks like a
// real tile, not a broken image).
function fallbackImg(id) {
  const p = PRODUCTS.find(x => x.id === id);
  const cat = p && p.tags[0];
  const icon = (CATEGORIES.find(c => c.id === cat) || {}).icon || '🛍️';
  const color = CAT_FALLBACK[cat] || '#FF8A00';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='640'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='${color}'/>
      <stop offset='1' stop-color='${color}' stop-opacity='0.72'/>
    </linearGradient></defs>
    <rect width='640' height='640' fill='url(#g)'/>
    <circle cx='320' cy='320' r='168' fill='rgba(255,255,255,0.16)'/>
    <text x='50%' y='320' font-family='sans-serif' font-size='168' text-anchor='middle' dominant-baseline='central'>${icon}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/* =========================================================================
 * RENDER: category banner
 * -------------------------------------------------------------------------
 * A full-width hero strip atop the grid that changes per category — gradient
 * keyed to the category colour, its icon, name, and live product count.
 * ========================================================================= */
const CAT_BANNER = {
  electronics: ['#3B82F6', '#1D4ED8'],
  home:        ['#10B981', '#047857'],
  apparel:     ['#8B5CF6', '#6D28D9'],
  accessories: ['#F59E0B', '#B45309'],
  tools:       ['#EF4444', '#B91C1C'],
  grocery:     ['#14B8A6', '#0F766E'],
};
function renderBanner(count) {
  const el = $('#banner');
  if (!el) return;
  let title, icon, pal;
  if (state.favView) {
    title = t('favorites'); icon = '♥'; pal = ['#F43F5E', '#BE123C'];
  } else if (state.category === 'all') {
    title = t('all'); icon = '🛍️'; pal = ['#FF8A00', '#F97316'];
  } else {
    title = t('cat_' + state.category);
    icon = (CATEGORIES.find(c => c.id === state.category) || {}).icon || '🛍️';
    pal = CAT_BANNER[state.category] || ['#FF8A00', '#F97316'];
  }
  el.style.setProperty('--bn-1', pal[0]);
  el.style.setProperty('--bn-2', pal[1]);
  el.innerHTML = `
    <span class="banner__icon" aria-hidden="true">${icon}</span>
    <span class="banner__text">
      <span class="banner__title">${title}</span>
      <span class="banner__sub">${count} ${t('results_count')}</span>
    </span>`;
}

/* =========================================================================
 * RENDER: category chips
 * ========================================================================= */
function renderChips() {
  const chips = $('#chips');
  const all = `<button class="chip" role="tab" data-cat="all" aria-selected="${state.category === 'all' && !state.favView}">
      <span class="chip__icon">🛍️</span><span>${t('all')}</span></button>`;
  const cats = CATEGORIES.map(c => `
      <button class="chip" role="tab" data-cat="${c.id}" aria-selected="${state.category === c.id && !state.favView}">
        <span class="chip__icon">${c.icon}</span><span>${t('cat_' + c.id)}</span>
      </button>`).join('');
  chips.innerHTML = all + cats;
}

/* =========================================================================
 * RENDER: settings menus (language / currency / theme)
 * ========================================================================= */
function renderMenus() {
  // The three switchers live as native <select> boxes inside the Settings panel
  // (compact, like a typical "Ship to / Language / Currency" sheet). Native
  // script labels (ខ្មែរ / ไทย / 中文) render via the Noto font stack.
  const langSel = $('#lang-select');
  if (langSel) {
    langSel.innerHTML = LANGS.map(l =>
      `<option value="${l.code}" ${state.lang === l.code ? 'selected' : ''}>${l.flag}  ${l.label}</option>`).join('');
    langSel.value = state.lang;
  }

  // Currency — e.g. "฿  THB · Thai Baht".
  const curSel = $('#cur-select');
  if (curSel) {
    curSel.innerHTML = Object.keys(CURRENCIES).map(code =>
      `<option value="${code}" ${state.currency === code ? 'selected' : ''}>${CURRENCIES[code].symbol}  ${code} · ${CURRENCIES[code].label}</option>`).join('');
    curSel.value = state.currency;
  }

  // Theme
  const themes = [
    { id: 'light',    emoji: '☀️' },
    { id: 'pandan',   emoji: '🌿' },
    { id: 'dark',     emoji: '🌙' },
    { id: 'festival', emoji: '🎉' },
  ];
  const themeSel = $('#theme-select');
  if (themeSel) {
    themeSel.innerHTML = themes.map(th =>
      `<option value="${th.id}" ${state.theme === th.id ? 'selected' : ''}>${th.emoji}  ${t('theme_' + th.id)}</option>`).join('');
    themeSel.value = state.theme;
  }

  // View size — segmented buttons, each a grid of rounded squares whose count
  // hints the density (Large = 2 big boxes … Smaller = 4×4). currentColor fill.
  const viewSeg = $('#view-seg');
  if (viewSeg) {
    const sq = (x, y, s, r) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${r}"/>`;
    const grid = (n, r) => {
      const span = 18, cell = (span - (n - 1) * 2) / n, start = 3; // 18px field, 2px gaps
      let out = '';
      for (let row = 0; row < n; row++) for (let col = 0; col < n; col++)
        out += sq((start + col * (cell + 2)).toFixed(1), (start + row * (cell + 2)).toFixed(1), cell.toFixed(1), r);
      return out;
    };
    const icons = {
      // Large = two big rounded boxes side by side
      lg: `${sq(3, 5, 8, 3)}${sq(13, 5, 8, 3)}`,
      md: grid(2, 2.6),   // the 2×2 reference, round corners
      sm: grid(3, 1.7),
      xs: grid(4, 1.2),
    };
    const sizes = ['lg', 'md', 'sm', 'xs'];
    viewSeg.innerHTML = sizes.map(id =>
      `<button class="viewseg__btn" data-view="${id}" aria-pressed="${state.gridSize === id}"
               title="${t('view_' + id)}" aria-label="${t('view_' + id)}">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">${icons[id]}</svg>
      </button>`).join('');
  }
}

/* =========================================================================
 * CART
 * ========================================================================= */
// A cart line is keyed by product + variant so the SAME product in two
// different variants stays on two separate lines.
const lineKeyOf = (id, variant) => `${id}::${variant}`;

const cartEntries = () => Object.entries(state.cart)
  .map(([key, line]) => ({ key, product: PRODUCTS.find(p => p.id === line.id), variant: line.variant, qty: line.qty }))
  .filter(e => e.product);

const cartCount = () => Object.values(state.cart).reduce((a, l) => a + l.qty, 0);
const cartTotalTHB = () => cartEntries().reduce((s, e) => s + priceTHBof(e.product, e.variant) * e.qty, 0);

function persist() {
  LS.set('cart', state.cart);
  LS.set('favorites', state.favorites);
  LS.set('lang', state.lang);
  LS.set('currency', state.currency);
  LS.set('theme', state.theme);
  LS.set('grid', state.gridSize);
}

function addToCart(id, qty = 1, variantLabel) {
  const product = PRODUCTS.find(p => p.id === id);
  if (!product) return;
  // Default to the first IN-STOCK variant when none is specified.
  const variant = variantLabel
    || (product.variants.find(v => v.inStock !== false) || product.variants[0]).label;
  const v = product.variants.find(x => x.label === variant) || product.variants[0];
  if (!v || v.inStock === false) return; // never add an out-of-stock variant
  const key = lineKeyOf(id, variant);
  const existing = state.cart[key];
  state.cart[key] = { id, variant, qty: (existing ? existing.qty : 0) + qty };
  persist();
  updateBadges();
  renderCart();
}

function setQty(key, qty) {
  if (qty <= 0) delete state.cart[key];
  else if (state.cart[key]) state.cart[key].qty = qty;
  persist();
  updateBadges();
  renderCart();
}

function updateBadges() {
  const count = cartCount();
  const cc = $('#cart-count');
  cc.textContent = count; cc.hidden = count === 0;
  const fc = $('#fav-count');
  fc.textContent = state.favorites.length; fc.hidden = state.favorites.length === 0;
  const hc = $('#history-count');
  if (hc) { const n = LS.get('orders', []).length; hc.textContent = n; hc.hidden = n === 0; }
}

function renderCart() {
  const entries = cartEntries();
  const linesEl = $('#cart-lines');
  const emptyEl = $('#cart-empty');

  emptyEl.classList.toggle('show', entries.length === 0);

  linesEl.innerHTML = entries.map(({ key, product: p, variant, qty }) => {
    const v = p.variants.find(x => x.label === variant) || p.variants[0];
    const sub = [variant, p.unit].filter(Boolean).join(' · ');
    return `
    <li class="line" data-key="${key}">
      <img class="line__img" src="${v.img}" alt="${p.name} — ${variant}" data-fb="${p.id}"
           onerror="this.onerror=null;this.src=fallbackImg('${p.id}')" />
      <div class="line__info">
        <span class="line__name">${p.name}</span>
        <span class="line__unit">${sub} — ${priceMoneyV(p, v)}</span>
        <div class="stepper">
          <button data-dec="${key}" aria-label="−">−</button>
          <input class="qty-input" type="text" inputmode="numeric" pattern="[0-9]*"
                 data-qty="${key}" value="${qty}" aria-label="${t('qty')}" />
          <button data-inc="${key}" aria-label="+">+</button>
        </div>
      </div>
      <div class="line__right">
        <span class="line__total">${priceMoneyV(p, v, qty)}</span>
        <button class="line__remove" data-remove="${key}">${t('remove')}</button>
      </div>
    </li>`;
  }).join('');
  armFallbacks(linesEl);

  // Totals — sum in the active currency so hand-set KHR prices aren't re-converted.
  const totalActive = cartEntries().reduce((s, e) => s + amountIn(priceTHBof(e.product, e.variant), priceKHRof(e.product, e.variant), e.qty), 0);
  $('#foot-items').textContent = cartCount();
  $('#foot-subtotal').textContent = formatMoney(totalActive, state.currency);
  $('#foot-total').textContent = formatMoney(totalActive, state.currency);

  // Disable checkout when empty
  $('#btn-checkout').disabled = entries.length === 0;
  $('#btn-checkout').style.opacity = entries.length === 0 ? '.5' : '1';
}

/* =========================================================================
 * DRAWER (cart / checkout / done) state machine
 * -------------------------------------------------------------------------
 * Both the drawer and the detail popup are modal: while one is open, Tab must
 * stay inside it (trapFocus) and closing must return focus to whatever opened
 * it (lastFocused) — otherwise keyboard users get dumped at the top of the
 * page. `lastFocused` is shared because the two overlays never stack.
 * ========================================================================= */
let lastFocused = null;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keep Tab/Shift+Tab cycling within `container`. Hidden controls (e.g. the
// not-yet-shown checkout view) are filtered out via offsetParent.
function trapFocus(container, e) {
  const nodes = $$(FOCUSABLE, container).filter(el => el.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function restoreFocus() { lastFocused?.focus?.(); lastFocused = null; }

function openDrawer() {
  lastFocused = document.activeElement;
  showDrawerView('cart');
  $('#scrim').hidden = false;
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  $('#drawer-close').focus();
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#scrim').hidden = true;
  document.body.style.overflow = '';
  restoreFocus();
}
function showDrawerView(view) {
  $('#view-cart').hidden = view !== 'cart';
  $('#view-checkout').hidden = view !== 'checkout';
  $('#view-done').hidden = view !== 'done';
  // Footer differs per view
  $('#drawer-foot').hidden = view === 'done';
  $('#cta-cart').hidden = view !== 'cart';
  $('#cta-checkout').hidden = view !== 'checkout';
  $('#drawer-title').textContent = view === 'checkout' ? t('checkout_title') : t('your_order');
  // Prefill the name from the signed-in Google account (only if still blank).
  if (view === 'checkout' && typeof auth !== 'undefined' && auth.user) {
    const nm = $('#view-checkout').name;
    if (nm && !nm.value) nm.value = auth.user.name || '';
  }
}

/* =========================================================================
 * THEME / LANG / CURRENCY setters
 * ========================================================================= */
function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  persist(); renderMenus();
}
function setGridSize(size) {
  state.gridSize = size;
  document.documentElement.setAttribute('data-grid', size);
  persist(); renderMenus();
}
function setLang(lang) {
  state.lang = lang;
  persist();
  applyI18n(); renderChips(); renderMenus(); renderGrid(); renderCart();
}
function setCurrency(cur) {
  state.currency = cur;
  persist();
  renderMenus(); renderGrid(); renderCart();
}

/* =========================================================================
 * TOAST
 * ========================================================================= */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.innerHTML = `<span class="toast__dot"></span><span>${msg}</span>`;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 250);
  }, 1700);
}

/* =========================================================================
 * PRODUCT DETAIL POPUP
 * -------------------------------------------------------------------------
 * A small dialog showing the product's name, price, tags, stock, unit type,
 * and selectable variants, with its own image gallery + quantity + add. The
 * (X) button (or Esc / backdrop click) closes it and returns to the grid.
 * ========================================================================= */
const detailState = { id: null, idx: 0, qty: 1 };

function openDetail(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  lastFocused = document.activeElement;
  detailState.id = id;
  detailState.idx = 0;   // start on the first variant
  detailState.qty = 1;
  renderDetail();
  $('#detail-scrim').hidden = false;
  $('#detail').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#pd-content').querySelector('.pd__close')?.focus();
}

function closeDetail() {
  $('#detail').hidden = true;
  $('#detail-scrim').hidden = true;
  if (!$('#drawer').classList.contains('open')) document.body.style.overflow = '';
  // "Add to bag" hands off to the drawer (which captures its own focus), so
  // only restore here when we're closing back to the grid.
  if ($('#drawer').classList.contains('open')) lastFocused = null;
  else restoreFocus();
}

function renderDetail() {
  const p = PRODUCTS.find(x => x.id === detailState.id);
  const imgs = productImages(p);
  const idx = detailState.idx;
  const v = p.variants[idx];
  const multi = imgs.length > 1;

  $('#pd-content').innerHTML = `
    <div class="pd__gallery">
      <div class="pd__stage">
        ${multi ? `<button class="pd__nav pd__nav--prev" data-pd-prev aria-label="Previous">‹</button>` : ''}
        <img id="pd-main" src="${imgs[idx]}" alt="${p.name}" data-fb="${p.id}" onerror="this.onerror=null;this.src=fallbackImg('${p.id}')" />
        ${multi ? `<button class="pd__nav pd__nav--next" data-pd-next aria-label="Next">›</button>` : ''}
      </div>
    </div>
    <div class="pd__info">
      <button class="pd__close" data-pd-close aria-label="${t('close')}">✕</button>
      <div class="pd__price">
        <span class="price-now">${priceMoneyV(p, v)}</span>
      </div>
      <h2 class="pd__name" id="pd-name">${p.name}</h2>
      <div class="pd__tags">${p.tags.map(tg => `<span class="pd__tag">${t('cat_' + tg)}</span>`).join('')}</div>
      <div class="pd__row">
        <span id="pd-stock" class="stock ${v.inStock !== false ? 'stock--in' : 'stock--out'}">${v.inStock !== false ? t('in_stock') : t('out_of_stock')}</span>
      </div>
      <div class="pd__divider"></div>
      <div class="pd__row">
        <span class="pd__label">${t('unit_label')}</span>
        <span class="pd__unit">${p.unit}</span>
      </div>
      <div class="pd__row">
        <span class="pd__label">${p.variantLabel}</span>
        <span class="pd__variant-name" id="pd-variant-name">${v.label}</span>
      </div>
      <div class="pd__variants">
        ${p.variants.map((vv, i) => `
          <button class="vthumb ${i === idx ? 'on' : ''} ${vv.inStock === false ? 'vthumb--out' : ''}" data-pd-variant="${i}" title="${vv.label}${vv.inStock === false ? ' — ' + t('out_of_stock') : ''}" aria-label="${vv.label}">
            <img src="${vv.img}" alt="${vv.label}" data-fb="${p.id}" onerror="this.onerror=null;this.src=fallbackImg('${p.id}')" />
            <span class="vthumb__dot" style="background:${vv.swatch}"></span>
          </button>`).join('')}
      </div>
      <div class="pd__divider"></div>
      <div class="pd__buy">
        <div class="stepper">
          <button data-pd-dec aria-label="−">−</button>
          <input id="pd-qty" class="qty-input" type="text" inputmode="numeric"
                 pattern="[0-9]*" value="${detailState.qty}" aria-label="${t('qty')}" />
          <button data-pd-inc aria-label="+">+</button>
        </div>
        <button class="pd__add" data-pd-add ${v.inStock !== false ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M3 4h2l2 11h10l2-8H6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>${v.inStock !== false ? t('add_to_bag') : t('out_of_stock')}</span>
        </button>
      </div>
    </div>`;

  armFallbacks($('#pd-content'));
}

// Change the selected variant/image in place (keeps the fade, no full reflow).
function setDetailIndex(i) {
  const p = PRODUCTS.find(x => x.id === detailState.id);
  const imgs = productImages(p);
  detailState.idx = (i + imgs.length) % imgs.length;
  const idx = detailState.idx;
  fadeTo($('#pd-main'), imgs[idx]);
  $('#pd-content').querySelectorAll('[data-pd-variant]').forEach((b, k) => b.classList.toggle('on', k === idx));
  $('#pd-variant-name').textContent = p.variants[idx].label;

  // Reflect the selected variant's price (each variant can be priced differently).
  const priceEl = $('#pd-content .pd__price .price-now');
  if (priceEl) priceEl.textContent = priceMoneyV(p, p.variants[idx]);

  // Reflect the selected variant's stock on the badge + add button.
  const inStk = p.variants[idx].inStock !== false;
  const badge = $('#pd-stock');
  if (badge) {
    badge.classList.toggle('stock--in', inStk);
    badge.classList.toggle('stock--out', !inStk);
    badge.textContent = inStk ? t('in_stock') : t('out_of_stock');
  }
  const addBtn = $('#pd-content [data-pd-add]');
  if (addBtn) {
    addBtn.disabled = !inStk;
    const lbl = addBtn.querySelector('span');
    if (lbl) lbl.textContent = inStk ? t('add_to_bag') : t('out_of_stock');
  }
}

function setDetailQty(q) {
  detailState.qty = Math.max(1, parseInt(q, 10) || 1);
  const el = $('#pd-qty');
  if (el) el.value = detailState.qty;
}

/* =========================================================================
 * EVENT WIRING
 * ========================================================================= */
function wire() {
  // --- Search (live filter, debounced so each keystroke doesn't re-render
  // the whole grid + re-arm every image watchdog) ---
  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    const v = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = v; renderGrid(); }, 120);
  });

  // --- Grid: route favorite / add / cycle image / open detail ---
  $('#grid').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { toggleFav(fav.dataset.fav); return; }

    const add = e.target.closest('[data-add]');
    if (add) {
      const id = add.dataset.add;
      addToCart(id);
      add.classList.add('is-added');
      const span = add.querySelector('span');
      if (span) span.textContent = t('added');
      setTimeout(() => { add.classList.remove('is-added'); if (span) span.textContent = t('add_to_cart'); }, 1100);
      toast(`${t('added')} · ${PRODUCTS.find(p => p.id === id).name}`);
      return;
    }

    // Clicking the image cycles to the next variant; clicking the rest of
    // the card opens the detail popup.
    const cycle = e.target.closest('[data-cycle]');
    if (cycle) { cycleCard(cycle.dataset.cycle); return; }

    const detail = e.target.closest('[data-detail]');
    if (detail) openDetail(detail.dataset.detail);
  });

  // --- Category chips ---
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    state.category = chip.dataset.cat;
    state.favView = false;
    $('#fav-toggle').setAttribute('aria-pressed', 'false');
    renderChips(); renderGrid();
  });

  // --- Favorites view toggle ---
  $('#fav-toggle').addEventListener('click', () => {
    state.favView = !state.favView;
    $('#fav-toggle').setAttribute('aria-pressed', String(state.favView));
    if (state.favView) state.category = 'all';
    closeAllMenus();   // fav lives in the Settings panel — close it after toggling
    renderChips(); renderGrid();
  });
  $('#empty-clear').addEventListener('click', () => {
    state.search = ''; $('#search').value = '';
    state.category = 'all'; state.favView = false;
    $('#fav-toggle').setAttribute('aria-pressed', 'false');
    renderChips(); renderGrid();
  });

  // --- Dropdown menus (open/close + pick) ---
  $$('[data-menu-toggle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = btn.closest('.menu');
      const isOpen = menu.classList.contains('open');
      closeAllMenus();
      if (!isOpen) { menu.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    });
  });
  document.addEventListener('click', closeAllMenus);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllMenus();
      if (!$('#history').hidden) closeHistory();
      else if (!$('#detail').hidden) closeDetail();
      else if ($('#drawer').classList.contains('open')) closeDrawer();
      return;
    }
    // Keep Tab inside whichever overlay is open (detail/history win — they stack above).
    if (e.key === 'Tab') {
      if (!$('#history').hidden) trapFocus($('#history'), e);
      else if (!$('#detail').hidden) trapFocus($('#detail'), e);
      else if ($('#drawer').classList.contains('open')) trapFocus($('#drawer'), e);
    }
  });

  // Lang/currency/theme are native <select> boxes inside the Settings panel.
  // They apply (and persist) instantly on change; the panel stays open so the
  // user can adjust several before closing.
  $('#lang-select')?.addEventListener('change', (e) => setLang(e.target.value));
  $('#cur-select')?.addEventListener('change', (e) => setCurrency(e.target.value));
  $('#theme-select')?.addEventListener('change', (e) => setTheme(e.target.value));
  $('#view-seg')?.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setGridSize(b.dataset.view); });
  // Clicks inside the Settings panel shouldn't bubble to the document close-handler,
  // so changing a setting leaves the panel open (gear re-click / outside click closes it).
  $('.menu__panel--settings')?.addEventListener('click', (e) => e.stopPropagation());

  // --- Cart open/close ---
  $('#cart-open').addEventListener('click', openDrawer);
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  $('#btn-continue').addEventListener('click', closeDrawer);

  // --- Cart line controls (delegate) ---
  $('#cart-lines').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    const rem = e.target.closest('[data-remove]');
    if (inc) setQty(inc.dataset.inc, (state.cart[inc.dataset.inc]?.qty || 0) + 1);
    if (dec) setQty(dec.dataset.dec, (state.cart[dec.dataset.dec]?.qty || 0) - 1);
    if (rem) setQty(rem.dataset.remove, 0);
  });
  // Typed quantity in a cart line: filter to digits live, commit on blur/Enter.
  // (Committing on 'change' avoids re-rendering — and losing focus — per keystroke.)
  $('#cart-lines').addEventListener('input', (e) => {
    const inp = e.target.closest('[data-qty]');
    if (inp) inp.value = inp.value.replace(/[^0-9]/g, '');
  });
  $('#cart-lines').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-qty]');
    if (!inp) return;
    const v = parseInt(inp.value, 10);
    if (isNaN(v)) renderCart();              // empty -> revert to the saved qty
    else setQty(inp.dataset.qty, v);         // 0 removes the line
  });
  $('#cart-lines').addEventListener('keydown', (e) => {
    if (e.target.closest('[data-qty]') && e.key === 'Enter') e.target.blur();
  });

  // --- Checkout flow ---
  $('#btn-checkout').addEventListener('click', () => { if (cartCount() > 0) showDrawerView('checkout'); });
  $('#btn-back').addEventListener('click', () => showDrawerView('cart'));
  $('#btn-place').addEventListener('click', downloadOrder);
  $('#btn-share').addEventListener('click', shareOrder);
  $('#done-new').addEventListener('click', () => { closeDrawer(); showDrawerView('cart'); });

  // --- Order history popup ---
  $('#history-open').addEventListener('click', () => { closeAllMenus(); openHistory(); });
  $('#history-scrim').addEventListener('click', closeHistory);
  $('#hist-content').addEventListener('click', (e) => {
    if (e.target.closest('#history-close')) return closeHistory();
    const r = e.target.closest('[data-reorder]');
    if (r) reorderById(r.dataset.reorder);
  });

  // --- Product detail popup ---
  $('#detail-scrim').addEventListener('click', closeDetail);
  // Typed quantity: keep only digits live, commit a valid number, and
  // normalize an empty/zero field back to the last value on blur or Enter.
  $('#pd-content').addEventListener('input', (e) => {
    if (e.target.id !== 'pd-qty') return;
    const v = e.target.value.replace(/[^0-9]/g, '');
    e.target.value = v;
    if (v !== '') detailState.qty = Math.max(1, parseInt(v, 10));
  });
  $('#pd-content').addEventListener('focusout', (e) => {
    if (e.target.id === 'pd-qty') e.target.value = detailState.qty;
  });
  $('#pd-content').addEventListener('keydown', (e) => {
    if (e.target.id === 'pd-qty' && e.key === 'Enter') e.target.blur();
  });
  $('#pd-content').addEventListener('click', (e) => {
    if (e.target.closest('[data-pd-close]')) return closeDetail();
    const variant = e.target.closest('[data-pd-variant]');
    if (variant) return setDetailIndex(+variant.dataset.pdVariant);
    if (e.target.closest('[data-pd-prev]')) return setDetailIndex(detailState.idx - 1);
    if (e.target.closest('[data-pd-next]')) return setDetailIndex(detailState.idx + 1);
    if (e.target.closest('[data-pd-dec]')) return setDetailQty(detailState.qty - 1);
    if (e.target.closest('[data-pd-inc]')) return setDetailQty(detailState.qty + 1);
    if (e.target.closest('[data-pd-add]')) {
      const p = PRODUCTS.find(x => x.id === detailState.id);
      addToCart(p.id, detailState.qty, p.variants[detailState.idx].label);
      toast(`${t('added')} · ${detailState.qty}× ${p.name}`);
      closeDetail();
      openDrawer();
    }
  });
}

function toggleFav(id) {
  const i = state.favorites.indexOf(id);
  const adding = i < 0;
  if (adding) state.favorites.push(id);
  else state.favorites.splice(i, 1);
  persist();
  updateBadges();
  const name = PRODUCTS.find(p => p.id === id)?.name || '';
  toast(`${adding ? '♥' : '♡'} ${t(adding ? 'fav_added' : 'fav_removed')} · ${name}`);
  // Update just the pressed buttons without a full re-render (keeps scroll).
  $$(`[data-fav="${id}"]`).forEach(btn => {
    const on = state.favorites.includes(id);
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('path').setAttribute('fill', on ? 'currentColor' : 'none');
  });
  if (state.favView) renderGrid();   // item may need to leave the favorites view
}

function closeAllMenus() {
  $$('.menu.open').forEach(m => { m.classList.remove('open'); m.querySelector('[data-menu-toggle]')?.setAttribute('aria-expanded', 'false'); });
}

/* =========================================================================
 * PLACE ORDER -> build order object -> PDF
 * ========================================================================= */
// Validate the form and assemble the order object (or null if invalid).
// Each item carries its chosen variant image + swatch for the PDF.
function buildOrder() {
  const form = $('#view-checkout');
  const data = Object.fromEntries(new FormData(form).entries());
  const err = $('#form-error');

  if (!data.name?.trim()) {
    // Surface the warning and replay the shake so a repeat click re-pulses it.
    err.hidden = false;
    err.classList.remove('shake');
    void err.offsetWidth;               // force reflow so the animation restarts
    err.classList.add('shake');
    form.name.focus();
    return null;
  }
  err.hidden = true;
  err.classList.remove('shake');

  const now = new Date();
  return {
    id: nextOrderId(),
    // Force en-US so the printed date stays Latin (some locales render non-Latin
    // numerals / Buddhist era that Helvetica can't draw — same issue as labels).
    dateStr: now.toLocaleString('en-US'),
    currency: state.currency,
    langName: LANG_EN_NAMES[state.lang] || 'English',
    customer: { name: data.name.trim(), table: data.table?.trim(), note: data.note?.trim() },
    items: cartEntries().map(({ product, variant, qty }) => {
      const v = product.variants.find(x => x.label === variant) || product.variants[0];
      return {
        id: product.id,                  // kept so order history can re-add to cart
        name: product.name,
        variant: variant || '',          // kept separate so the PDF prints it on its own line
        qty, unitTHB: priceTHBof(product, v), unitKHR: Number(priceKHRof(product, v)) || 0, img: v.img, swatch: v.swatch,
      };
    }),
  };
}

// Sequential order id: "MM-100001", "MM-100002", … persisted in localStorage so
// numbers keep running across visits. Starts the counter at 100000 so the first
// real order is MM-100001.
function nextOrderId() {
  let n = parseInt(LS.get('orderseq', 100000), 10);
  if (!Number.isFinite(n)) n = 100000;
  n += 1;
  LS.set('orderseq', n);
  return 'MM-' + n;
}

// Record a completed order so the customer can see it under "Order history".
// We keep a trimmed copy (no images/swatches) and cap the list so localStorage
// never grows unbounded. Newest first.
function saveOrderHistory(order, status) {
  const totalTHB = order.items.reduce((s, it) => s + it.unitTHB * it.qty, 0);
  const record = {
    id: order.id,
    dateStr: order.dateStr,
    status,                              // 'downloaded' | 'shared' | 'sent'
    currency: order.currency,
    customer: { name: order.customer?.name || '' },
    totalTHB,
    items: order.items.map(it => ({ id: it.id, name: it.name, variant: it.variant, qty: it.qty, unitTHB: it.unitTHB })),
  };
  const list = LS.get('orders', []);
  list.unshift(record);
  if (list.length > 30) list.length = 30;
  LS.set('orders', list);
  updateBadges();
}

function finalizeOrder(bodyKey) {
  state.cart = {};
  persist();
  updateBadges();
  renderCart();
  $('#view-checkout').reset();
  $('#done-body').textContent = t(bodyKey);
  showDrawerView('done');
}

// "Download PDF" — build + download the sheet, but KEEP the cart so the
// customer still has their bill and can complete checkout afterwards.
async function downloadOrder() {
  const order = buildOrder();
  if (!order) return;
  const btn = $('#btn-place');
  btn.disabled = true;
  try { await downloadOrderSheet(order, tPDF); saveOrderHistory(order, 'downloaded'); toast(t('saved')); }
  catch (e) { console.error(e); toast('PDF error — see console'); }
  finally { btn.disabled = false; }
}

// "Checked out & Sent" — build the sheet and open the OS share sheet so the
// customer can send it via Telegram / LINE / Messenger / WeChat, etc. This is
// the real checkout: it clears the cart on success.
async function shareOrder() {
  const order = buildOrder();
  if (!order) return;
  const btn = $('#btn-share');
  btn.disabled = true;
  try {
    const result = await shareOrderSheet(order, tPDF);   // 'shared' | 'downloaded' | 'cancelled'
    if (result === 'cancelled') return;               // user dismissed the share sheet — keep editing
    saveOrderHistory(order, result === 'shared' ? 'sent' : 'downloaded');
    finalizeOrder(result === 'shared' ? 'order_shared_body' : 'share_fallback');
  } catch (e) { console.error(e); toast('Share error — see console'); }
  finally { btn.disabled = false; }
}

/* =========================================================================
 * ORDER HISTORY popup
 * -------------------------------------------------------------------------
 * Past orders are persisted by saveOrderHistory() under mymart.orders. This
 * popup lists them newest-first; "Reorder" drops the same items back into the
 * cart. Money is shown via money() so it tracks the active currency, not the
 * currency the order was originally placed in.
 * ========================================================================= */
let histLastFocused = null;

function renderHistory() {
  const orders = LS.get('orders', []);
  const el = $('#hist-content');
  const head = `
    <header class="hist__head">
      <h2 id="history-title" class="hist__title">${t('order_history')}</h2>
      <button class="iconbtn iconbtn--close" id="history-close" aria-label="Close">✕</button>
    </header>`;

  if (!orders.length) {
    el.innerHTML = head + `
      <div class="hist__empty">
        <div class="hist__art" aria-hidden="true">🧾</div>
        <p>${t('no_orders')}</p>
      </div>`;
    return;
  }

  const body = orders.map(o => {
    const items = o.items.map(it => `
      <li class="hist__item">
        <span class="hist__qty">${it.qty}×</span>
        <span class="hist__iname">${contactEscape(it.name)}${it.variant ? ` <em>· ${contactEscape(it.variant)}</em>` : ''}</span>
        <span class="hist__iline mono">${formatMoney(amountIn(it.unitTHB, it.unitKHR, it.qty), state.currency)}</span>
      </li>`).join('');
    return `
      <article class="hist__order">
        <header class="hist__ohead">
          <div class="hist__oid">
            <strong>${contactEscape(o.id)}</strong>
            <span class="hist__status hist__status--${o.status}">${t('status_' + o.status) || o.status}</span>
          </div>
          <time class="hist__date">${contactEscape(o.dateStr)}</time>
        </header>
        <ul class="hist__items">${items}</ul>
        <footer class="hist__ofoot">
          <strong class="hist__total mono">${t('total')}: ${formatMoney(o.items.reduce((s, it) => s + amountIn(it.unitTHB, it.unitKHR, it.qty), 0), state.currency)}</strong>
          <button class="btn btn--primary hist__reorder" data-reorder="${contactEscape(o.id)}">${t('reorder')}</button>
        </footer>
      </article>`;
  }).join('');

  el.innerHTML = head + `<div class="hist__list">${body}</div>`;
}

function openHistory() {
  histLastFocused = document.activeElement;
  renderHistory();
  $('#history-scrim').hidden = false;
  $('#history').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#hist-content').querySelector('#history-close')?.focus();
}

function closeHistory() {
  $('#history').hidden = true;
  $('#history-scrim').hidden = true;
  if (!$('#drawer').classList.contains('open') && $('#detail').hidden) document.body.style.overflow = '';
  histLastFocused?.focus?.();
  histLastFocused = null;
}

// "Reorder" — re-add the order's still-available items to the cart, then open it.
function reorderById(id) {
  const o = LS.get('orders', []).find(x => x.id === id);
  if (!o) return;
  let added = 0, skipped = 0;
  o.items.forEach(it => {
    const p = PRODUCTS.find(x => x.id === it.id);
    if (p && p.inStock) { addToCart(it.id, it.qty, it.variant); added++; }
    else skipped++;
  });
  closeHistory();
  if (added) { openDrawer(); toast(skipped ? t('reorder_partial') : t('reordered')); }
  else toast(t('reorder_unavailable'));
}

/* =========================================================================
 * INIT
 * ========================================================================= */
async function init() {
  // Guard against stale localStorage: USD was removed, and the cart format
  // changed from { id: qty } to { lineKey: {id, variant, qty} }.
  if (!CURRENCIES[state.currency]) state.currency = 'KHR';
  if (Object.values(state.cart).some(v => typeof v !== 'object' || v === null)) state.cart = {};
  if (!['lg', 'md', 'sm', 'xs'].includes(state.gridSize)) state.gridSize = 'md';

  document.documentElement.setAttribute('data-theme', state.theme);
  document.documentElement.setAttribute('data-grid', state.gridSize);

  // Pull the live catalog from the backend if one is reachable; on any failure
  // keep the static data.js catalog so the shop always renders.
  if (typeof hydrateCatalog === 'function') {
    try { await hydrateCatalog(); } catch (e) { console.warn('Catalog: using bundled data (backend unavailable).', e); }
  }

  applyI18n();
  renderChips();
  renderMenus();
  renderGrid();
  renderCart();
  updateBadges();
  wire();
  startRotation();   // begin auto-fading variant images on the cards
  // Pause the rotation while the tab is backgrounded — no point repainting
  // off-screen, and it saves battery on phones.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopRotation(); else startRotation();
  });
}

document.addEventListener('DOMContentLoaded', init);
