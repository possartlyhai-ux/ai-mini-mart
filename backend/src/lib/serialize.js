// Shapes DB rows into API responses.
//   - Product is a grouping; its sellable SKUs are its Variants.
//   - A Variant carries price (THB + storefront KHR), barcode, image, in-stock.
//   - tagsJson (category slugs) is parsed here.
const { minorToBaht } = require('./currency');

function parseJson(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function bySortOrder(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

// A sellable SKU.
function serializeVariant(v) {
  return {
    id: v.id,
    name: v.name,
    barcode: v.barcode,
    imageUrl: v.imageUrl,
    sellPriceMinor: v.sellPriceMinor,
    sellPrice: minorToBaht(v.sellPriceMinor),
    sellPriceKhr: v.sellPriceKhr,
    inStock: v.inStock,
    sortOrder: v.sortOrder,
  };
}

// Full admin/POS view of a product (expects `p.variants` included).
function serializeProduct(p) {
  const variants = (p.variants || []).slice().sort(bySortOrder).map(serializeVariant);
  const prices = variants.map((v) => v.sellPriceMinor);
  const fromMinor = prices.length ? Math.min(...prices) : 0;
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    unit: p.unit, // "Type"
    tags: parseJson(p.tagsJson, []),
    sortOrder: p.sortOrder,
    isVisible: p.isVisible,
    isActive: p.isActive,
    variants,
    // derived, for the list view:
    imageUrl: variants[0] ? variants[0].imageUrl : null,
    inStock: variants.some((v) => v.inStock),
    priceFromMinor: fromMinor,
    priceFrom: minorToBaht(fromMinor),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// Storefront shape (matches js/data.js, extended with per-variant prices). The
// top-level price mirrors the first variant for backward compatibility; the
// storefront can read per-variant prices from `variants`.
function serializeStorefrontProduct(p) {
  const variants = (p.variants || []).slice().sort(bySortOrder);
  const first = variants[0] || {};
  return {
    id: p.sku || `db-${p.id}`, // stable public id; falls back to db id
    name: p.name,
    tags: parseJson(p.tagsJson, []),
    unit: p.unit || undefined,
    inStock: variants.some((v) => v.inStock),
    priceTHB: minorToBaht(first.sellPriceMinor || 0),
    priceKHR: first.sellPriceKhr || 0,
    variants: variants.map((v) => ({
      label: v.name,
      img: v.imageUrl || undefined,
      priceTHB: minorToBaht(v.sellPriceMinor),
      priceKHR: v.sellPriceKhr,
      inStock: v.inStock,
      barcode: v.barcode || undefined,
    })),
  };
}

module.exports = { parseJson, serializeVariant, serializeProduct, serializeStorefrontProduct };
