// Shapes DB rows into API responses. Centralises two things:
//  1. JSON column parsing (tagsJson / variantsJson).
//  2. Field-level RBAC: cost price + profit are stripped unless the caller holds
//     `products:cost` — enforced here, not just hidden in the UI.
const { PERMISSIONS, hasPermission } = require('../config/permissions');
const { minorToBaht } = require('./currency');

function parseJson(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function stockStatus(p) {
  if (p.stockQty <= 0) return 'out';
  if (p.stockQty <= p.lowStockThreshold) return 'low';
  return 'in';
}

// Full admin/POS view of a product. Cost fields included only with permission.
function serializeProduct(p, role) {
  const canCost = role && hasPermission(role, PERMISSIONS.PRODUCTS_COST);
  const out = {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    imageUrl: p.imageUrl,
    sellPriceMinor: p.sellPriceMinor,
    sellPrice: minorToBaht(p.sellPriceMinor),
    comparePriceMinor: p.comparePriceMinor,
    comparePrice: p.comparePriceMinor != null ? minorToBaht(p.comparePriceMinor) : null,
    stockQty: p.stockQty,
    lowStockThreshold: p.lowStockThreshold,
    stockStatus: stockStatus(p),
    isVisible: p.isVisible,
    isActive: p.isActive,
    unit: p.unit,
    variantLabel: p.variantLabel,
    variants: parseJson(p.variantsJson, []),
    tags: parseJson(p.tagsJson, []),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  if (canCost) {
    out.costPriceMinor = p.costPriceMinor;
    out.costPrice = minorToBaht(p.costPriceMinor);
    out.marginMinor = p.sellPriceMinor - p.costPriceMinor;
  }
  return out;
}

// Exact storefront shape (matches js/data.js). No internal/cost fields.
function serializeStorefrontProduct(p) {
  const out = {
    id: p.sku || `db-${p.id}`, // stable public id; falls back to db id
    name: p.name,
    tags: parseJson(p.tagsJson, []),
    priceTHB: minorToBaht(p.sellPriceMinor),
    inStock: p.stockQty > 0,
    unit: p.unit || undefined,
    variantLabel: p.variantLabel || undefined,
    variants: parseJson(p.variantsJson, []),
  };
  if (p.comparePriceMinor != null) out.wasTHB = minorToBaht(p.comparePriceMinor);
  return out;
}

module.exports = { parseJson, stockStatus, serializeProduct, serializeStorefrontProduct };
