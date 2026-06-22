// PUBLIC storefront feed — the plug-in point for the customer-facing app.
// Returns visible, active products in the EXACT shape the storefront's
// js/data.js uses, so it can later `fetch()` this with zero reshaping.
// No auth, no cost/internal fields.
const express = require('express');
const { prisma } = require('../db');
const { CATEGORIES } = require('../config/categories');
const { serializeStorefrontProduct } = require('../lib/serialize');

const router = express.Router();

router.get('/products', async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { isVisible: true, isActive: true },
      orderBy: { id: 'asc' },
    });
    res.json({ products: products.map(serializeStorefrontProduct) });
  } catch (err) {
    next(err);
  }
});

// Mirrors the storefront CATEGORIES (id + icon) for parity.
router.get('/categories', (_req, res) => {
  res.json({ categories: CATEGORIES.map(({ id, icon }) => ({ id, icon })) });
});

module.exports = router;
