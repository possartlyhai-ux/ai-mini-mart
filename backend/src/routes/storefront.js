// PUBLIC storefront feed — the plug-in point for the customer-facing app.
// Returns visible, active products in the EXACT shape the storefront's
// js/data.js uses, so it can later `fetch()` this with zero reshaping.
// No auth, no cost/internal fields.
const express = require('express');
const { prisma } = require('../db');
const { serializeStorefrontProduct } = require('../lib/serialize');

const router = express.Router();

router.get('/products', async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { isVisible: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { variants: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json({ products: products.map(serializeStorefrontProduct) });
  } catch (err) {
    next(err);
  }
});

// Storefront categories (id = slug + icon), in display order. DB-backed so they
// stay in sync with what staff manage in the admin.
router.get('/categories', async (_req, res, next) => {
  try {
    const cats = await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
    res.json({ categories: cats.map((c) => ({ id: c.slug, icon: c.icon || undefined, banner: c.imageUrl || undefined })) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
