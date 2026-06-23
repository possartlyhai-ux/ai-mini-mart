// Editable storefront categories. Staff with `categories:manage` (Owner) can
// add / rename / re-icon / reorder / remove them; everyone with `products:read`
// can list them (the product form + filters need the list). Deleting a category
// just removes the row — products keep any stale slug in tagsJson, which is
// simply ignored by the category filter.
const express = require('express');
const { prisma } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const v = require('../lib/validate');

const router = express.Router();

// "Fresh Produce!" -> "fresh-produce"
function slugify(label) {
  return String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function serializeCategory(c) {
  return { id: c.id, slug: c.slug, label: c.label, icon: c.icon, imageUrl: c.imageUrl || null, sortOrder: c.sortOrder };
}

// List — anyone who can read products (used by the product form + filters).
router.get('/', requireAuth, requirePermission(PERMISSIONS.PRODUCTS_READ), async (_req, res, next) => {
  try {
    const cats = await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
    res.json({ categories: cats.map(serializeCategory) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requirePermission(PERMISSIONS.CATEGORIES_MANAGE), async (req, res, next) => {
  try {
    const label = v.requireString(req.body.label, 'Label', { max: 60 });
    const slug = req.body.slug ? slugify(req.body.slug) : slugify(label);
    if (!slug) throw v.badRequest('Could not derive a slug from that label.');
    const icon = v.optionalString(req.body.icon, 'Icon', { max: 8 });
    const imageUrl = v.optionalString(req.body.imageUrl, 'Banner image', { max: 600 });
    const max = await prisma.category.aggregate({ _max: { sortOrder: true } });
    const sortOrder =
      req.body.sortOrder !== undefined
        ? v.intNonNeg(req.body.sortOrder, 'Sort order')
        : (max._max.sortOrder ?? -1) + 1;
    const category = await prisma.category.create({ data: { slug, label, icon, imageUrl, sortOrder } });
    res.status(201).json({ category: serializeCategory(category) });
  } catch (err) {
    next(translateUnique(err));
  }
});

// Drag-to-reorder: the body's `order` array of ids becomes sortOrder 0..n.
// Declared BEFORE '/:id' so Express doesn't match "reorder" as an id.
router.patch('/reorder', requireAuth, requirePermission(PERMISSIONS.CATEGORIES_MANAGE), async (req, res, next) => {
  try {
    const order = Array.isArray(req.body.order) ? req.body.order : null;
    if (!order || !order.length) throw v.badRequest('Provide an "order" array of category ids.');
    const ids = order.map((id) => v.intNonNeg(id, 'Category id'));
    await prisma.$transaction(
      ids.map((id, index) => prisma.category.update({ where: { id }, data: { sortOrder: index } }))
    );
    res.json({ ok: true, count: ids.length });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, requirePermission(PERMISSIONS.CATEGORIES_MANAGE), async (req, res, next) => {
  try {
    const data = {};
    if (req.body.label !== undefined) data.label = v.requireString(req.body.label, 'Label', { max: 60 });
    if (req.body.slug !== undefined) {
      const slug = slugify(req.body.slug);
      if (!slug) throw v.badRequest('Slug cannot be empty.');
      data.slug = slug;
    }
    if (req.body.icon !== undefined) data.icon = v.optionalString(req.body.icon, 'Icon', { max: 8 });
    if (req.body.imageUrl !== undefined) data.imageUrl = v.optionalString(req.body.imageUrl, 'Banner image', { max: 600 });
    if (req.body.sortOrder !== undefined) data.sortOrder = v.intNonNeg(req.body.sortOrder, 'Sort order');
    const category = await prisma.category.update({ where: { id: Number(req.params.id) }, data });
    res.json({ category: serializeCategory(category) });
  } catch (err) {
    next(translateUnique(err));
  }
});

router.delete('/:id', requireAuth, requirePermission(PERMISSIONS.CATEGORIES_MANAGE), async (req, res, next) => {
  try {
    await prisma.category.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function translateUnique(err) {
  if (err?.code === 'P2002') return v.badRequest('A category with that slug already exists.');
  return err;
}

module.exports = router;
