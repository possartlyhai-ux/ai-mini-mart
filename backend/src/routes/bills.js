// POS billing: create a bill (decrement stock + log SALE movements), list
// history with filters, view one, and render a printable receipt.
const express = require('express');
const { prisma } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS, hasPermission } = require('../config/permissions');
const { isCurrency, minorToBaht } = require('../lib/currency');
const { renderReceiptHtml } = require('../receipt/render');
const v = require('../lib/validate');

const router = express.Router();

function serializeBill(b) {
  return {
    id: b.id,
    billNo: b.billNo,
    subtotalMinor: b.subtotalMinor,
    subtotal: minorToBaht(b.subtotalMinor),
    totalMinor: b.totalMinor,
    total: minorToBaht(b.totalMinor),
    currency: b.currency,
    paymentMethod: b.paymentMethod,
    customerName: b.customerName,
    status: b.status,
    staffId: b.staffId,
    staff: b.staff ? { id: b.staff.id, name: b.staff.name, username: b.staff.username } : undefined,
    createdAt: b.createdAt,
    items: b.items?.map((it) => ({
      id: it.id,
      productId: it.productId,
      name: it.nameSnapshot,
      qty: it.qty,
      unitPriceMinor: it.unitPriceMinor,
      unitPrice: minorToBaht(it.unitPriceMinor),
      lineTotalMinor: it.lineTotalMinor,
      lineTotal: minorToBaht(it.lineTotalMinor),
    })),
  };
}

const nextBillNo = (count) => `B-${String(count + 1).padStart(5, '0')}`;

// =============================================================================
// Create a bill (the checkout). Stock is validated + decremented atomically.
// =============================================================================
router.post('/', requireAuth, requirePermission(PERMISSIONS.BILLS_CREATE), async (req, res, next) => {
  try {
    const body = req.body || {};
    const currency = isCurrency(body.currency) ? body.currency : 'THB';
    const paymentMethod = v.oneOf(body.paymentMethod || 'CASH', 'Payment method', ['CASH', 'OTHER']);
    const customerName = v.optionalString(body.customerName, 'Customer name', { max: 120 });

    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw v.badRequest('Add at least one item to the bill.');
    }
    // Collapse duplicate variant lines and validate qty.
    const wanted = new Map();
    for (const raw of body.items) {
      const variantId = v.intNonNeg(raw.variantId, 'Variant');
      const qty = v.intNonNeg(raw.qty, 'Quantity');
      if (qty < 1) throw v.badRequest('Each item needs a quantity of at least 1.');
      wanted.set(variantId, (wanted.get(variantId) || 0) + qty);
    }

    const bill = await prisma.$transaction(async (tx) => {
      const ids = [...wanted.keys()];
      const variants = await tx.variant.findMany({ where: { id: { in: ids } }, include: { product: true } });
      const byId = new Map(variants.map((vr) => [vr.id, vr]));

      const lineData = [];
      let subtotalMinor = 0;
      for (const [variantId, qty] of wanted) {
        const vr = byId.get(variantId);
        if (!vr || !vr.product || !vr.product.isActive) throw v.badRequest(`Variant #${variantId} is unavailable.`);
        const lineTotalMinor = vr.sellPriceMinor * qty;
        subtotalMinor += lineTotalMinor;
        lineData.push({
          productId: vr.productId,
          variantId: vr.id,
          nameSnapshot: `${vr.product.name} — ${vr.name}`,
          qty,
          unitPriceMinor: vr.sellPriceMinor,
          lineTotalMinor,
        });
      }

      const count = await tx.bill.count();
      const created = await tx.bill.create({
        data: {
          billNo: nextBillNo(count),
          subtotalMinor,
          totalMinor: subtotalMinor, // no discounts/tax in v1 (extension point)
          currency,
          paymentMethod,
          customerName,
          status: 'PAID',
          staffId: req.user.id,
          items: { create: lineData },
        },
        include: { items: true, staff: true },
      });
      // Stock is a simple availability switch now — nothing to decrement here.
      return created;
    });

    res.status(201).json({ bill: serializeBill(bill) });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// History list — filter by date range + staff. Staff role is scoped to own.
// =============================================================================
router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!hasPermission(req.user.role, PERMISSIONS.BILLS_READ) &&
        !hasPermission(req.user.role, PERMISSIONS.BILLS_READ_OWN)) {
      return res.status(403).json({ error: 'You do not have permission to view bills.' });
    }
    const where = {};
    const { from, to, staffId } = req.query;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
      if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999`);
    }
    // Staff without the "read all" permission only ever see their own bills.
    if (!hasPermission(req.user.role, PERMISSIONS.BILLS_READ)) {
      where.staffId = req.user.id;
    } else if (staffId) {
      where.staffId = Number(staffId);
    }

    const bills = await prisma.bill.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { staff: { select: { id: true, name: true, username: true } }, items: true },
    });
    res.json({ bills: bills.map(serializeBill) });
  } catch (err) {
    next(err);
  }
});

async function loadBillForRequest(req) {
  const bill = await prisma.bill.findUnique({
    where: { id: Number(req.params.id) },
    include: { items: true, staff: true },
  });
  if (!bill) return { error: 404 };
  // Staff scoped to own bills.
  if (!hasPermission(req.user.role, PERMISSIONS.BILLS_READ) && bill.staffId !== req.user.id) {
    return { error: 403 };
  }
  return { bill };
}

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { bill, error } = await loadBillForRequest(req);
    if (error === 404) return res.status(404).json({ error: 'Bill not found.' });
    if (error === 403) return res.status(403).json({ error: 'You can only view your own bills.' });
    res.json({ bill: serializeBill(bill) });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Owner: disable/enable a bill (toggle PAID <-> VOID). VOID bills are excluded
// from Reports (reports query filters status:'PAID'), but stay in history.
// =============================================================================
router.patch('/:id/status', requireAuth, requirePermission(PERMISSIONS.BILLS_MANAGE), async (req, res, next) => {
  try {
    const status = v.oneOf(req.body.status, 'Status', ['PAID', 'VOID']);
    const bill = await prisma.bill.update({
      where: { id: Number(req.params.id) },
      data: { status },
      include: { items: true, staff: true },
    });
    res.json({ bill: serializeBill(bill) });
  } catch (err) {
    next(err);
  }
});

// Owner: hard-delete a bill (and its line items). Use disable instead to keep
// history; delete is for mistakes/test data.
router.delete('/:id', requireAuth, requirePermission(PERMISSIONS.BILLS_MANAGE), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.$transaction([
      prisma.billItem.deleteMany({ where: { billId: id } }),
      prisma.bill.delete({ where: { id } }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Printable receipt (HTML) — sized to the default printer; opens print dialog.
router.get('/:id/receipt', requireAuth, requirePermission(PERMISSIONS.PRINTERS_READ), async (req, res, next) => {
  try {
    const { bill, error } = await loadBillForRequest(req);
    if (error === 404) return res.status(404).send('Bill not found.');
    if (error === 403) return res.status(403).send('You can only print your own bills.');
    const printer =
      (await prisma.printerSetting.findFirst({ where: { isDefault: true } })) ||
      (await prisma.printerSetting.findFirst());
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderReceiptHtml(bill, printer, { autoPrint: req.query.print === '1' }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
