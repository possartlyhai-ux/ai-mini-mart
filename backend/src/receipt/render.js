// Print-ready HTML receipt, sized to the active PrinterSetting's paper width.
// The layout is customizable per printer (PrinterSetting.layoutJson): each block
// (logo, mart name, date/time, item descriptions, caption, order-number barcode)
// can be enabled/disabled and reordered. v1 "printing" = open this in the browser
// and trigger the print dialog; ESC/POS is a documented extension point.
const { formatMinor } = require('../lib/currency');

const PAPER = {
  '58mm': { width: '58mm', pad: '2mm', font: '11px' },
  '80mm': { width: '80mm', pad: '3mm', font: '12px' },
  A4: { width: '180mm', pad: '12mm', font: '13px' },
};

// Default receipt layout — block order + which are on. Used when a printer has no
// saved layoutJson, and to fill gaps (so adding a new block later stays safe).
const DEFAULT_BLOCKS = [
  { key: 'logo', on: true },
  { key: 'martName', on: true },
  { key: 'barcode', on: true },
  { key: 'dateTime', on: true },
  { key: 'items', on: true },
  { key: 'caption', on: true },
];
const BLOCK_KEYS = DEFAULT_BLOCKS.map((b) => b.key);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// dd/mm/yyyy hh:mm:ss (en-GB ordering, no locale-dependent month/day swap).
function fmtDate(d) {
  const dt = new Date(d);
  return dt.toLocaleString('en-GB', { hour12: false }).replace(',', '');
}

// Merge a saved layout with the defaults so order/toggles are always complete.
function resolveLayout(printer) {
  let saved = {};
  if (printer?.layoutJson) {
    try { saved = JSON.parse(printer.layoutJson); } catch { saved = {}; }
  }
  const savedBlocks = Array.isArray(saved.blocks) ? saved.blocks : [];
  const seen = new Set();
  const blocks = [];
  for (const b of savedBlocks) {
    if (b && BLOCK_KEYS.includes(b.key) && !seen.has(b.key)) {
      blocks.push({ key: b.key, on: b.on !== false });
      seen.add(b.key);
    }
  }
  for (const d of DEFAULT_BLOCKS) if (!seen.has(d.key)) blocks.push({ ...d });
  return {
    blocks,
    martName: saved.martName || printer?.headerText || 'Ai Mini-Mart',
    martNameSize: Number(saved.martNameSize) || 22,
    caption: saved.caption || printer?.footerText || 'Thank you for shopping with Ai Mini-Mart',
    logoUrl: printer?.logoUrl || '',
  };
}

// ---- Code 128 (subset B) -> inline SVG ------------------------------------
// Standard 108 module-width patterns (107 symbols + stop). Each digit is a
// bar/space width; the string starts with a bar.
const C128 = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

function barcodeSvg(text, { height = 44, unit = 1.6 } = {}) {
  const s = String(text || '');
  const values = [104]; // Start B
  let sum = 104;
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i) - 32; // subset B: ASCII 32..127 -> 0..95
    if (code < 0 || code > 95) code = 0; // unsupported char -> space
    values.push(code);
    sum += code * (i + 1);
  }
  values.push(sum % 103); // checksum
  values.push(106); // Stop

  let x = 0;
  let rects = '';
  for (const val of values) {
    const pat = C128[val];
    for (let i = 0; i < pat.length; i++) {
      const w = Number(pat[i]) * unit;
      if (i % 2 === 0) rects += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}"/>`;
      x += w;
    }
  }
  const total = x.toFixed(2);
  return `<svg class="barcode" viewBox="0 0 ${total} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g fill="#000">${rects}</g></svg>`;
}

function renderReceiptHtml(bill, printer, { autoPrint = false } = {}) {
  const paper = PAPER[printer?.paperWidth] || PAPER['80mm'];
  const code = bill.currency || 'THB';
  const L = resolveLayout(printer);

  const itemRows = (bill.items || [])
    .map(
      (it) => `
        <tr class="item">
          <td class="qty">${it.qty}×</td>
          <td class="name">${esc(it.nameSnapshot)}<span class="unit">${formatMinor(it.unitPriceMinor, code)}</span></td>
          <td class="amt">${formatMinor(it.lineTotalMinor, code)}</td>
        </tr>`
    )
    .join('');

  // Each block -> HTML (empty string when it has nothing to show).
  const renderers = {
    logo: () => (L.logoUrl ? `<div class="center"><img class="logo" src="${esc(L.logoUrl)}" alt=""/></div>` : ''),
    martName: () => `<div class="center store" style="font-size:${L.martNameSize}px">${esc(L.martName).split('\n').join('<br/>')}</div>`,
    barcode: () => `<div class="center barcode-wrap">${barcodeSvg(bill.billNo)}<div class="barcode-num">${esc(bill.billNo)}</div></div>`,
    dateTime: () => `<div class="meta">
        <div>Bill: ${esc(bill.billNo)}</div>
        <div>Date: ${esc(fmtDate(bill.createdAt))}</div>
        ${bill.staff ? `<div>Cashier: ${esc(bill.staff.name)}</div>` : ''}
        ${bill.customerName ? `<div>Customer: ${esc(bill.customerName)}</div>` : ''}
      </div>`,
    items: () => `<table><tbody>${itemRows}</tbody></table>
      <hr />
      <table class="totals"><tbody>
        <tr><td class="label">Subtotal</td><td class="value">${formatMinor(bill.subtotalMinor, code)}</td></tr>
        <tr class="grand"><td class="label">TOTAL</td><td class="value">${formatMinor(bill.totalMinor, code)}</td></tr>
        <tr><td class="label muted">Payment</td><td class="value muted">${esc(bill.paymentMethod)}</td></tr>
      </tbody></table>`,
    caption: () => `<div class="center muted">${esc(L.caption).split('\n').join('<br/>')}</div>`,
  };

  const sections = L.blocks
    .filter((b) => b.on)
    .map((b) => renderers[b.key] && renderers[b.key]())
    .filter((html) => html); // drop empty (e.g. logo with no image)
  const body = sections.join('\n<hr />\n');

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
  .store { font-weight: 700; line-height: 1.15; }
  .logo { max-width: 60%; max-height: 90px; object-fit: contain; }
  .barcode-wrap { margin: 2px 0; }
  .barcode { width: 90%; height: 44px; }
  .barcode-num { font-size: 0.85em; letter-spacing: 2px; }
  .muted { color: #333; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 1px 0; }
  td.qty { width: 12%; }
  td.amt { width: 30%; text-align: right; white-space: nowrap; }
  td.name .unit { display: block; color: #555; font-size: 0.85em; font-weight: 400; }
  tr.item td { padding-top: 4px; padding-bottom: 4px; font-weight: 700; }
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
    ${body}
  </div>
  <div class="noprint"><button onclick="window.print()">Print receipt</button></div>
  ${autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script>' : ''}
</body>
</html>`;
}

module.exports = { renderReceiptHtml, PAPER, DEFAULT_BLOCKS, BLOCK_KEYS };
