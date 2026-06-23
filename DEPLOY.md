# Deploying Ai Mini-Mart

Two apps, two hosts:

- **Storefront** (repo root: `index.html`, `js/`, `styles.css`) → **Firebase Hosting** (static).
- **Backend** (`backend/`: Express API + admin/POS) → **Render** (free Node web service).
- **Database** → **Neon** (free, non-expiring Postgres) — external to Render.

The storefront reads its catalog from the backend's public feed
(`/api/storefront/products` + `/categories`), falling back to the bundled
`js/data.js` if the backend is unreachable. So deploy the **backend first**, then
point the storefront at it.

---

## 1. Database → Neon (free, non-expiring)

1. Create a free project at [neon.tech](https://neon.tech).
2. Copy the **pooled** connection string. Make sure it ends with `?sslmode=require`,
   e.g. `postgresql://USER:PASS@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`.
   Keep it handy for the Render env var below — don't commit it.

Neon free ≈ 0.5 GB — far more than enough (your catalog is ~1 MB; the DB stores
text + image URLs, not image files).

## 2. Backend → Render

Render builds from this GitHub repo using `render.yaml` (a Blueprint).

1. Push this repo to GitHub (it already has the `render.yaml` blueprint).
2. In Render: **New → Blueprint**, pick this repo. It creates the web service
   `ai-mini-mart-api` (rootDir `backend`, `npm start`), auto-generates `JWT_SECRET`,
   and prompts for the `sync:false` vars.
3. Set **`DATABASE_URL`** = your Neon pooled string (step 1). Leave `CORS_ORIGIN`
   for now (set it in step 5).
4. Approve/apply. First deploy runs `npm install` → `npm start`, which does
   `prisma db push` (creates tables in Neon) + seeds sample data on the empty DB,
   then serves.
5. When live, note the URL, e.g. `https://ai-mini-mart-api.onrender.com`.
   Check `https://<url>/api/health` returns `{"ok":true}`.

**Seed logins on the fresh prod DB:** owner `owner` / `Owner@123`,
staff `staff` / `Staff@123`. **Change the owner password immediately** after first login.

> Free tier caveats: the Render web service cold-starts after idle (first request
> is slow). Uploaded images (`uploads/`) are **ephemeral** — they reset on each
> redeploy. Add a persistent disk or object storage (Cloudinary/S3) for durable
> image uploads. (Neon itself does not expire.)

## 3. Point the storefront at the backend

In [`js/store-api.js`](js/store-api.js), set the production base URL:

```js
return 'https://ai-mini-mart-api.onrender.com'; // <- your Render URL
```

(Local dev auto-uses `http://localhost:3000`; you can also override at runtime
with `localStorage.setItem('mymart.apiBase', '<url>')`.)

## 4. Storefront → Firebase Hosting

```bash
firebase login          # your Google account
firebase deploy --only hosting   # project: ai-mini-mart (.firebaserc)
```

Live at `https://ai-mini-mart.web.app` (and `…firebaseapp.com`).

## 5. Allow the storefront origin (CORS)

In Render → `ai-mini-mart-api` → Environment, set:

```
CORS_ORIGIN = https://ai-mini-mart.web.app,https://ai-mini-mart.firebaseapp.com
```

Save (the service redeploys). The storefront feed now loads cross-origin.

## 6. Durable image uploads (Cloudinary)

Render's disk is ephemeral, so staff-uploaded images (product photos, category
banners, printer logos) vanish on redeploy unless stored externally.

1. Sign up free at [cloudinary.com](https://cloudinary.com).
2. Dashboard → copy the **API environment variable**:
   `cloudinary://<api_key>:<api_secret>@<cloud_name>`.
3. Render → `ai-mini-mart-api` → Environment → set **`CLOUDINARY_URL`** to that value → Save (redeploys).

Now uploads go to Cloudinary and return permanent `https://res.cloudinary.com/...`
URLs (stored in the DB, shown on the storefront). Without `CLOUDINARY_URL` the
app silently falls back to the local `./uploads` dir (fine for local dev).

---

## Local development after the Postgres switch

The schema is now Postgres. To run the backend locally, start a Postgres and set
`backend/.env` `DATABASE_URL` (see `backend/.env.example`). Quick Docker DB:

```bash
docker run --name aimm-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ai_mini_mart -p 5432:5432 -d postgres:16
cd backend && npm start   # db push + seed + serve on :3000
```

The old `backend/prisma/dev.db` (SQLite) is left in place as a backup but is no
longer used.
