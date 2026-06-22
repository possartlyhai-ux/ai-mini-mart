# Ai Mini-Mart — Backend + Staff Admin/POS

Staff-facing backend and admin/POS web app for **Ai Mini-Mart**. Pairs with the
customer storefront (the repo root). Handles inventory, point-of-sale billing
with barcode scanning, bill history, sales reports, staff accounts with
role-based access, and printer/receipt setup.

- **Stack:** Node.js + Express, SQLite via Prisma, vanilla HTML/JS admin UI.
- **Money:** base currency **THB**, stored as integer minor units (satang), with
  **KHR** conversion — identical model to the storefront (`js/currency.js`).
- **No build step** for the UI. One command to run.

---

## Install & run

```bash
cd backend
npm install        # also generates the Prisma client (postinstall)
npm start          # creates + seeds the SQLite DB on first run, then serves
```

Open **http://localhost:3000**.

`npm start` is idempotent: it runs `prisma db push` (creates `prisma/dev.db` from
the schema) and seeds sample data only when the database is empty. To change the
port, set `PORT` (see `.env.example`).

### Seed login credentials

| Role  | Username | Password    | Can do                                                        |
|-------|----------|-------------|---------------------------------------------------------------|
| Owner | `owner`  | `Owner@123` | Everything                                                    |
| Staff | `staff`  | `Staff@123` | Make bills, scan, view **own** bills, print — no cost/reports/staff/printer-config |

The seed also loads **18 products** mirroring the storefront catalog (with
barcodes, SKUs, stock — two out-of-stock and two low-stock for testing) and one
default 80 mm thermal printer.

### Useful scripts

```bash
npm run seed       # re-run the seed (upserts; safe on an existing DB)
npm run db:push    # apply schema changes to the SQLite file
npm run server     # start without the db-push/seed bootstrap
```

---

## How it connects to the storefront (no reshaping needed)

The public endpoint **`GET /api/storefront/products`** returns visible, active
products in the **exact** shape the storefront's `js/data.js` uses:

```json
{ "id": "MM-001", "name": "Aurora Wireless Earbuds", "tags": ["electronics","accessories"],
  "priceTHB": 1290, "wasTHB": 1790, "inStock": true, "unit": "1 pair",
  "variantLabel": "Color", "variants": [{ "label": "...", "swatch": "#...", "img": "..." }] }
```

`priceTHB`/`wasTHB` are derived from the stored minor units; `inStock` from live
stock. Later, the storefront's `data.js` can `fetch()` this instead of hardcoding
its array — same field names, same THB base, no renaming. (The frontend is **not**
modified by this project.)

There is also `GET /api/storefront/categories` mirroring the storefront's
category ids + icons.

---

## API overview

All `/api/*` (except `/auth/login` and `/api/storefront/*`) require the auth
cookie set at login. Permissions are enforced **server-side**.

| Area      | Endpoints |
|-----------|-----------|
| Auth      | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Products  | `GET/POST /products`, `GET/PATCH/DELETE /products/:id`, `GET /products/lookup?code=`, `POST /products/:id/image`, `POST /products/:id/stock`, `GET /products/:id/movements`, `PATCH /products/:id/visibility` |
| Bills     | `POST /bills`, `GET /bills`, `GET /bills/:id`, `GET /bills/:id/receipt` |
| Reports   | `GET /reports?period=day\|week\|month&from=&to=&currency=` |
| Staff     | `GET/POST /staff`, `PATCH /staff/:id` (Owner) |
| Printers  | `GET /printers`, `POST/PATCH/DELETE /printers/:id` (manage = Owner) |
| Storefront| `GET /storefront/products`, `GET /storefront/categories` (public) |

### RBAC

Roles and their permissions live in **one config object**:
`src/config/permissions.js`. To add a role or permission, edit that file and
guard routes with `requirePermission('your:key')`. Field-level rules (e.g. cost
price is stripped from product responses unless the caller has `products:cost`)
live in `src/lib/serialize.js`. The UI reads the resolved permission list from
`GET /auth/me` and hides what the user can't do — but the server is the real gate.

---

## Project structure

```
backend/
  prisma/schema.prisma   data models (User, Product, StockMovement, Bill, BillItem, PrinterSetting)
  prisma/seed.js         owner + staff + 18 storefront-matching products + default printer
  scripts/start.js       one-command bootstrap (db push + seed-if-empty + serve)
  src/server.js          Express app
  src/config/            permissions (RBAC matrix), categories
  src/lib/               currency (THB/KHR + satang), auth (bcrypt+JWT), validate, serialize
  src/middleware/auth.js requireAuth / requirePermission
  src/routes/            auth, products, bills, reports, staff, printers, storefront
  src/receipt/render.js  paper-width-sized HTML receipt
  public/                admin/POS UI (index.html, styles.css, js/api.js, js/app.js)
  uploads/               product images (served at /uploads)
```

---

## Where to extend (hooks left clean for v2)

- **Promotions / discounts / coupons:** the `Bill.totalMinor` is computed
  separately from `subtotalMinor` and `Product.comparePriceMinor` already exists
  (the storefront "was" price). Add a `Promotion` model and a price-resolution
  step in `src/routes/bills.js` (the `lineData` loop) — nothing else needs to
  change.
- **Charts:** `GET /reports` already returns raw `buckets` (per day/week/month) +
  `topProducts`; point a chart library at that data.
- **Real thermal printing (ESC/POS):** today `src/receipt/render.js` produces
  print-ready HTML. Swap/extend it to emit ESC/POS bytes for a connected printer.
- **Camera barcode scan:** the POS already accepts USB-scanner/keyboard + manual
  input via `GET /products/lookup`; add a camera decoder (e.g. a JS barcode lib)
  that calls the same endpoint.
- **Postgres:** change `datasource.provider` to `postgresql` and point
  `DATABASE_URL` at the server — models are written to be portable (enum-like
  fields are documented Strings).
- **More roles:** add to `ROLE_PERMISSIONS` in `src/config/permissions.js`.

## Notes

- Money is stored as integer **satang** (THB × 100) for decimal-safe math and
  formatted only at the edges via `src/lib/currency.js`.
- Receipts use the ASCII currency code on demand (`formatMoneyCode`) so thermal
  printer fonts never garble `฿` / `៛`.
- Deleting a product is a **soft delete** (retire) by default so bill history
  stays intact; `DELETE /products/:id?hard=1` hard-deletes only if it was never
  sold.
```
