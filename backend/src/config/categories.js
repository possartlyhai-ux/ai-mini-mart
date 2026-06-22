// Category ids mirror the storefront (js/data.js CATEGORIES) and double as the
// `cat_*` i18n keys there. Kept as a constant — they are fixed, shared with the
// storefront, and small enough not to warrant a DB table. Products reference
// these ids in their `tagsJson` array.
const CATEGORIES = [
  { id: 'electronics', icon: '🔌', label: 'Electronics' },
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'apparel', icon: '👕', label: 'Apparel' },
  { id: 'accessories', icon: '🎒', label: 'Accessories' },
  { id: 'tools', icon: '🔧', label: 'Tools' },
  { id: 'grocery', icon: '🛒', label: 'Grocery' },
];

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

module.exports = { CATEGORIES, CATEGORY_IDS };
