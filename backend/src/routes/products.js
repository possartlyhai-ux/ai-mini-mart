// Inventory: product CRUD, image upload, stock adjustment + movements,
// barcode/SKU lookup for the POS, and the "Show in store" toggle.
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { prisma } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const { CATEGORY_IDS } = require('../config/categories');
const { serializeProduct } = require('../lib/serialize');
const { bahtToMinor } = require('../lib/currency');
const v = require('../lib/validate');

const router = express.Router();

// ---- image upload (local /uploads) ------------------------------------------
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.img';
    cb(null, `p_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// ---- helpers ----------------------------------------------------------------
function parseTags(value) {
  let arr = value;
  if (typeof value === 'string') {
    try {
      arr = JSON.parse(value);
    } catch {
      arr = value.split(',').map((s) => s.trim());
    }
  }
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter((t) => CATEGORY_IDS.includes(t)))];
}

function parseVariants(value) {
  let arr = value;
  if (typeof value === 'string') {
    try {
      arr = JSON.parse(value);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({
      label: String(x.label || '').trim(),
      swatch: String(x.swatch || '#cccccc').trim(),
      img: String(x.img || '').trim(),
    }))
    .filter((x) => x.label);
}

// Build the create/update payload from a request body (shared by POST/PATCH).
function buildProductData(body, { partial }) {
  const data = {};
  const set = (key, val) => {
    if (val !== undefined) data[key] = val;
  };

  if (!partial || body.name !== undefined) data.name = v.requireString(body.name, 'Name', { max: 160 });
  if (body.sku !== undefined) set('sku', v.optionalString(body.sku, 'SKU', { max: 64 }));
  if (body.barcode !== undefined) set('barcode', v.optionalString(body.barcode, 'Barcode', { max: 64 }));
  if (body.imageUrl !== undefined) set('imageUrl', v.optionalString(body.imageUrl, 'Image URL', { max: 600 }));
  if (body.unit !== undefined) set('unit', v.optionalString(body.unit, 'Unit', { max: 60 }));
  if (body.variantLabel !== undefined)
    set('variantLabel', v.optionalString(body.variantLabel, 'Variant label', { max: 60 }));

  if (!partial || body.sellPrice !== undefined)
    data.sellPriceMinor = bahtToMinor(v.moneyBaht(body.sellPrice, 'Sell price'));
  if (body.costPrice !== undefined) data.costPriceMinor = bahtToMinor(v.moneyBaht(body.costPrice, 'Cost price'));
  if (body.comparePrice !== undefined && body.comparePrice !== null && body.comparePrice !== '')
    data.comparePriceMinor = bahtToMinor(v.moneyBaht(body.comparePrice, 'Compare-at price'));
  else if (body.comparePrice === null || body.comparePrice === '') data.comparePriceMinor = null;

  if (!partial || body.stockQty !== undefined) data.stockQty = v.intNonNeg(body.stockQty ?? 0, 'Stock qty');
  if (body.lowStockThreshold !== undefined)
    data.lowStockThreshold = v.intNonNeg(body.lowStockThreshold, 'Low-stock threshold');
  if (body.isVisible !== undefined) data.isVisible = !!body.isVisible;
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  if (body.tags !== undefined) data.tagsJson = JSON.stringify(parseTags(body.tags));
  if (body.variants !== undefined) data.variantsJson = JSON.stringify(parseVariants(body.variants));

  return data;
}

// =============================================================================
// Lookup (POS) — by barcode or SKU. MUST be declared before "/:id".
// =============================================================================
router.get('/lookup', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_READ), async (req, res, next) => {
  try {
    const code = v.requireString(req.query.code, 'Code', { max: 64 });
    const product = await prisma.product.findFirst({
      where: { isActive: true, OR: [{ barcode: code }, { sku: code }] },
    });
    if (!product) return res.status(404).json({ error: `No product found for "${code}".` });
    res.json({ product: serializeProduct(product, req.user.role) });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// List — search / category / stock filters.
// =============================================================================
router.get('/', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_READ), async (req, res, next) => {
  try {
    const { search, category, stock, includeInactive } = req.query;
    const where = {};
    if (includeInactive !== '1') where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: String(search) } },
        { sku: { contains: String(search) } },
        { barcode: { contains: String(search) } },
      ];
    }
    let products = await prisma.product.findMany({ where, orderBy: { name: 'asc' } });

    // tags + stock status are derived; filter in app layer (catalog is tiny).
    if (category) {
      products = products.filter((p) => {
        try {
          return JSON.parse(p.tagsJson).includes(String(category));
        } catch {
          return false;
        }
      });
    }
    if (stock === 'in') products = products.filter((p) => p.stockQty > p.lowStockThreshold);
    else if (stock === 'low') products = products.filter((p) => p.stockQty > 0 && p.stockQty <= p.lowStockThreshold);
    else if (stock === 'out') products = products.filter((p) => p.stockQty <= 0);

    res.json({ products: products.map((p) => serializeProduct(p, req.user.role)) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_READ), async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) } });
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: serializeProduct(product, req.user.role) });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Create / Update / Delete
// =============================================================================
router.post('/', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_WRITE), async (req, res, next) => {
  try {
    const data = buildProductData(req.body, { partial: false });
    const product = await prisma.product.create({ data });
    res.status(201).json({ product: serializeProduct(product, req.user.role) });
  } catch (err) {
    next(translateUnique(err));
  }
});

router.patch('/:id', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_WRITE), async (req, res, next) => {
  try {
    const data = buildProductData(req.body, { partial: true });
    const product = await prisma.product.update({ where: { id: Number(req.params.id) }, data });
    res.json({ product: serializeProduct(product, req.user.role) });
  } catch (err) {
    next(translateUnique(err));
  }
});

// Soft delete by default (keeps bill history intact); ?hard=1 removes the row
// when it has never been sold.
router.delete('/:id', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_DELETE), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (req.query.hard === '1') {
      const sales = await prisma.billItem.count({ where: { productId: id } });
      if (sales === 0) {
        await prisma.stockMovement.deleteMany({ where: { productId: id } });
        await prisma.product.delete({ where: { id } });
        return res.json({ ok: true, deleted: 'hard' });
      }
    }
    await prisma.product.update({ where: { id }, data: { isActive: false, isVisible: false } });
    res.json({ ok: true, deleted: 'soft' });
  } catch (err) {
    next(err);
  }
});

// Quick "Show in store" toggle.
router.patch(
  '/:id/visibility',
  requireAuth,
  requirePermission(PERMISSIONS.STOREFRONT_TOGGLE),
  async (req, res, next) => {
    try {
      const product = await prisma.product.update({
        where: { id: Number(req.params.id) },
        data: { isVisible: !!req.body.isVisible },
      });
      res.json({ product: serializeProduct(product, req.user.role) });
    } catch (err) {
      next(err);
    }
  }
);

// =============================================================================
// Image upload
// =============================================================================
router.post(
  '/:id/image',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_WRITE),
  upload.single('image'),
  async (req, res, next) => {
    try {
      if (!req.file) throw v.badRequest('No image file received.');
      const imageUrl = `/uploads/${req.file.filename}`;
      const product = await prisma.product.update({
        where: { id: Number(req.params.id) },
        data: { imageUrl },
      });
      res.json({ product: serializeProduct(product, req.user.role), imageUrl });
    } catch (err) {
      next(err);
    }
  }
);

// =============================================================================
// Stock adjustment + movement log
// =============================================================================
router.post('/:id/stock', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_WRITE), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const type = v.oneOf(req.body.type || 'ADJUST', 'Type', ['IN', 'OUT', 'ADJUST']);
    const reason = v.optionalString(req.body.reason, 'Reason', { max: 200 });

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw v.badRequest('Product not found.');

    // delta is signed: IN adds, OUT removes, ADJUST sets the qty to a target.
    let delta;
    if (type === 'ADJUST') {
      const target = v.intNonNeg(req.body.qty, 'Target quantity');
      delta = target - product.stockQty;
    } else {
      const amount = v.intNonNeg(req.body.qty, 'Quantity');
      delta = type === 'IN' ? amount : -amount;
    }
    const newQty = product.stockQty + delta;
    if (newQty < 0) throw v.badRequest('That would drop stock below zero.');

    const [updated] = await prisma.$transaction([
      prisma.product.update({ where: { id }, data: { stockQty: newQty } }),
      prisma.stockMovement.create({
        data: { productId: id, type, qty: delta, reason, staffId: req.user.id },
      }),
    ]);
    res.json({ product: serializeProduct(updated, req.user.role) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/movements', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_READ), async (req, res, next) => {
  try {
    const movements = await prisma.stockMovement.findMany({
      where: { productId: Number(req.params.id) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { staff: { select: { name: true, username: true } } },
    });
    res.json({ movements });
  } catch (err) {
    next(err);
  }
});

// Turn a Prisma unique-constraint error into a friendly 400.
function translateUnique(err) {
  if (err?.code === 'P2002') {
    const field = err.meta?.target?.[0] || 'value';
    return v.badRequest(`That ${field} is already used by another product.`);
  }
  return err;
}

module.exports = router;
