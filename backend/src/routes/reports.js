// Sales reports: summary + grouped buckets (day/week/month) + top products.
// All amounts are computed in THB minor units; the response also includes a
// `display` string in the requested currency. The query/aggregation layer is
// kept separate from formatting so charts can attach to the raw buckets later.
const express = require('express');
const { prisma } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/permissions');
const { isCurrency, formatMinor, minorToBaht } = require('../lib/currency');

const router = express.Router();

// Default window per period when from/to are not supplied (ending today).
function defaultRange(period) {
  const to = new Date();
  const from = new Date(to);
  if (period === 'day') from.setDate(from.getDate() - 13); // last 14 days
  else if (period === 'week') from.setDate(from.getDate() - 7 * 11); // last 12 weeks
  else from.setMonth(from.getMonth() - 11); // last 12 months
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

// Bucket key for a date given the grouping period (local time).
function bucketKey(date, period) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (period === 'month') return `${y}-${m}`;
  if (period === 'week') {
    // ISO-ish week: Monday-start, label by that Monday's date.
    const monday = new Date(d);
    const dow = (monday.getDay() + 6) % 7; // 0 = Monday
    monday.setDate(monday.getDate() - dow);
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(
      monday.getDate()
    ).padStart(2, '0')}`;
  }
  return `${y}-${m}-${day}`;
}

router.get('/', requireAuth, requirePermission(PERMISSIONS.REPORTS_READ), async (req, res, next) => {
  try {
    const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'day';
    const currency = isCurrency(req.query.currency) ? req.query.currency : 'THB';

    let from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : null;
    let to = req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : null;
    if (!from || !to) {
      const d = defaultRange(period);
      from = from || d.from;
      to = to || d.to;
    }

    const bills = await prisma.bill.findMany({
      where: { status: 'PAID', createdAt: { gte: from, lte: to } },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });

    // ---- aggregate ----
    let totalMinor = 0;
    let itemsSold = 0;
    const buckets = new Map();
    const topMap = new Map();

    for (const b of bills) {
      totalMinor += b.totalMinor;
      const key = bucketKey(b.createdAt, period);
      const bk = buckets.get(key) || { bucket: key, billCount: 0, itemsSold: 0, salesMinor: 0 };
      bk.billCount += 1;
      bk.salesMinor += b.totalMinor;
      for (const it of b.items) {
        itemsSold += it.qty;
        bk.itemsSold += it.qty;
        const t = topMap.get(it.productId ?? it.nameSnapshot) || {
          productId: it.productId,
          name: it.nameSnapshot,
          qty: 0,
          salesMinor: 0,
        };
        t.qty += it.qty;
        t.salesMinor += it.lineTotalMinor;
        topMap.set(it.productId ?? it.nameSnapshot, t);
      }
      buckets.set(key, bk);
    }

    const bucketList = [...buckets.values()]
      .sort((a, b) => (a.bucket < b.bucket ? -1 : 1))
      .map((b) => ({ ...b, sales: minorToBaht(b.salesMinor), salesDisplay: formatMinor(b.salesMinor, currency) }));

    const topProducts = [...topMap.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10)
      .map((t) => ({ ...t, sales: minorToBaht(t.salesMinor), salesDisplay: formatMinor(t.salesMinor, currency) }));

    res.json({
      period,
      currency,
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        billCount: bills.length,
        itemsSold,
        totalMinor,
        total: minorToBaht(totalMinor),
        totalDisplay: formatMinor(totalMinor, currency),
        averageBillDisplay: formatMinor(bills.length ? Math.round(totalMinor / bills.length) : 0, currency),
      },
      buckets: bucketList,
      topProducts,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
