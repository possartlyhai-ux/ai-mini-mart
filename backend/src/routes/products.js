// Inventory: products (grouping) + their variants (sellable SKUs). Each variant
// carries its own price/barcode/image/stock. Also: image upload, variant-barcode
// lookup for the POS, product reorder, and the "Show in store" toggle.
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { prisma } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const { serializeProduct, serializeVariant } = require('../lib/serialize');
const { bahtToMinor } = require('../lib/currency');
const v = require('../lib/validate');

// Live category slugs (DB is the source of truth) — used to validate product tags.
async function categorySlugs() {
  const cats = await prisma.category.findMany({ select: { slug: true } });
  return cats.map((c) => c.slug);
}

// Live subcategory slugs — used to validate a product's `sub`.
async function subcategorySlugs() {
  const subs = await prisma.subcategory.findMany({ select: { slug: true } });
  return subs.map((s) => s.slug);
}

const router = express.Router();
const withVariants = { variants: { orderBy: { sortOrder: 'asc' } } };

// ---- image upload -----------------------------------------------------------
// Files are held in memory, then pushed to Cloudinary (durable, when
// CLOUDINARY_URL is set) or written to the local /uploads dir (dev fallback).
// Render's free disk is ephemeral, so durable uploads require Cloudinary in prod.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// Cloudinary auto-configures from the CLOUDINARY_URL env var when present.
const cloudinary = require('cloudinary').v2;
const CLOUDINARY_ON = !!cloudinary.config().cloud_name;

