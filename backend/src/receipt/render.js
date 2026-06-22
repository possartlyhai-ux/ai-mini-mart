// Print-ready HTML receipt, sized to the active PrinterSetting's paper width.
// v1 "printing" = open this in the browser and trigger the print dialog. Real
// ESC/POS / thermal driver integration is a documented extension point.
const { formatMinor } = require('../lib/currency');

const PAPER = {
  '58mm': { width: '58mm', pad: '2mm', font: '11px' },
  '80mm': { width: '80mm', pad: '3mm', font: '12px' },
  A4: { width: '180mm', pad: '12mm', font: '13px' },
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(d) {
  const dt = new Date(d);
  return dt.toLocaleString('en-GB', { hour12: false }).replace(',', '');
}

function renderReceiptHtml(bill, printer, { autoPrint = false } = {}) {
  const paper = PAPER[printer?.paperWidth] || PAPER['80mm'];
  const code = bill.currency || 'THB';
  const header = printer?.headerText || 'Ai Mini-Mart';
  const footer = printer?.footerText || 'Thank you for shopping with Ai Mini-Mart';

  const rows = (bill.items || [])
    .map(
      (it) => `
        <tr>
          <td class="qty">${it.qty}×</td>
          <td class="name">${esc(it.nameSnapshot)}<span class="unit">${formatMinor(it.unitPriceMinor, code)}</span></td>
          <td class="amt">${formatMinor(it.lineTotalMinor, code)}</td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Receipt ${esc(bill.billNo)}</title>
<style>
  @page { size: ${paper.width} auto; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f3f3f3; font-family: "Courier New", ui-monospace, monospace; }
  .sheet {
    width: ${paper.width}; margin: 0 auto; background: #fff; padding: ${paper.pad};
    font-size: ${paper.font}; color: #000; line-height: 1.35;
  }
  .center { text-align: center; }
  .store { font-size: 1.25em; font-weight: 700; }
  .muted { color: #333; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 1px 0; }
  td.qty { width: 12%; }
  td.amt { width: 30%; text-align: right; white-space: nowrap; }
  td.name .unit { display: block; color: #555; font-size: 0.85em; }
  .totals td { padding: 2px 0; }
  .totals .label { text-align: left; }
  .totals .value { text-align: right; font-weight: 700; white-space: nowrap; }
  .grand { font-size: 1.15em; }
  .meta { font-size: 0.9em; }
  @media print { body { background: #fff; } .noprint { display: none; } }
  .noprint { text-align: center; margin: 12px 0; }
  .noprint button { font: inherit; padding: 8px 16px; cursor: pointer; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="center store">${esc(header).split('\n').join('<br/>')}</div>
    <hr />
    <div class="meta">
      <div>Bill: ${esc(bill.billNo)}</div>
      <div>Date: ${esc(fmtDate(bill.createdAt))}</div>
      ${bill.staff ? `<div>Cashier: ${esc(bill.staff.name)}</div>` : ''}
      ${bill.customerName ? `<div>Customer: ${esc(bill.customerName)}</div>` : ''}
    </div>
    <hr />
    <table><tbody>${rows}</tbody></table>
    <hr />
    <table class="totals"><tbody>
      <tr><td class="label">Subtotal</td><td class="value">${formatMinor(bill.subtotalMinor, code)}</td></tr>
      <tr class="grand"><td class="label">TOTAL</td><td class="value">${formatMinor(bill.totalMinor, code)}</td></tr>
      <tr><td class="label muted">Payment</td><td class="value muted">${esc(bill.paymentMethod)}</td></tr>
    </tbody></table>
    <hr />
    <div class="center muted">${esc(footer).split('\n').join('<br/>')}</div>
  </div>
  <div class="noprint"><button onclick="window.print()">Print receipt</button></div>
  ${autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script>' : ''}
</body>
</html>`;
}

module.exports = { renderReceiptHtml, PAPER };
