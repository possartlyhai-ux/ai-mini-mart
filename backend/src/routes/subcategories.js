// Editable storefront subcategories. Each lives under one Category and is
// referenced by products via Product.sub (a single slug). Staff with
// `categories:manage` (Owner) can add / rename / reorder / remove them; the list
// rides along with GET /api/categories (each category carries `subcategories`),
// so there's no separate list endpoint here. Deleting a subcategory just removes
// the row — products keep any stale `sub` slug, which the sub filter ignores.
const express = require('express');
const { prisma } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const v = require('../lib/validate');

const router = express.Router();

// "Hand Tools!" -> "hand-tools"
function slugify(label) {
  return String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function serialize(s) {
  return { id: s.id, categoryId: s.categoryId, slug: s.slug, label: s.label, sortOrder: s.sortOrder };
}

// Create under a category. Body: { categoryId, label, slug? }.
router.post('/', requireAuth, requirePermission(PERMISSIONS.CATEGORIES_MANAGE), async (req, res, next) => {
  try {
    const categoryId = v.intNonNeg(req.body.categoryId, 'Category id');
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw v.badRequest('That category does not exist.');
    const label = v.requireString(req.body.label, 'Label', { max: 60 });
    const slug = req.body.slug ? slugify(req.body.slug) : slugify(label);
    if (!slug) throw v.badRequest('Could not derive a slug from that label.');
    const max = await prisma.subcategory.aggregate({ where: { categoryId }, _max: { sortOrder: true } });
    const sortOrder =
      req.body.sortOrder !== undefined
        ? v.intNonNeg(req.body.sortOrder, 'Sort order')
        : (max._max.sortOrder ?? -1) + 1;
    const sub = await prisma.subcategory.create({ data: { categoryId, slug, label, sortOrder } });
    res.status(201).json({ subcategory: serialize(sub) });
  } catch (err) {
    next(translateUnique(err));
  }
});

// Drag-to-reorder within a category. Body: { order: [id, ...] }. Before '/:id'.
router.patch('/reorder', requireAuth, requirePermission(PERMISSIONS.CATEGORIES_MANAGE), async (req, res, next) => {
  try {
    const order = Array.isArray(req.body.order) ? req.body.order : null;
    if (!order || !order.length) throw v.badRequest('Provide an "order" array of subcategory ids.');
    const ids = order.map((id) => v.intNonNeg(id, 'Subcategory id'));
    await prisma.$transaction(
      ids.map((id, index) => prisma.subcategory.update({ where: { id }, data: { sortOrder: index } }))
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
    if (req.body.sortOrder !== undefined) data.sortOrder = v.intNonNeg(req.body.sortOrder, 'Sort order');
    if (req.body.categoryId !== undefined) {
      const categoryId = v.intNonNeg(req.body.categoryId, 'Category id');
      const category = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!category) throw v.badRequest('That category does not exist.');
      data.categoryId = categoryId;
    }
    const sub = await prisma.subcategory.update({ where: { id: Number(req.params.id) }, data });
    res.json({ subcategory: serialize(sub) });
  } catch (err) {
    next(translateUnique(err));
  }
});

router.delete('/:id', requireAuth, requirePermission(PERMISSIONS.CATEGORIES_MANAGE), async (req, res, next) => {
  try {
    await prisma.subcategory.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function translateUnique(err) {
  if (err?.code === 'P2002') return v.badRequest('A subcategory with that slug already exists.');
  return err;
}

module.exports = router;
