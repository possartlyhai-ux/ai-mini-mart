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

  /* ---------- Header band: logo placeholder + store name ---------- */
  doc.setFillColor(...BRAND);
  doc.roundedRect(M, 14, 14, 14, 3, 3, 'F');         // logo placeholder square
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('M', M + 7, 24, { align: 'center' });

  doc.setTextColor(...INK);
  doc.setFontSize(20);
  doc.text('Ai Mini-Mart', M + 19, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text('Everyday goods, sorted.', M + 19, 27);

  // Right side: ORDER SHEET title + meta
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND);
  doc.text(t('pdf_order_sheet'), PAGE_W - M, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(`${t('pdf_order_id')}: ${order.id}`, PAGE_W - M, 26, { align: 'right' });
  doc.text(`${t('pdf_date')}: ${order.dateStr}`, PAGE_W - M, 30.5, { align: 'right' });

  // Divider
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.4);
  doc.line(M, 34, PAGE_W - M, 34);

  /* ---------- Customer info block ---------- */
  let y = 42;
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
    const unit = convertRaw(it.unitTHB, cur);
    const lineTotal = unit * it.qty;
    grand += lineTotal;
    return [
      '',                               // image cell (painted in didDrawCell)
      it.name,
      String(it.qty),
      formatMoneyPDF(unit, cur),
      formatMoneyPDF(lineTotal, cur),
    ];
  });

  doc.autoTable({
    startY: y + 3,
    margin: { left: M, right: M },
    head: [['', t('pdf_item'), t('pdf_qty'), t('pdf_unit'), t('pdf_line')]],
    body,
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 3, textColor: INK, lineColor: LINE, lineWidth: 0.1, valign: 'middle', minCellHeight: 16 },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left' },
    alternateRowStyles: { fillColor: [247, 245, 238] },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      2: { halign: 'center', cellWidth: 16 },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 34 },
    },
    didDrawCell: (d) => {
      if (d.section === 'body' && d.column.index === 0) {
        const data = rowImages[d.row.index];
        if (!data) return;
        const size = 13;
        const x = d.cell.x + (d.cell.width - size) / 2;
        const yy = d.cell.y + (d.cell.height - size) / 2;
        doc.addImage(data, 'JPEG', x, yy, size, size, undefined, 'FAST');
      }
    },
  });

  /* ---------- Grand total ---------- */
  let afterY = doc.lastAutoTable.finalY + 8;
  const boxW = 78;
  const boxX = PAGE_W - M - boxW;
  doc.setFillColor(...BRAND);
  doc.roundedRect(boxX, afterY, boxW, 14, 2.5, 2.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(t('pdf_grand_total'), boxX + 5, afterY + 8.6);
  doc.setFontSize(13);
  doc.text(formatMoneyPDF(grand, cur), boxX + boxW - 5, afterY + 9, { align: 'right' });

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
const orderFileName = (order) => `AiMiniMart-Order-${order.id}.pdf`;

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
