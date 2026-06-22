// Printer settings. Reading (for receipt rendering) needs printers:read;
// creating/editing/deleting needs printers:manage (Owner).
const express = require('express');
const { prisma } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const { PAPER } = require('../receipt/render');
const v = require('../lib/validate');

const router = express.Router();

const PAPER_WIDTHS = Object.keys(PAPER); // ['58mm','80mm','A4']
const TYPES = ['thermal', 'normal'];

function buildData(body, { partial }) {
  const data = {};
  if (!partial || body.name !== undefined) data.name = v.requireString(body.name, 'Name', { max: 80 });
  if (!partial || body.paperWidth !== undefined)
    data.paperWidth = v.oneOf(body.paperWidth || '80mm', 'Paper width', PAPER_WIDTHS);
  if (!partial || body.type !== undefined) data.type = v.oneOf(body.type || 'thermal', 'Type', TYPES);
  if (body.headerText !== undefined) data.headerText = v.optionalString(body.headerText, 'Header text', { max: 400 });
  if (body.footerText !== undefined) data.footerText = v.optionalString(body.footerText, 'Footer text', { max: 400 });
  return data;
}

// Read: anyone who can print.
router.get('/', requireAuth, requirePermission(PERMISSIONS.PRINTERS_READ), async (_req, res, next) => {
  try {
    const printers = await prisma.printerSetting.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({ printers });
  } catch (err) {
    next(err);
  }
});

// Manage: Owner only.
router.use(requireAuth, requirePermission(PERMISSIONS.PRINTERS_MANAGE));

router.post('/', async (req, res, next) => {
  try {
    const data = buildData(req.body, { partial: false });
    const count = await prisma.printerSetting.count();
    data.isDefault = count === 0 || !!req.body.isDefault;
    if (data.isDefault) await prisma.printerSetting.updateMany({ data: { isDefault: false } });
    const printer = await prisma.printerSetting.create({ data });
    res.status(201).json({ printer });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = buildData(req.body, { partial: true });
    if (req.body.isDefault === true) {
      await prisma.printerSetting.updateMany({ data: { isDefault: false } });
      data.isDefault = true;
    }
    const printer = await prisma.printerSetting.update({ where: { id }, data });
    res.json({ printer });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const target = await prisma.printerSetting.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: 'Printer not found.' });
    await prisma.printerSetting.delete({ where: { id } });
    // If we removed the default, promote another one.
    if (target.isDefault) {
      const next = await prisma.printerSetting.findFirst();
      if (next) await prisma.printerSetting.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
