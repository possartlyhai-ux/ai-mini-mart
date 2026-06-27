// DEFAULT categories — used only to seed the editable `Category` table on first
// run. After seeding, the DB is the source of truth (staff can add/edit/remove
// categories). The slugs mirror the storefront (js/data.js CATEGORIES) and double
// as its `cat_*` i18n keys. Products reference categories by slug in `tagsJson`.
//
// `subs` are the seed subcategories for each category, mirroring the storefront's
// CATEGORIES[].subs + the `sub_*` i18n labels. After seeding they live in the
// editable `Subcategory` table; a product points at one via Product.sub.
const DEFAULT_CATEGORIES = [
  { slug: 'electronics', icon: '🔌', label: 'Electronics', subs: [
    { slug: 'audio', label: 'Audio' },
    { slug: 'computing', label: 'Computing' },
    { slug: 'lighting', label: 'Lighting' },
    { slug: 'wearables', label: 'Wearables' },
    { slug: 'power', label: 'Charging' },
  ] },
  { slug: 'home', icon: '🏠', label: 'Home', subs: [
    { slug: 'kitchen', label: 'Kitchen' },
    { slug: 'bedding', label: 'Bedding' },
  ] },
  { slug: 'apparel', icon: '👕', label: 'Apparel', subs: [
    { slug: 'tops', label: 'Tops' },
    { slug: 'socks', label: 'Socks' },
  ] },
  { slug: 'accessories', icon: '🎒', label: 'Accessories', subs: [
    { slug: 'bags', label: 'Bags' },
    { slug: 'drinkware', label: 'Drinkware' },
  ] },
  { slug: 'tools', icon: '🔧', label: 'Tools', subs: [
    { slug: 'handtools', label: 'Hand tools' },
    { slug: 'garden', label: 'Garden' },
    { slug: 'powertools', label: 'Power tools' },
  ] },
  { slug: 'grocery', icon: '🛒', label: 'Grocery', subs: [
    { slug: 'coffee', label: 'Coffee' },
    { slug: 'pantry', label: 'Pantry' },
  ] },
];

const DEFAULT_CATEGORY_SLUGS = DEFAULT_CATEGORIES.map((c) => c.slug);

module.exports = { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_SLUGS };
