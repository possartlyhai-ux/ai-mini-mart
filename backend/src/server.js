// Express app: serves the static admin/POS UI, the /uploads folder, and the
// JSON API. Mounted routes enforce auth + RBAC themselves.
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

const { attachUser } = require('./middleware/auth');
const { HttpError } = require('./lib/validate');

const app = express();

// CORS — the storefront (hosted separately, e.g. Firebase) calls the public
// /api/storefront feed cross-origin. Allowed origins come from CORS_ORIGIN
// (comma-separated); localhost dev origins are always allowed.
// localhost:5173 = storefront dev; https/http/capacitor://localhost = the
// Capacitor Android webview origins (so the POS APK can call the API).
const DEV_ORIGINS = [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'https://localhost', 'http://localhost', 'capacitor://localhost',
];
const ALLOWED_ORIGINS = [
  ...DEV_ORIGINS,
  ...(process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
];
app.use(
  cors({
    origin: (origin, cb) => {
      // No Origin header (same-origin nav, curl) and allow-listed origins pass.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(attachUser);

// Static: admin UI + uploaded images.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes.
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/bills', require('./routes/bills'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/printers', require('./routes/printers'));
app.use('/api/storefront', require('./routes/storefront'));

app.get('/api/health', (_req, res) => {
  // cloudinary = is durable image upload configured? (CLOUDINARY_URL present &
  // parseable). No secret is exposed — just whether the cloud name resolved.
  let cloudinary = false;
  try { cloudinary = !!require('cloudinary').v2.config().cloud_name; } catch { /* SDK missing */ }
  res.json({ ok: true, cloudinary });
});

// 404 for unmatched API paths (let the SPA handle everything else).
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler — turns validation/Prisma errors into clean JSON.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Image is too large (max 4 MB).' });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const PORT = process.env.PORT || 3000;

function start() {
  return app.listen(PORT, () => {
    console.log(`\n  Ai Mini-Mart admin/POS →  http://localhost:${PORT}\n`);
  });
}

// Start immediately when run directly; export for the bootstrap script.
if (require.main === module) start();

module.exports = { app, start };