// Persist one uploaded file, returning its URL. Cloudinary => absolute https URL
// (works cross-origin on the storefront); local fallback => relative /uploads path.
function storeImage(file) {
  if (CLOUDINARY_ON) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'ai-mini-mart', resource_type: 'image' },
        (err, result) => (err ? reject(err) : resolve(result.secure_url))
      );
      stream.end(file.buffer);
    });
  }
  const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.img';
  const name = `p_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return Promise.resolve(`/uploads/${name}`);
}

// ---- helpers ----------------------------------------------------------------
function parseTags(value, allowedSlugs) {
  let arr = value;
  if (typeof value === 'string') {
    try {
      arr = JSON.parse(value);
    } catch {
      arr = value.split(',').map((s) => s.trim());
    }
  }
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter((t) => allowedSlugs.includes(t)))];
}

// Product-only fields (name, unit "Type", categories, subcategory, visibility, order).
function buildProductData(body, { partial, allowedSlugs, allowedSubs }) {
  const data = {};
  if (!partial || body.name !== undefined) data.name = v.requireString(body.name, 'Name', { max: 160 });
  if (body.sku !== undefined) data.sku = v.optionalString(body.sku, 'SKU', { max: 64 });
  if (body.unit !== undefined) data.unit = v.optionalString(body.unit, 'Type / unit', { max: 60 });
  if (body.sortOrder !== undefined) data.sortOrder = v.intNonNeg(body.sortOrder, 'Sort order');
  if (body.isVisible !== undefined) data.isVisible = !!body.isVisible;
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  if (body.tags !== undefined) data.tagsJson = JSON.stringify(parseTags(body.tags, allowedSlugs || []));
  // sub: a single subcategory slug; unknown/blank -> null (stale slugs are ignored downstream).
  if (body.sub !== undefined) {
    const sub = v.optionalString(body.sub, 'Subcategory', { max: 80 });
    data.sub = sub && (allowedSubs || []).includes(sub) ? sub : null;
  }
  return data;
}

// Validate + normalize the variants payload. Each row owns name/barcode/image/
// price (THB + KHR)/in-stock. Throws if there isn't at least one variant.
function buildVariants(value) {
  let arr = value;
  if (typeof value === 'string') {
    try {
      arr = JSON.parse(value);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) throw v.badRequest('A product needs at least one variant.');
  return arr.map((x, idx) => ({
    id: x.id != null && x.id !== '' ? Number(x.id) : undefined,
    name: v.requireString(x.name, 'Variant name', { max: 120 }),
    barcode: v.optionalString(x.barcode, 'Variant barcode', { max: 64 }),
    imageUrl: v.optionalString(x.imageUrl, 'Variant image', { max: 600 }),
    sellPriceMinor: bahtToMinor(v.moneyBaht(x.sellPrice ?? 0, 'Variant price (THB)')),
    sellPriceKhr: v.intNonNeg(x.sellPriceKhr ?? 0, 'Variant price (KHR)'),
    inStock: x.inStock === undefined ? true : !!x.inStock,
    sortOrder: idx,
  }));
}

// Create/update/delete a product's variants to match the payload, inside a tx.
async function applyVariants(tx, productId, clean) {
  const existing = await tx.variant.findMany({ where: { productId }, select: { id: true } });
  const existingIds = new Set(existing.map((e) => e.id));
  const keep = new Set();
  for (const c of clean) {
    const data = {
      name: c.name,
      barcode: c.barcode,
      imageUrl: c.imageUrl,
      sellPriceMinor: c.sellPriceMinor,
      sellPriceKhr: c.sellPriceKhr,
      inStock: c.inStock,
      sortOrder: c.sortOrder,
    };
    if (c.id && existingIds.has(c.id)) {
      await tx.variant.update({ where: { id: c.id }, data });
      keep.add(c.id);
    } else {
      await tx.variant.create({ data: { ...data, productId } });
    }
  }
  const toDelete = [...existingIds].filter((id) => !keep.has(id));
  if (toDelete.length) await tx.variant.deleteMany({ where: { id: { in: toDelete } } });
}

// =============================================================================
// Lookup (POS) — by variant barcode, then product SKU. Before "/:id".
// =============================================================================
router.get('/lookup', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_READ), async (req, res, next) => {
  try {
    const code = v.requireString(req.query.code, 'Code', { max: 64 });
    const variant = await prisma.variant.findFirst({
      where: { barcode: code, product: { isActive: true } },
      include: { product: { include: withVariants } },
    });
    if (variant) {
      return res.json({ product: serializeProduct(variant.product), variant: serializeVariant(variant) });
    }
    // Fall back to a product SKU -> return it with its first variant as the default.
    const product = await prisma.product.findFirst({
      where: { isActive: true, sku: code },
      include: withVariants,
    });
    if (product && product.variants.length) {
      return res.json({ product: serializeProduct(product), variant: serializeVariant(product.variants[0]) });
    }
    res.status(404).json({ error: `No product found for "${code}".` });
  } catch (err) {
    next(err);
  }
});

// Generic image upload — stores the file and returns its URL (not attached to a
// row). The product form uses this for each variant image. Before "/:id".
router.post(
  '/upload-image',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_WRITE),
  upload.single('image'),
  async (req, res, next) => {
    try {
      if (!req.file) throw v.badRequest('No image file received.');
      const imageUrl = await storeImage(req.file);
      res.json({ imageUrl });
    } catch (err) {
      next(err);
    }
  }
);

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
        { variants: { some: { barcode: { contains: String(search) } } } },
        { variants: { some: { name: { contains: String(search) } } } },
      ];
    }
    let products = (
      await prisma.product.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: withVariants,
      })
    ).map(serializeProduct);

    if (category) products = products.filter((p) => p.tags.includes(String(category)));
    if (stock === 'in') products = products.filter((p) => p.inStock);
    else if (stock === 'out') products = products.filter((p) => !p.inStock);

    res.json({ products });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Reorder — set storefront display order. Before "/:id".
// Body: { order: [id, id, ...] } in the desired top-to-bottom order.
// =============================================================================
router.patch('/reorder', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_WRITE), async (req, res, next) => {
  try {
    const order = Array.isArray(req.body.order) ? req.body.order : null;
    if (!order || !order.length) throw v.badRequest('Provide an "order" array of product ids.');
    const ids = order.map((id) => v.intNonNeg(id, 'Product id'));
    await prisma.$transaction(
      ids.map((id, index) => prisma.product.update({ where: { id }, data: { sortOrder: index } }))
    );
    res.json({ ok: true, count: ids.length });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_READ), async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) }, include: withVariants });
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: serializeProduct(product) });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Create / Update / Delete
// =============================================================================
router.post('/', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_WRITE), async (req, res, next) => {
  try {
    const [allowedSlugs, allowedSubs] = await Promise.all([categorySlugs(), subcategorySlugs()]);
    const productData = buildProductData(req.body, { partial: false, allowedSlugs, allowedSubs });
    const variants = buildVariants(req.body.variants); // validates >= 1 up front

    if (productData.sortOrder === undefined) {
      const max = await prisma.product.aggregate({ _max: { sortOrder: true } });
      productData.sortOrder = (max._max.sortOrder ?? -1) + 1;
    }

    const product = await prisma.$transaction(async (tx) => {
      let p = await tx.product.create({ data: productData });
      if (!p.sku) {
        p = await tx.product.update({ where: { id: p.id }, data: { sku: `MM-${String(p.id).padStart(3, '0')}` } });
      }
      await applyVariants(tx, p.id, variants);
      return tx.product.findUnique({ where: { id: p.id }, include: withVariants });
    });
    res.status(201).json({ product: serializeProduct(product) });
  } catch (err) {
    next(translateUnique(err));
  }
});

router.patch('/:id', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_WRITE), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [allowedSlugs, allowedSubs] = await Promise.all([categorySlugs(), subcategorySlugs()]);
    const productData = buildProductData(req.body, { partial: true, allowedSlugs, allowedSubs });
    const variants = req.body.variants !== undefined ? buildVariants(req.body.variants) : null;

    const product = await prisma.$transaction(async (tx) => {
      if (Object.keys(productData).length) await tx.product.update({ where: { id }, data: productData });
      if (variants) await applyVariants(tx, id, variants);
      return tx.product.findUnique({ where: { id }, include: withVariants });
    });
    res.json({ product: serializeProduct(product) });
  } catch (err) {
    next(translateUnique(err));
  }
});

// Soft delete by default (keeps bill history intact); ?hard=1 removes the row
// (and cascades its variants) when nothing was ever sold.
router.delete('/:id', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_DELETE), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (req.query.hard === '1') {
      const sales = await prisma.billItem.count({ where: { productId: id } });
      if (sales === 0) {
        await prisma.product.delete({ where: { id } }); // variants cascade
        return res.json({ ok: true, deleted: 'hard' });
      }
    }
    await prisma.product.update({ where: { id }, data: { isActive: false, isVisible: false } });
    res.json({ ok: true, deleted: 'soft' });
  } catch (err) {
    next(err);
  }
});

// Quick per-variant "In stock" toggle.
router.patch('/variants/:vid/stock', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_WRITE), async (req, res, next) => {
  try {
    const variant = await prisma.variant.update({
      where: { id: Number(req.params.vid) },
      data: { inStock: !!req.body.inStock },
    });
    res.json({ variant: serializeVariant(variant) });
  } catch (err) {
    next(err);
  }
});

// Quick "Show in store" toggle (product-level).
router.patch(
  '/:id/visibility',
  requireAuth,
  requirePermission(PERMISSIONS.STOREFRONT_TOGGLE),
  async (req, res, next) => {
    try {
      await prisma.product.update({ where: { id: Number(req.params.id) }, data: { isVisible: !!req.body.isVisible } });
      const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) }, include: withVariants });
      res.json({ product: serializeProduct(product) });
    } catch (err) {
      next(err);
    }
  }
);

// Turn a Prisma unique-constraint error into a friendly 400.
function translateUnique(err) {
  if (err?.code === 'P2002') {
    const field = err.meta?.target?.[0] || 'value';
    if (String(field).includes('barcode')) return v.badRequest('That barcode is already used by another variant.');
    return v.badRequest(`That ${field} is already used.`);
  }
  return err;
}

module.exports = router;
