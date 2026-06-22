// =============================================================================
// currency.js — backend port of the storefront's money model (js/currency.js).
//
// Base currency is THB. The storefront stores each price once as `priceTHB`;
// here we store it as INTEGER MINOR UNITS (satang = baht * 100) for decimal-safe
// arithmetic, and convert/format at the edges.
//
//   minor (satang)  --/100-->  baht  --* RATES[code]-->  display value
//
// TO ADD A CURRENCY: add to RATES (units per 1 THB) and CURRENCIES (formatting).
// Kept intentionally in sync with the storefront: THB (base) + KHR only.
// =============================================================================

// Units of the target currency per 1 THB (base). THB is always 1.
const RATES = {
  THB: 1,
  KHR: 114, // ~1 THB ≈ 114 Riel
};

const CURRENCIES = {
  THB: { code: 'THB', symbol: '฿', decimals: 2, position: 'before', label: 'Thai Baht' },
  KHR: { code: 'KHR', symbol: '៛', decimals: 0, position: 'after', label: 'Khmer Riel' },
};

const isCurrency = (code) => Object.prototype.hasOwnProperty.call(CURRENCIES, code);

// ---- minor-unit helpers (THB satang) ----------------------------------------
const bahtToMinor = (baht) => Math.round(Number(baht) * 100);
const minorToBaht = (minor) => Number(minor) / 100;

// ---- conversion + formatting -------------------------------------------------
function convertFromTHB(baht, code) {
  return Number(baht) * (RATES[code] ?? 1);
}

// Format an already-converted numeric value with the currency's symbol.
function formatMoney(value, code) {
  const cfg = CURRENCIES[code] || CURRENCIES.THB;
  const num = Number(value).toLocaleString('en-US', {
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  });
  return cfg.position === 'after' ? `${num} ${cfg.symbol}` : `${cfg.symbol}${num}`;
}

// ASCII-safe formatter (3-letter code) — used on printed receipts so thermal
// printers / WinAnsi fonts never garble the ฿ / ៛ glyphs. e.g. "THB 1,290.00".
function formatMoneyCode(value, code) {
  const cfg = CURRENCIES[code] || CURRENCIES.THB;
  const num = Number(value).toLocaleString('en-US', {
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  });
  return `${code} ${num}`;
}

// Convenience: take THB minor units -> display string in `code`.
function formatMinor(minor, code = 'THB') {
  return formatMoney(convertFromTHB(minorToBaht(minor), code), code);
}
function formatMinorCode(minor, code = 'THB') {
  return formatMoneyCode(convertFromTHB(minorToBaht(minor), code), code);
}

module.exports = {
  RATES,
  CURRENCIES,
  isCurrency,
  bahtToMinor,
  minorToBaht,
  convertFromTHB,
  formatMoney,
  formatMoneyCode,
  formatMinor,
  formatMinorCode,
};
