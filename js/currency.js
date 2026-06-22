/* =========================================================================
 * currency.js — Currency conversion + formatting
 * -------------------------------------------------------------------------
 * Base currency is THB. Every product price in data.js is in Baht. To show
 * a price in another currency we multiply by RATES[code] and format with
 * that currency's symbol, decimals, and symbol position.
 *
 * TO ADD A CURRENCY
 *   1. Add an entry to CURRENCIES (defines symbol / decimals / position).
 *   2. Add its conversion factor to RATES (units of that currency per 1 THB).
 *
 * TO UPDATE EXCHANGE RATES
 *   Edit RATES. These are intentionally simple constants for a no-backend
 *   v1; swap in a live feed later if you need accuracy.
 * ========================================================================= */

// Units of the target currency per 1 THB (base). THB is always 1.
const RATES = {
  THB: 1,
  KHR: 114,      // ~1 THB ≈ 114 Riel
};

const CURRENCIES = {
  THB: { symbol: '฿', decimals: 2, position: 'before', label: 'Thai Baht' },
  KHR: { symbol: '៛', decimals: 0, position: 'after',  label: 'Khmer Riel' },
};

/**
 * Convert a base (THB) amount into `code` and return a formatted string,
 * e.g. convertPrice(1290, 'USD') -> "$35.48".
 */
function convertPrice(baseTHB, code) {
  const cfg = CURRENCIES[code] || CURRENCIES.THB;
  const value = baseTHB * (RATES[code] ?? 1);
  return formatMoney(value, code);
}

/** Format an already-converted numeric value with the currency's symbol. */
function formatMoney(value, code) {
  const cfg = CURRENCIES[code] || CURRENCIES.THB;
  const num = value.toLocaleString('en-US', {
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  });
  // KHR reads naturally with the symbol trailing ("12,000 ៛").
  return cfg.position === 'after' ? `${num} ${cfg.symbol}` : `${cfg.symbol}${num}`;
}

/** Raw converted number (no symbol) — used by the PDF table columns. */
function convertRaw(baseTHB, code) {
  return baseTHB * (RATES[code] ?? 1);
}

/**
 * PDF-safe formatter. jsPDF's built-in Helvetica uses WinAnsi encoding,
 * which has no glyph for ฿ (U+0E3F) or ៛ (U+17DB) — using them garbles the
 * digits. So the printed sheet uses the ASCII 3-letter code instead, which
 * is also clearer for staff: "THB 1,290.00", "KHR 147,060", "USD 35.48".
 */
function formatMoneyPDF(value, code) {
  const cfg = CURRENCIES[code] || CURRENCIES.THB;
  const num = value.toLocaleString('en-US', {
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  });
  return `${code} ${num}`;
}
