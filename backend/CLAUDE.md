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
loads the six default categories and 18 products that mirror the storefront catalog (with barcodes;
two start out of stock for testing).

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

**Price lives on the variant, not the product.** Each `Variant` has `sellPriceMinor` (THB satang — the
POS billing base) and a separate staff-set `sellPriceKhr` (whole riel). The POS bills in THB and
converts for display; the KHR price is **storefront-only** (rides the feed as `priceKHR` so the shop
can show a hand-set Riel price instead of a ×114 conversion). It does **not** affect POS/receipts/reports.

### RBAC is enforced in three layers, server-side is the real gate
1. **Route**: `requirePermission('key')` middleware (`src/middleware/auth.js`).
2. **Field**: `src/lib/serialize.js` shapes DB rows into API responses — the single place to gate
   per-field exposure (e.g. a future cost price would be stripped here unless the caller holds the perm).
3. **UI**: `public/js/app.js` reads the resolved permission list from `GET /api/auth/me` and hides nav
   /actions. This is convenience only.

The permission matrix is a **single config object** in `src/config/permissions.js`
(`ROLE_PERMISSIONS`). Add roles/permissions there; guard new routes with `requirePermission`. Owner =
all keys; Staff = `products:read`, `bills:create`, `bills:read:own`, `printers:read`.

### The storefront feed is the integration contract
`GET /api/storefront/products` (`src/routes/storefront.js` → `serializeStorefrontProduct`) returns
visible+active products **ordered by `sortOrder`** as `{ id, name, tags, unit, inStock, priceTHB,
priceKHR, variants }`. Top-level `priceTHB`/`priceKHR`/`inStock` mirror the **first variant** (back-compat
with the storefront card); `variants[]` carries the real per-variant data `{ label, img, priceTHB,
priceKHR, inStock, barcode }`. `id` is the product SKU. `GET /api/storefront/categories` returns
`{ id: slug, icon }` from the DB. **Do not rename these keys** — the storefront will later `fetch()` this
with no reshaping. Public (no auth).

### POS checkout is one transaction (`src/routes/bills.js`)
`POST /bills` takes `items:[{variantId, qty}]` and runs in a single `prisma.$transaction`: load each
variant (+product), snapshot `nameSnapshot = "<product> — <variant>"` and `unitPriceMinor =
variant.sellPriceMinor`, set `productId` + `variantId` on the `BillItem`, and create the `Bill`
(sequential `billNo` = `B-` + zero-padded count). `totalMinor` is separate from `subtotalMinor` — the
seam where future discounts/tax plug in (no promo logic in v1). **Stock is a boolean switch on the
variant** (`Variant.inStock`), so there's nothing to decrement — it's toggled via `PATCH
/products/variants/:vid/stock`. The POS UI blocks adding an out-of-stock variant; the server doesn't
hard-enforce it.

### Data model notes (`prisma/schema.prisma`)
**A `Product` is a grouping** (name, `unit`/"Type", `tagsJson` categories, `isVisible`, `sortOrder`);
its sellable SKUs are **`Variant`** rows (name, unique `barcode`, `imageUrl`, `sellPriceMinor`,
`sellPriceKhr`, `inStock`, `sortOrder`). Every product must have ≥1 variant (enforced in
`src/routes/products.js`). Enum-like fields (`role`, `paymentMethod`, `status`, `paperWidth`) are
**Strings with documented allowed values**, not Prisma enums — so the same schema works on SQLite now
and Postgres later. `Product.tagsJson` is a JSON **string** (category filtering happens in the app
layer, not SQL). `BillItem.productId` + `variantId` are nullable so history survives deletion
(`variantId` is `onDelete: SetNull`). **Categories are an editable `Category` table**
(`src/config/categories.js` holds only the seed defaults); products reference them by `slug` in
`tagsJson`, and deleting a category leaves stale slugs the filter simply ignores.

## Gotchas

- **Route order**: in `src/routes/products.js`, the literal routes `/lookup`, `/reorder`, and
  `/upload-image` are declared **before** `/:id` — Express matches top-down, so a literal route after
  `/:id` would be shadowed.
- **Products carry ≥1 variant**: POST/PATCH validate the `variants[]` payload up front (`buildVariants`
  throws on an empty list); `applyVariants` create/update/deletes variant rows to match in one tx.
- **Soft delete by default**: `DELETE /products/:id` sets `isActive:false` + `isVisible:false` (keeps
  bill history). Only `?hard=1` truly deletes (cascading its variants), and only if never sold.
- **Product ordering**: `sortOrder` (ascending = top of store) is set by drag-and-drop of product
  groups (`PATCH /products/reorder`); list + storefront feed both sort by it.
- **Variant images** (`multer` → `uploads/`): the form POSTs each picked file to the **generic**
  `POST /products/upload-image` (returns `{imageUrl}`, attaches to nothing), then includes the URL in
  the variant payload on save. New products get an auto `MM-###` SKU on create.
- **Receipts** (`src/receipt/render.js`) size `@page` to the **default** `PrinterSetting`'s paperWidth;
  there is exactly one default at a time (the printers route maintains that invariant). v1 "print" =
  browser print dialog on HTML; ESC/POS is a documented extension point.

See `README.md` for the full API table and the v2 extension hooks (promotions, charts, real printing,
camera scan, Postgres).
