# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The **staff-facing backend + admin/POS** for Ai Mini-Mart, paired with the customer storefront one
directory up (`../`). Express REST API + Prisma/SQLite + a **no-build, vanilla-JS** admin UI served
as static files. Handles inventory, point-of-sale billing (barcode scan → bill), bill history, sales
reports, staff accounts with RBAC, and printer/receipt setup. The storefront at `../` is a separate,
finished app — this backend is designed to feed it later but **does not modify it**.

## Commands

```bash
npm install        # installs deps; postinstall runs `prisma generate`
npm start          # scripts/start.js: prisma db push + seed-if-empty + serve  →  http://localhost:3000
npm run server     # start the Express app only (no db push / seed) — what the preview harness runs
npm run seed       # re-run the seed (upserts owner/staff/products — safe on an existing DB)
npm run db:push    # apply schema.prisma changes to the SQLite file
```

There is **no lint/test tooling** and no UI build step. Verify changes by running the server and
exercising the API (curl) or the admin UI in a browser. `DATABASE_URL` defaults to `file:./dev.db` in
code (`src/db.js`, `prisma/seed.js`, `scripts/start.js`) so it runs with zero env setup; `.env` is
optional (see `.env.example`).

Seed logins: Owner `owner`/`Owner@123`, Staff `staff`/`Staff@123` (printed on seed). The seed also
loads 18 products that mirror the storefront catalog (with barcodes/stock; two out-of-stock, two
low-stock for testing).

## Architecture

### Request pipeline (`src/server.js`)
`express.json` → `cookieParser` → **`attachUser`** (loads `req.user`/`req.permissions` from the JWT
cookie on *every* request, non-blocking) → static (`/uploads`, `public/`) → `/api/*` routers → a
central error handler that turns `HttpError` (from `src/lib/validate.js`) and known Prisma codes
(`P2002` unique, `P2025` not-found) into clean JSON. Throw `badRequest(...)` / `HttpError` in routes
instead of writing status codes by hand.

### Money is integer minor units (THB satang)
Every price is stored as an **Int** field named `*Minor` (baht × 100) for decimal-safe math, and only
converted/formatted at the edges via `src/lib/currency.js` — a deliberate port of the storefront's
`../js/currency.js` (base **THB ×1**, **KHR ×114**; same symbol/decimals/position rules). `formatMoney`
uses the symbol; `formatMoneyCode`/`formatMinorCode` use the ASCII 3-letter code for receipts (thermal
fonts garble `฿`/`៛`). When adding a currency, edit `RATES` + `CURRENCIES` here **and** keep it in sync
with the storefront.

### RBAC is enforced in three layers, server-side is the real gate
1. **Route**: `requirePermission('key')` middleware (`src/middleware/auth.js`).
2. **Field**: `src/lib/serialize.js` strips `costPriceMinor`/`costPrice`/margin unless the caller holds
   `products:cost` — so cost data never leaves the server for Staff, regardless of UI.
3. **UI**: `public/js/app.js` reads the resolved permission list from `GET /api/auth/me` and hides nav
   /actions. This is convenience only.

The permission matrix is a **single config object** in `src/config/permissions.js`
(`ROLE_PERMISSIONS`). Add roles/permissions there; guard new routes with `requirePermission`. Owner =
all keys; Staff = `products:read`, `bills:create`, `bills:read:own`, `printers:read`.

### The storefront feed is the integration contract
`GET /api/storefront/products` (`src/routes/storefront.js` → `serializeStorefrontProduct`) returns
visible+active products in the **exact** shape of `../js/data.js`: `{ id, name, tags, priceTHB,
wasTHB?, inStock, unit, variantLabel, variants }`. `priceTHB`/`wasTHB` derive from minor units;
`inStock` from `stockQty > 0`; `id` is the SKU. **Do not rename these keys** — the storefront will
later `fetch()` this with no reshaping. Public (no auth).

### POS checkout is one transaction (`src/routes/bills.js`)
`POST /bills` runs in a single `prisma.$transaction`: validate stock for each line, snapshot
name+price into `BillItem`, create the `Bill` (sequential `billNo` = `B-` + zero-padded count),
**decrement `stockQty`**, and write a `SALE` `StockMovement` per line (qty negative, `reason` = billNo,
`billId` set). `totalMinor` is computed separately from `subtotalMinor` — that gap is the seam where
future discounts/tax plug in (no promo logic in v1). Stock is never edited directly elsewhere except
`POST /products/:id/stock` (manual IN/OUT/ADJUST, also logs a movement).

### Data model notes (`prisma/schema.prisma`)
Enum-like fields (`role`, movement `type`, `paymentMethod`, `status`, `paperWidth`) are **Strings with
documented allowed values**, not Prisma enums — so the same schema works on SQLite now and Postgres
later (change only `datasource.provider` + `DATABASE_URL`). `Product.tagsJson`/`variantsJson` are JSON
**strings** (category list is small; category filtering happens in the app layer in
`src/routes/products.js`, not in SQL). `BillItem.productId` is nullable so history survives product
deletion. Categories are a fixed constant (`src/config/categories.js`) mirroring the storefront, not a
table.

## Gotchas

- **Route order**: in `src/routes/products.js`, `/lookup` and `/` are declared **before** `/:id` —
  Express matches top-down, so a literal route after `/:id` would be shadowed.
- **Soft delete by default**: `DELETE /products/:id` sets `isActive:false` + `isVisible:false` (keeps
  bill history). Only `?hard=1` truly deletes, and only if the product was never sold.
- **Product create vs. stock**: the product create/edit form does not change `stockQty` after creation
  — stock only moves through `POST /products/:id/stock` (which records a movement). The Edit modal's
  stock field is read-only by design.
- **Image upload** (`multer` → `uploads/`) needs the product to exist first; the UI creates/updates the
  product, then POSTs the image to `/products/:id/image`.
- **Receipts** (`src/receipt/render.js`) size `@page` to the **default** `PrinterSetting`'s paperWidth;
  there is exactly one default at a time (the printers route maintains that invariant). v1 "print" =
  browser print dialog on HTML; ESC/POS is a documented extension point.

See `README.md` for the full API table and the v2 extension hooks (promotions, charts, real printing,
camera scan, Postgres).
