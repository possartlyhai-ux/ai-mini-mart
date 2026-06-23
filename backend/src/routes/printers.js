// Printer settings. Reading (for receipt rendering) needs printers:read;
// creating/editing/deleting needs printers:manage (Owner).
const express = require('express');
const { prisma } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const { PAPER, renderReceiptHtml } = require('../receipt/render');
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
  if (body.logoUrl !== undefined) data.logoUrl = v.optionalString(body.logoUrl, 'Logo URL', { max: 600 });
  if (body.layoutJson !== undefined) {
    // Accept an object or a JSON string; store as a compact JSON string.
    const raw = typeof body.layoutJson === 'string' ? body.layoutJson : JSON.stringify(body.layoutJson);
    if (raw && raw.length > 4000) throw v.badRequest('Receipt layout is too large.');
    try {
      data.layoutJson = raw ? JSON.stringify(JSON.parse(raw)) : null;
    } catch {
      throw v.badRequest('Receipt layout is not valid JSON.');
    }
  }
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

// Test print: render a sample receipt with THIS printer's layout so the owner
// can preview/print before saving real bills. Anyone who can print (printers:read).
router.get('/:id/test', requireAuth, requirePermission(PERMISSIONS.PRINTERS_READ), async (req, res, next) => {
  try {
    const printer = await prisma.printerSetting.findUnique({ where: { id: Number(req.params.id) } });
    if (!printer) return res.status(404).send('Printer not found.');
    const sample = {
      billNo: 'TEST-0001',
      currency: 'KHR',
      createdAt: new Date(),
      paymentMethod: 'CASH',
      customerName: 'Walk-in',
      staff: { name: req.user?.name || 'Staff' },
      items: [
        { qty: 2, nameSnapshot: 'Sample Product — Regular', unitPriceMinor: 12000, lineTotalMinor: 24000 },
        { qty: 1, nameSnapshot: 'Another Item — Large', unitPriceMinor: 5500, lineTotalMinor: 5500 },
      ],
      subtotalMinor: 29500,
      totalMinor: 29500,
    };
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderReceiptHtml(sample, printer, { autoPrint: req.query.print === '1' }));
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
