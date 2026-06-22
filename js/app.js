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
  currency:  LS.get('currency', 'THB'),
  theme:     LS.get('theme', 'light'),
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
  }, 3800);
}

function renderGrid() {
  const grid = $('#grid');
  const list = filteredProducts();

  // View heading + count
  $('#view-title').textContent = state.favView ? t('favorites')
    : state.category === 'all' ? t('all') : t('cat_' + state.category);
  $('#result-count').textContent = list.length;

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
    const onSale = p.wasTHB && p.wasTHB > p.priceTHB;
    const pct = onSale ? Math.round((1 - p.priceTHB / p.wasTHB) * 100) : 0;
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
          ${onSale ? `<span class="sale-badge">-${pct}% ${t('off')}</span>` : ''}
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
            <span class="price-now">${money(p.priceTHB)}</span>
            ${onSale ? `<span class="price-was">${money(p.wasTHB)}</span>` : ''}
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
  // Language
  $('#lang-menu').innerHTML = LANGS.map(l => `
    <button class="menu__item" role="menuitemradio" data-lang="${l.code}" aria-checked="${state.lang === l.code}">
      <span>${l.flag}</span><span>${l.label}</span>
    </button>`).join('');
  const active = LANGS.find(l => l.code === state.lang) || LANGS[0];
  $('#lang-flag').textContent = active.flag;
  $('#lang-code').textContent = active.code.toUpperCase();

  // Currency
  $('#cur-menu').innerHTML = Object.keys(CURRENCIES).map(code => `
    <button class="menu__item" role="menuitemradio" data-cur="${code}" aria-checked="${state.currency === code}">
      <span class="sym">${CURRENCIES[code].symbol}</span><span>${code} · ${CURRENCIES[code].label}</span>
    </button>`).join('');
  $('#cur-sym').textContent = CURRENCIES[state.currency].symbol;
  $('#cur-code').textContent = state.currency;

  // Theme
  const themes = [
    { id: 'light',    emoji: '☀️', sw: '#FBFAF6' },
    { id: 'dark',     emoji: '🌙', sw: '#0C1714' },
    { id: 'festival', emoji: '🎉', sw: '#2A1245' },
  ];
  $('#theme-menu').innerHTML = themes.map(th => `
    <button class="menu__item" role="menuitemradio" data-theme-pick="${th.id}" aria-checked="${state.theme === th.id}">
      <span class="menu__swatch" style="background:${th.sw}"></span><span>${t('theme_' + th.id)}</span>
    </button>`).join('');
  $('#theme-dot').textContent = (themes.find(th => th.id === state.theme) || themes[0]).emoji;
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
const cartTotalTHB = () => cartEntries().reduce((s, e) => s + e.product.priceTHB * e.qty, 0);

function persist() {
  LS.set('cart', state.cart);
  LS.set('favorites', state.favorites);
  LS.set('lang', state.lang);
  LS.set('currency', state.currency);
  LS.set('theme', state.theme);
}

function addToCart(id, qty = 1, variantLabel) {
  const product = PRODUCTS.find(p => p.id === id);
  if (!product || !product.inStock) return;
  const variant = variantLabel || product.variants[0].label;
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
        <span class="line__unit">${sub} — ${money(p.priceTHB)}</span>
        <div class="stepper">
          <button data-dec="${key}" aria-label="−">−</button>
          <input class="qty-input" type="text" inputmode="numeric" pattern="[0-9]*"
                 data-qty="${key}" value="${qty}" aria-label="${t('qty')}" />
          <button data-inc="${key}" aria-label="+">+</button>
        </div>
      </div>
      <div class="line__right">
        <span class="line__total">${money(p.priceTHB * qty)}</span>
        <button class="line__remove" data-remove="${key}">${t('remove')}</button>
      </div>
    </li>`;
  }).join('');
  armFallbacks(linesEl);

  // Totals
  const totalTHB = cartTotalTHB();
  $('#foot-items').textContent = cartCount();
  $('#foot-subtotal').textContent = money(totalTHB);
  $('#foot-total').textContent = money(totalTHB);

  // Disable checkout when empty
  $('#btn-checkout').disabled = entries.length === 0;
  $('#btn-checkout').style.opacity = entries.length === 0 ? '.5' : '1';
}

/* =========================================================================
 * DRAWER (cart / checkout / done) state machine
 * ========================================================================= */
function openDrawer() {
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
}

/* =========================================================================
 * THEME / LANG / CURRENCY setters
 * ========================================================================= */
function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
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
}

function renderDetail() {
  const p = PRODUCTS.find(x => x.id === detailState.id);
  const imgs = productImages(p);
  const idx = detailState.idx;
  const v = p.variants[idx];
  const onSale = p.wasTHB && p.wasTHB > p.priceTHB;
  const pct = onSale ? Math.round((1 - p.priceTHB / p.wasTHB) * 100) : 0;
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
        <span class="price-now">${money(p.priceTHB)}</span>
        ${onSale ? `<span class="price-was">${money(p.wasTHB)}</span><span class="sale-pct">-${pct}% ${t('off')}</span>` : ''}
      </div>
      <h2 class="pd__name" id="pd-name">${p.name}</h2>
      <div class="pd__tags">${p.tags.map(tg => `<span class="pd__tag">${t('cat_' + tg)}</span>`).join('')}</div>
      <div class="pd__row">
        <span class="stock ${p.inStock ? 'stock--in' : 'stock--out'}">${p.inStock ? t('in_stock') : t('out_of_stock')}</span>
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
          <button class="vthumb ${i === idx ? 'on' : ''}" data-pd-variant="${i}" title="${vv.label}" aria-label="${vv.label}">
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
        <button class="pd__add" data-pd-add ${p.inStock ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M3 4h2l2 11h10l2-8H6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>${p.inStock ? t('add_to_bag') : t('out_of_stock')}</span>
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
  // --- Search (live filter) ---
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderGrid(); });

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
    if (e.key !== 'Escape') return;
    closeAllMenus();
    if (!$('#detail').hidden) closeDetail();
    else if ($('#drawer').classList.contains('open')) closeDrawer();
  });

  $('#lang-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-lang]'); if (b) { setLang(b.dataset.lang); closeAllMenus(); } });
  $('#cur-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-cur]'); if (b) { setCurrency(b.dataset.cur); closeAllMenus(); } });
  $('#theme-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-theme-pick]'); if (b) { setTheme(b.dataset.themePick); closeAllMenus(); } });

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
  if (i >= 0) state.favorites.splice(i, 1);
  else state.favorites.push(id);
  persist();
  updateBadges();
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

  if (!data.name?.trim()) { err.hidden = false; form.name.focus(); return null; }
  err.hidden = true;

  const now = new Date();
  return {
    id: 'MM-' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '-' + Math.floor(1000 + Math.random() * 9000),
    dateStr: now.toLocaleString(),
    currency: state.currency,
    customer: { name: data.name.trim(), table: data.table?.trim(), note: data.note?.trim() },
    items: cartEntries().map(({ product, variant, qty }) => {
      const v = product.variants.find(x => x.label === variant) || product.variants[0];
      return {
        name: variant ? `${product.name} (${variant})` : product.name,
        qty, unitTHB: product.priceTHB, img: v.img, swatch: v.swatch,
      };
    }),
  };
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
  try { await downloadOrderSheet(order, t); toast(t('saved')); }
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
    const result = await shareOrderSheet(order, t);   // 'shared' | 'downloaded' | 'cancelled'
    if (result === 'cancelled') return;               // user dismissed the share sheet — keep editing
    finalizeOrder(result === 'shared' ? 'order_shared_body' : 'share_fallback');
  } catch (e) { console.error(e); toast('Share error — see console'); }
  finally { btn.disabled = false; }
}

/* =========================================================================
 * INIT
 * ========================================================================= */
function init() {
  // Guard against stale localStorage: USD was removed, and the cart format
  // changed from { id: qty } to { lineKey: {id, variant, qty} }.
  if (!CURRENCIES[state.currency]) state.currency = 'THB';
  if (Object.values(state.cart).some(v => typeof v !== 'object' || v === null)) state.cart = {};

  document.documentElement.setAttribute('data-theme', state.theme);
  applyI18n();
  renderChips();
  renderMenus();
  renderGrid();
  renderCart();
  updateBadges();
  wire();
  startRotation();   // begin auto-fading variant images on the cards
}

document.addEventListener('DOMContentLoaded', init);
