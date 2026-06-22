// Tiny validation helpers + a typed error the central error handler turns into
// a clean 400 JSON response. Keeps route code readable without a schema library.

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);

function requireString(value, field, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw badRequest(`${field} is required.`);
  }
  const v = value.trim();
  if (v.length > max) throw badRequest(`${field} is too long (max ${max}).`);
  return v;
}

function optionalString(value, field, { max = 500 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  const v = value.trim();
  if (v.length > max) throw badRequest(`${field} is too long (max ${max}).`);
  return v || null;
}

// Whole, non-negative integer (e.g. stock, qty). Accepts numeric strings.
function intNonNeg(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw badRequest(`${field} must be a whole number ≥ 0.`);
  }
  return n;
}

// Any integer (e.g. a signed stock adjustment).
function intAny(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw badRequest(`${field} must be a whole number.`);
  }
  return n;
}

// A money amount in major units (baht), >= 0, up to 2 decimals.
function moneyBaht(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw badRequest(`${field} must be a valid amount ≥ 0.`);
  return Math.round(n * 100) / 100;
}

function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

module.exports = {
  HttpError,
  badRequest,
  requireString,
  optionalString,
  intNonNeg,
  intAny,
  moneyBaht,
  oneOf,
};
