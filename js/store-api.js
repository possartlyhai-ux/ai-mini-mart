/* =========================================================================
 * store-api.js — Live catalog from the backend (admin/POS) feed.
 * -------------------------------------------------------------------------
 * The storefront ships a static catalog in data.js. When a backend is
 * reachable, hydrateCatalog() pulls the live products + categories from
 *   GET <API_BASE>/api/storefront/products
 *   GET <API_BASE>/api/storefront/categories
 * and replaces the PRODUCTS / CATEGORIES contents IN PLACE (keeps the const
 * bindings the rest of the app relies on). Any failure leaves the static
 * data.js catalog untouched, so the shop still works fully offline.
 *
 * Loaded right after data.js and before app.js (see index.html).
 * ========================================================================= */

// Where the backend lives. Local dev talks to the Express server on :3000;
// in production point this at the deployed backend (Render) URL.
const STORE_API_BASE = (() => {
  const override = (() => { try { return localStorage.getItem('mymart.apiBase'); } catch { return null; } })();
  if (override) return override.replace(/\/$/, '');
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3000';
  // Deployed backend (Render).
  return 'https://ai-mini-mart-api.onrender.com';
})();

// Feed variants carry no colour chip / group label (storefront-only concepts),
// so synthesise a sensible swatch from the label and a generic group name.
const SWATCHES = {
  white: '#EDEDED', black: '#1C1C1C', clay: '#C96F4A', sand: '#DCC9A6',
  slate: '#5B6470', cream: '#F0E9DA', red: '#D94A3D', blue: '#3B6FB0',
  green: '#3E8E5A', grey: '#9A9A9A', gray: '#9A9A9A', natural: '#D9C7A6',
};
function swatchFor(label) {
  const key = String(label || '').toLowerCase();
  for (const name in SWATCHES) if (key.includes(name)) return SWATCHES[name];
  return '#D9D2C7';
}

// Map one backend feed product -> the storefront PRODUCTS shape.
function mapFeedProduct(p) {
  const variants = (p.variants && p.variants.length ? p.variants : [{ label: 'Default', img: '' }]).map((v) => ({
    label: v.label || 'Default',
    swatch: swatchFor(v.label),
    img: v.img || '',
    // Carry per-variant price so the shop can show the right price per option.
    // Each backend variant sets its own THB + (optional hand-set) KHR price.
    priceTHB: v.priceTHB != null ? Number(v.priceTHB) : undefined,
    priceKHR: v.priceKHR != null ? Number(v.priceKHR) : undefined,
    inStock: v.inStock !== false, // carry per-variant stock so the shop can gate each one
  }));
  return {
    id: p.id,
    name: p.name,
    tags: Array.isArray(p.tags) ? p.tags : [],
    sub: p.sub || null, // drives the breadcrumb + sub-tag bar (renderSubnav)
    priceTHB: Number(p.priceTHB) || 0,
    priceKHR: p.priceKHR != null ? Number(p.priceKHR) : undefined,
    inStock: variants.some((v) => v.inStock), // product is "in stock" if ANY variant is
    unit: p.unit || '',
    variantLabel: 'Option',
    variants,
  };
}

async function hydrateCatalog() {
  const base = STORE_API_BASE;
  if (!base || base.includes('REPLACE_WITH_RENDER_URL')) return false; // not configured yet
  const [prodRes, catRes] = await Promise.all([
    fetch(`${base}/api/storefront/products`, { headers: { Accept: 'application/json' } }),
    fetch(`${base}/api/storefront/categories`, { headers: { Accept: 'application/json' } }),
  ]);
  if (!prodRes.ok || !catRes.ok) throw new Error(`feed HTTP ${prodRes.status}/${catRes.status}`);
  const { products } = await prodRes.json();
  const { categories } = await catRes.json();
  if (!Array.isArray(products) || !products.length) throw new Error('empty product feed');

  // Replace contents in place so PRODUCTS / CATEGORIES const bindings stay valid.
  PRODUCTS.length = 0;
  products.forEach((p) => PRODUCTS.push(mapFeedProduct(p)));
  if (Array.isArray(categories) && categories.length) {
    CATEGORIES.length = 0;
    categories.forEach((c) => CATEGORIES.push({ id: c.id, icon: c.icon || '🛍️', banner: c.banner, subs: Array.isArray(c.subs) ? c.subs : [] }));
  }
  return true;
}
