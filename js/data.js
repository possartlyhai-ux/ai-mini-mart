/* =========================================================================
 * data.js — Product catalog + category definitions
 * -------------------------------------------------------------------------
 * All prices are stored as a BASE PRICE in Thai Baht (THB). Currency
 * conversion + formatting happens in currency.js.
 *
 * Each product now carries:
 *   inStock      boolean   -> green "In stock" / red "Out of stock" badge
 *   unit         string    -> unit type / spec shown on card + detail
 *                            (e.g. "500 ml", "250 g", "3 pairs")
 *   variantLabel string    -> the group name for variants ("Color","Size"…)
 *   variants     array     -> [{ label, swatch, img }]
 *                            swatch = the little colour chip in the picker
 *                            img    = the picture shown for that variant
 *
 * The card preview auto-fades through every variant image, and the detail
 * popup shows them as a thumbnail gallery you can click through.
 *
 * To add a product: copy a block, give it a unique `id`, set price/unit/
 * stock, list its variants, and pick categories in `tags` (must match a
 * CATEGORY id).
 * ========================================================================= */

// Category ids are also i18n keys (see js/i18n.js -> cat_*).
// `subs` lists each category's subcategory ids (i18n keys sub_*). A product's
// `sub` (one id, belonging to the product's PRIMARY category = tags[0]) drives
// the breadcrumb + sub-tag bar above the grid (renderSubnav in app.js).
const CATEGORIES = [
  { id: 'electronics', icon: '🔌', subs: ['audio', 'computing', 'lighting', 'wearables', 'power'] },
  { id: 'home',        icon: '🏠', subs: ['kitchen', 'bedding'] },
  { id: 'apparel',     icon: '👕', subs: ['tops', 'socks'] },
  { id: 'accessories', icon: '🎒', subs: ['bags', 'drinkware'] },
  { id: 'tools',       icon: '🔧', subs: ['handtools', 'garden', 'powertools'] },
  { id: 'grocery',     icon: '🛒', subs: ['coffee', 'pantry'] },
];

// picsum gives a stable image per `seed`. We request a square crop.
const pic = (seed) => `https://picsum.photos/seed/${seed}/640/640`;

// Build a product's gallery from its variant images (first = hero).
function productImages(p) { return p.variants.map(v => v.img); }

