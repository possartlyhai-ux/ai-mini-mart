/* =========================================================================
 * pdf.js — Staff order sheet (client-side, jsPDF + AutoTable)
 * -------------------------------------------------------------------------
 * buildOrderSheet(order) builds an A4, print-friendly PDF and returns the
 * jsPDF doc. downloadOrderSheet() saves+opens it; shareOrderSheet() shares
 * it as a file (Web Share API) so the customer can send it to staff.
 *
 * `order` shape:
 *   {
 *     id, dateStr, currency,            // meta
 *     customer:{ name, phone, table, note },
 *     items:[{ name, qty, unitTHB }],   // prices are BASE THB
 *   }
 *
 * Money note: prices arrive in THB and are converted to `order.currency`
 * here via convertRaw()/formatMoney() from currency.js, so the printed
 * sheet matches whatever currency the shopper selected.
 *
 * i18n note: every label is pulled through `t()` (passed in) so the sheet
 * prints in the active language. Latin scripts render with the built-in
 * Helvetica; for full Khmer/Thai/Chinese glyph rendering you'd embed a
 * Unicode TTF (jsPDF .addFont) — noted inline below.
 * ========================================================================= */

/* ---------- Image helpers ----------
 * Load a remote image as a JPEG dataURL for embedding, or fall back to a
 * solid swatch tile if it can't be read (CORS taint / slow host). Always
 * resolves, so the sheet never blocks on a hung image.
 */
function pdfSwatchTile(color) {
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color || '#d8d8d8'; ctx.fillRect(0, 0, 96, 96);
  const g = ctx.createLinearGradient(0, 0, 96, 96);
  g.addColorStop(0, 'rgba(255,255,255,.28)'); g.addColorStop(1, 'rgba(0,0,0,.14)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 96, 96);
  return c.toDataURL('image/jpeg', 0.8);
}
// Load the storefront logo (same-origin → canvas stays untainted) as a PNG
// dataURL, keeping its real aspect ratio. Resolves null if it can't be read so
// the header gracefully falls back to text only.
function pdfLoadLogo() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), 2500);
    const img = new Image();
    img.onload = () => {
      clearTimeout(timer);
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        finish({ data: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
      } catch (e) { finish(null); }
    };
    img.onerror = () => { clearTimeout(timer); finish(null); };
    img.src = 'assets/logo.png';
  });
}

/* Render text to a transparent PNG via the browser's own fonts, so currency
 * SYMBOLS (฿ / ៛) print correctly — jsPDF's Helvetica is WinAnsi and garbles
 * them. Returned {data,w,h} are in CSS px; callers scale to mm by aspect. */
function pdfTextImage(text, color) {
  const scale = 4, fontPx = 36, padX = 6;
  const font = `900 ${fontPx}px "Noto Sans Thai","Noto Sans Khmer","Plus Jakarta Sans",Arial,sans-serif`;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  const w = Math.ceil(meas.measureText(text).width) + padX * 2;
  const h = Math.ceil(fontPx * 1.35);
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padX, h / 2);
  return { data: c.toDataURL('image/png'), w, h };
}

function pdfLoadImage(url, swatch) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (data) => { if (!settled) { settled = true; resolve(data); } };
    const timer = setTimeout(() => finish(pdfSwatchTile(swatch)), 2500);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      try {
        const c = document.createElement('canvas'); c.width = c.height = 96;
        const ctx = c.getContext('2d');
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 96, 96);
        finish(c.toDataURL('image/jpeg', 0.85));
      } catch (e) { finish(pdfSwatchTile(swatch)); }   // tainted canvas -> swatch
    };
    img.onerror = () => { clearTimeout(timer); finish(pdfSwatchTile(swatch)); };
    img.src = url;
  });
}

