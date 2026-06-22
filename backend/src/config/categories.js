// DEFAULT categories — used only to seed the editable `Category` table on first
// run. After seeding, the DB is the source of truth (staff can add/edit/remove
// categories). The slugs mirror the storefront (js/data.js CATEGORIES) and double
// as its `cat_*` i18n keys. Products reference categories by slug in `tagsJson`.
const DEFAULT_CATEGORIES = [
  { slug: 'electronics', icon: '🔌', label: 'Electronics' },
  { slug: 'home', icon: '🏠', label: 'Home' },
  { slug: 'apparel', icon: '👕', label: 'Apparel' },
  { slug: 'accessories', icon: '🎒', label: 'Accessories' },
  { slug: 'tools', icon: '🔧', label: 'Tools' },
  { slug: 'grocery', icon: '🛒', label: 'Grocery' },
];

const DEFAULT_CATEGORY_SLUGS = DEFAULT_CATEGORIES.map((c) => c.slug);

module.exports = { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_SLUGS };
