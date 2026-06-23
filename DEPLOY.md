# Deploying Ai Mini-Mart

Two apps, two hosts:

- **Storefront** (repo root: `index.html`, `js/`, `styles.css`) → **Firebase Hosting** (static).
- **Backend** (`backend/`: Express API + admin/POS) → **Render** (Node web service + managed Postgres).

The storefront reads its catalog from the backend's public feed
(`/api/storefront/products` + `/categories`), falling back to the bundled
`js/data.js` if the backend is unreachable. So deploy the **backend first**, then
point the storefront at it.

---

## 1. Backend → Render

Render builds from this GitHub repo using `render.yaml` (a Blueprint).

1. Push this repo to GitHub (it already has the `render.yaml` blueprint).
2. In Render: **New → Blueprint**, pick this repo. Render reads `render.yaml`
   and provisions:
   - a free Postgres `ai-mini-mart-db`,
   - a web service `ai-mini-mart-api` (rootDir `backend`, `npm start`),
   - env vars `DATABASE_URL` (auto from the DB) and `JWT_SECRET` (auto-generated).
3. Approve/apply. First deploy runs `npm install` → `npm start`, which does
   `prisma db push` (creates tables) + seeds sample data on the empty DB, then serves.
4. When live, note the URL, e.g. `https://ai-mini-mart-api.onrender.com`.
   Check `https://<url>/api/health` returns `{"ok":true}`.

**Seed logins on the fresh prod DB:** owner `owner` / `Owner@123`,
staff `staff` / `Staff@123`. **Change the owner password immediately** after first login.

> Free tier caveats: Postgres expires ~30 days; the web service cold-starts
> after idle (first request is slow). Uploaded images (`uploads/`) are
> **ephemeral** — they reset on each redeploy. Add a persistent disk or object
> storage (Cloudinary/S3) for durable image uploads.

## 2. Point the storefront at the backend

In [`js/store-api.js`](js/store-api.js), set the production base URL:

```js
return 'https://ai-mini-mart-api.onrender.com'; // <- your Render URL
```

(Local dev auto-uses `http://localhost:3000`; you can also override at runtime
with `localStorage.setItem('mymart.apiBase', '<url>')`.)

## 3. Storefront → Firebase Hosting

```bash
firebase login          # your Google account
firebase deploy --only hosting   # project: ai-mini-mart (.firebaserc)
```

Live at `https://ai-mini-mart.web.app` (and `…firebaseapp.com`).

## 4. Allow the storefront origin (CORS)

In Render → `ai-mini-mart-api` → Environment, set:

```
CORS_ORIGIN = https://ai-mini-mart.web.app,https://ai-mini-mart.firebaseapp.com
```

Save (the service redeploys). The storefront feed now loads cross-origin.

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