// Build the order-sheet PDF and return the jsPDF doc (async: loads images).
async function buildOrderSheet(order, t) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const PAGE_W = doc.internal.pageSize.getWidth();   // 210mm
  const M = 16;                                       // page margin
  const cur = order.currency;

  // Brand palette (kept in sync with the light theme tokens — joyful orange).
  const BRAND = [249, 115, 22];   // #F97316
  const INK = [42, 26, 16];
  const MUTED = [154, 130, 112];
  const LINE = [242, 226, 209];

  /* ---------- Header: logo centered middle-top (first page only) ---------- */
  const logo = await pdfLoadLogo();
  let y = 12;
  if (logo) {
    const lh = 24;                               // logo height (mm) — larger crest
    const lw = lh * (logo.w / logo.h);
    doc.addImage(logo.data, 'PNG', (PAGE_W - lw) / 2, y, lw, lh, undefined, 'FAST');
    y += lh + 4;
  } else {
    y += 6;
  }
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Ai Mini-Mart', PAGE_W / 2, y, { align: 'center' });
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text('Everyday goods, sorted.', PAGE_W / 2, y, { align: 'center' });
  y += 6;

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.4);
  doc.line(M, y, PAGE_W - M, y);
  y += 7;

  /* ---------- Meta row: ORDER SHEET (left) + id / date (right) ---------- */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...BRAND);
  doc.text(t('pdf_order_sheet'), M, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(`${t('pdf_order_id')}: ${order.id}`, PAGE_W - M, y - 3, { align: 'right' });
  doc.text(`${t('pdf_date')}: ${order.dateStr}`, PAGE_W - M, y + 1.5, { align: 'right' });
  y += 5;
  doc.setDrawColor(...LINE);
  doc.line(M, y, PAGE_W - M, y);

  /* ---------- Customer info block ---------- */
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);

  const c = order.customer;
  const rows = [
    [t('pdf_customer'), c.name || '—'],
    [t('pdf_table'), c.table || '—'],
  ];
  // Note the customer's chosen UI language (the sheet itself is always English
  // because jsPDF's Helvetica can't render Khmer/Thai/Chinese glyphs).
  if (order.langName && order.langName !== 'English') {
    rows.push([t('pdf_language'), order.langName]);
  }
  rows.forEach(([label, val]) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...MUTED);
    doc.text(`${label}:`, M, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    doc.text(String(val), M + 34, y);
    y += 6;
  });
  if (c.note) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...MUTED);
    doc.text(`${t('pdf_note')}:`, M, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    const noteLines = doc.splitTextToSize(c.note, PAGE_W - M - (M + 34));
    doc.text(noteLines, M + 34, y);
    y += noteLines.length * 5;
  }

  /* ---------- Itemized table (AutoTable) ----------
   * Columns: image | item | qty | unit price | line total.
   * The numbering column is intentionally gone; each row shows the chosen
   * variant's picture instead. Images are pre-loaded, then painted per cell. */
  const rowImages = await Promise.all(order.items.map(it => pdfLoadImage(it.img, it.swatch)));

  let grand = 0;
  const body = order.items.map((it) => {
    // Honour a hand-set KHR unit price when the sheet currency is KHR (no FX).
    const unit = (cur === 'KHR' && Number(it.unitKHR) > 0) ? Number(it.unitKHR) : convertRaw(it.unitTHB, cur);
    const lineTotal = unit * it.qty;
    grand += lineTotal;
    // Item cell prints on two lines: name, then its variant (no parentheses).
    const itemCell = it.variant ? `${it.name}\n${it.variant}` : it.name;
    return [
      '',                               // image cell (painted in didDrawCell)
      itemCell,
      String(it.qty),
      formatMoneyPDF(unit, cur),
      formatMoneyPDF(lineTotal, cur),
    ];
  });

  // More breathing room between the item name and its variant line.
  doc.setLineHeightFactor(1.5);
  doc.autoTable({
    startY: y + 3,
    margin: { left: M, right: M },
    head: [['', t('pdf_item'), t('pdf_qty'), t('pdf_unit'), t('pdf_line')]],
    body,
    theme: 'striped',
    styles: { font: 'helvetica', fontStyle: 'bold', fontSize: 11, cellPadding: 4, textColor: INK, lineColor: LINE, lineWidth: 0.1, valign: 'middle', minCellHeight: 24 },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left', fontSize: 10.5 },
    alternateRowStyles: { fillColor: [247, 245, 238] },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' },
      1: { fontStyle: 'bold' },
      2: { halign: 'center', cellWidth: 16 },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 34 },
    },
    didDrawCell: (d) => {
      if (d.section === 'body' && d.column.index === 0) {
        const data = rowImages[d.row.index];
        if (!data) return;
        const size = 20;                 // bigger product thumbnail
        const x = d.cell.x + (d.cell.width - size) / 2;
        const yy = d.cell.y + (d.cell.height - size) / 2;
        doc.addImage(data, 'JPEG', x, yy, size, size, undefined, 'FAST');
      }
    },
  });
  doc.setLineHeightFactor(1.15);                 // restore default for the rest

  /* ---------- Grand total ----------
   * The amount is drawn as an image rendered with the browser's own fonts so
   * the real currency symbol (฿ / ៛) prints correctly — jsPDF's Helvetica
   * (WinAnsi) has no glyph for them and would garble the digits. */
  let afterY = doc.lastAutoTable.finalY + 8;
  const boxW = 96, boxH = 19;
  const boxX = PAGE_W - M - boxW;
  const labelW = 46;                              // left label panel width
  // Brand-orange label panel on the left, white amount panel on the right so the
  // total reads as its own bright chip. White panel gets a brand border so it
  // stays visible on the white page.
  doc.setFillColor(...BRAND);
  doc.roundedRect(boxX, afterY, boxW, boxH, 2.5, 2.5, 'F');
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.6);
  doc.roundedRect(boxX + labelW, afterY, boxW - labelW, boxH, 2.5, 2.5, 'FD');
  doc.setFillColor(...BRAND);
  doc.rect(boxX + labelW, afterY + 0.6, 2.5, boxH - 1.2, 'F');  // square off the seam edge

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(t('pdf_grand_total'), boxX + 6, afterY + boxH / 2 + 1.3);

  // Amount: dark brand on the white panel, heavy weight — rendered as an image
  // so the currency symbol (฿ / ៛) prints correctly.
  const amtImg = pdfTextImage(formatMoney(grand, cur), '#9A3412');
  const amtH = 9;                                   // amount height (mm) — bigger
  const amtW = amtH * (amtImg.w / amtImg.h);
  doc.addImage(amtImg.data, 'PNG', boxX + boxW - 7 - amtW, afterY + (boxH - amtH) / 2, amtW, amtH);

  /* ---------- Footer: staff-use line ---------- */
  const footY = Math.max(afterY + 30, 250);
  doc.setDrawColor(...LINE);
  doc.line(M, footY, PAGE_W - M, footY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(`${t('pdf_prepared_by')}: ______________________`, M, footY + 8);
  doc.text(`${t('pdf_status')}: ______________________`, PAGE_W - M, footY + 8, { align: 'right' });

  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(t('pdf_thanks'), PAGE_W / 2, footY + 18, { align: 'center' });

  return doc;
}

/* ---------- Output actions ---------- */
const orderFileName = (order) => `Ai-Mini-Mart [ ${order.id} ].pdf`;

// "Download PDF": save the sheet and open it in a new tab.
async function downloadOrderSheet(order, t) {
  const doc = await buildOrderSheet(order, t);
  doc.save(orderFileName(order));
  try { window.open(doc.output('bloburl'), '_blank'); } catch (e) { /* popup blocked */ }
}

// "Share to staff": share the PDF as a file so the customer can send it via a
// chat app (Telegram, LINE, Messenger, WeChat…). Falls back to a download
// when the Web Share API can't share files (most desktop browsers).
// Returns 'shared' | 'downloaded' | 'cancelled'.
async function shareOrderSheet(order, t) {
  const doc = await buildOrderSheet(order, t);
  const file = new File([doc.output('blob')], orderFileName(order), { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'Ai Mini-Mart — Order ' + order.id,
        text: `Order ${order.id} · ${order.customer.name}`,
      });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';   // user dismissed the share sheet
      // any other error -> fall through to download
    }
  }
  doc.save(orderFileName(order));
  return 'downloaded';
}