const PRODUCTS = [
  {
    id: 'p01', name: 'Aurora Wireless Earbuds', tags: ['electronics', 'accessories'], sub: 'audio',
    priceTHB: 1290, inStock: true, unit: '1 pair', variantLabel: 'Color',
    variants: [
      { label: 'Cloud White', swatch: '#EDEDED', img: pic('mymart-earbuds-white') },
      { label: 'Onyx Black',  swatch: '#1C1C1C', img: pic('mymart-earbuds-black') },
    ],
  },
  {
    id: 'p02', name: 'Terra Ceramic Pour-Over Set', tags: ['home'], sub: 'kitchen',
    priceTHB: 890, inStock: true, unit: '600 ml', variantLabel: 'Color',
    variants: [
      { label: 'Clay', swatch: '#C96F4A', img: pic('mymart-pourover-clay') },
      { label: 'Sand', swatch: '#DCC9A6', img: pic('mymart-pourover-sand') },
    ],
  },
  {
    id: 'p03', name: 'Drift Linen Overshirt', tags: ['apparel'], sub: 'tops',
    priceTHB: 1150, inStock: true, unit: 'Unisex', variantLabel: 'Color',
    variants: [
      { label: 'Olive', swatch: '#6B7253', img: pic('mymart-overshirt-olive') },
      { label: 'Ecru',  swatch: '#E6DDC7', img: pic('mymart-overshirt-ecru') },
    ],
  },
  {
    id: 'p04', name: 'Nimbus 65% Mechanical Keyboard', tags: ['electronics'], sub: 'computing',
    priceTHB: 2490, inStock: true, unit: '68 keys', variantLabel: 'Color',
    variants: [
      { label: 'Slate', swatch: '#3A4A5A', img: pic('mymart-keyboard-slate') },
      { label: 'Cream', swatch: '#EDE6D6', img: pic('mymart-keyboard-cream') },
    ],
  },
  {
    id: 'p05', name: 'Harvest Cotton Tote', tags: ['accessories', 'apparel'], sub: 'bags',
    priceTHB: 390, inStock: true, unit: '14 L', variantLabel: 'Color',
    variants: [
      { label: 'Natural', swatch: '#E3D8BE', img: pic('mymart-tote-natural') },
      { label: 'Forest',  swatch: '#2F4A3A', img: pic('mymart-tote-forest') },
    ],
  },
  {
    id: 'p06', name: 'Forge 24-piece Driver Kit', tags: ['tools'], sub: 'handtools',
    priceTHB: 690, inStock: false, unit: '24 pcs', variantLabel: 'Finish',
    variants: [
      { label: 'Graphite', swatch: '#2B2B2B', img: pic('mymart-driver-graphite') },
      { label: 'Steel',    swatch: '#9AA3A8', img: pic('mymart-driver-steel') },
    ],
  },
  {
    id: 'p07', name: 'Lumen Smart Desk Lamp', tags: ['electronics', 'home'], sub: 'lighting',
    priceTHB: 1090, inStock: true, unit: '5 W', variantLabel: 'Color',
    variants: [
      { label: 'White', swatch: '#F4F4F4', img: pic('mymart-lamp-white') },
      { label: 'Black', swatch: '#222222', img: pic('mymart-lamp-black') },
    ],
  },
  {
    id: 'p08', name: 'Stovetop Espresso Maker', tags: ['home', 'grocery'], sub: 'kitchen',
    priceTHB: 760, inStock: true, unit: '300 ml', variantLabel: 'Size',
    variants: [
      { label: '3-cup', swatch: '#C8C8C8', img: pic('mymart-moka-3') },
      { label: '6-cup', swatch: '#8A8A8A', img: pic('mymart-moka-6') },
    ],
  },
  {
    id: 'p09', name: 'Trailhead 20L Daypack', tags: ['accessories'], sub: 'bags',
    priceTHB: 1390, inStock: true, unit: '20 L', variantLabel: 'Color',
    variants: [
      { label: 'Black', swatch: '#232323', img: pic('mymart-daypack-black') },
      { label: 'Sand',  swatch: '#C9B79A', img: pic('mymart-daypack-sand') },
      { label: 'Teal',  swatch: '#1F6F6B', img: pic('mymart-daypack-teal') },
    ],
  },
  {
    id: 'p10', name: 'Pulse Fitness Smartwatch', tags: ['electronics', 'accessories'], sub: 'wearables',
    priceTHB: 1990, inStock: true, unit: '1.4 in', variantLabel: 'Color',
    variants: [
      { label: 'Midnight', swatch: '#1B2430', img: pic('mymart-watch-midnight') },
      { label: 'Rose',     swatch: '#D98E8E', img: pic('mymart-watch-rose') },
    ],
  },
  {
    id: 'p11', name: 'Garden Stainless Tool Trio', tags: ['tools', 'home'], sub: 'garden',
    priceTHB: 540, inStock: true, unit: '3 pcs', variantLabel: 'Handle',
    variants: [
      { label: 'Wood', swatch: '#9B6B43', img: pic('mymart-garden-wood') },
      { label: 'Mint', swatch: '#9FCBB2', img: pic('mymart-garden-mint') },
    ],
  },
  {
    id: 'p12', name: 'Everyday Merino Crew Socks (3-pack)', tags: ['apparel'], sub: 'socks',
    priceTHB: 320, inStock: true, unit: '3 pairs', variantLabel: 'Size',
    variants: [
      { label: 'M', swatch: '#D8D8D8', img: pic('mymart-socks-m') },
      { label: 'L', swatch: '#B0B0B0', img: pic('mymart-socks-l') },
    ],
  },
  {
    id: 'p13', name: 'Highland Single-Origin Coffee 250g', tags: ['grocery'], sub: 'coffee',
    priceTHB: 280, inStock: true, unit: '250 g', variantLabel: 'Roast',
    variants: [
      { label: 'Medium', swatch: '#8A5A3B', img: pic('mymart-coffee-medium') },
      { label: 'Dark',   swatch: '#4A2F22', img: pic('mymart-coffee-dark') },
    ],
  },
  {
    id: 'p14', name: 'Cascade Insulated Bottle 750ml', tags: ['accessories', 'home'], sub: 'drinkware',
    priceTHB: 450, inStock: true, unit: '750 ml', variantLabel: 'Color',
    variants: [
      { label: 'Glacier',  swatch: '#BCD6E0', img: pic('mymart-bottle-glacier') },
      { label: 'Coral',    swatch: '#E8765A', img: pic('mymart-bottle-coral') },
      { label: 'Charcoal', swatch: '#333333', img: pic('mymart-bottle-charcoal') },
    ],
  },
  {
    id: 'p15', name: 'Atlas Cordless Drill 18V', tags: ['tools'], sub: 'powertools',
    priceTHB: 2190, inStock: false, unit: '18 V', variantLabel: 'Color',
    variants: [
      { label: 'Yellow', swatch: '#F2B705', img: pic('mymart-drill-yellow') },
      { label: 'Blue',   swatch: '#1F5FA8', img: pic('mymart-drill-blue') },
    ],
  },
  {
    id: 'p16', name: 'Cloud Linen Bedding Set', tags: ['home', 'apparel'], sub: 'bedding',
    priceTHB: 1690, inStock: true, unit: 'Queen', variantLabel: 'Color',
    variants: [
      { label: 'White', swatch: '#F4F1EA', img: pic('mymart-bedding-white') },
      { label: 'Sage',  swatch: '#B7C4A8', img: pic('mymart-bedding-sage') },
      { label: 'Blush', swatch: '#E7C9C2', img: pic('mymart-bedding-blush') },
    ],
  },
  {
    id: 'p17', name: 'Pocket Power Bank 10000mAh', tags: ['electronics'], sub: 'power',
    priceTHB: 590, inStock: true, unit: '10000 mAh', variantLabel: 'Color',
    variants: [
      { label: 'White', swatch: '#F0F0F0', img: pic('mymart-power-white') },
      { label: 'Black', swatch: '#1E1E1E', img: pic('mymart-power-black') },
    ],
  },
  {
    id: 'p18', name: 'Orchard Raw Honey', tags: ['grocery'], sub: 'pantry',
    priceTHB: 350, inStock: true, unit: '500 g', variantLabel: 'Size',
    variants: [
      { label: '500 g', swatch: '#E0A12B', img: pic('mymart-honey-500') },
      { label: '1 kg',  swatch: '#C98A1E', img: pic('mymart-honey-1000') },
    ],
  },
];
