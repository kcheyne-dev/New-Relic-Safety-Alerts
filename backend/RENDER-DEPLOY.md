# Deploy the backend to Render

Point-and-click deploy using the existing `Dockerfile` and `render.yaml` blueprint. ~10 minutes, no CLI required.

## Prereqs (one-time)

1. Sign up at https://render.com (free; sign in with GitHub for the smoothest path).
2. Authorize Render to read your `kcheyne-dev/New-Relic-Safety-Alerts` repo when prompted.

## Step 1 — Push the new files

From your Mac terminal:

```bash
cd "/Users/kcheyne/Documents/Claude/Projects/New Relic Safety Alerts"
git add backend/render.yaml backend/RENDER-DEPLOY.md
git commit -m "Add Render blueprint"
git push
```

## Step 2 — Create the Blueprint

1. In Render's dashboard click **New +** → **Blueprint**.
2. Pick **New-Relic-Safety-Alerts**.
3. Render reads `backend/render.yaml` and shows what it will create:
   - Web service: `nr-safety-alerts-api` (Docker, free plan)
   - Postgres database: `nr-safety-alerts-db` (free plan)
4. Click **Apply**.

Render now:
- Provisions the Postgres DB (takes ~1 min).
- Builds the Docker image from `backend/Dockerfile`.
- Wires `DATABASE_URL` and generates `JWT_SECRET` automatically.
- Runs `npm run migrate` as the pre-deploy command.
- Starts the service and runs the healthcheck on `/api/health`.

First build takes 4–6 minutes. Watch the logs in the web UI.

## Step 3 — Find the public URL

Once the service shows **Live**, click into `nr-safety-alerts-api`. The URL is at the top, like:

```
https://nr-safety-alerts-api.onrender.com
```

Test it:

```bash
curl https://nr-safety-alerts-api.onrender.com/api/health
# → {"ok":true,"ts":"..."}
```

(First request after idle may take ~30s — Render free tier sleeps the service after 15 min of inactivity.)

## Step 4 — Create your admin user

Render's free tier doesn't have an SSH console, so we use the one-shot **Shell** in the web UI:

1. In the service page, click the **Shell** tab.
2. Run:

```bash
npm run create-user -- --email=admin@newrelic.com --password='ChangeMe123!' --role=admin --name='Kevin Cheyne'
```

(If Shell isn't available on free plan, use the alternative below.)

**Alternative: seed via migration.** Add a one-time SQL migration that inserts your admin row. Tell me if you need this and I'll write it.

## Step 5 — Verify scrapers

Wait ~2 min for the worker loop to do its first pass, then:

```bash
curl https://nr-safety-alerts-api.onrender.com/api/sources/health | jq
# Should list 12 sources, each with ok/stale/error status

curl https://nr-safety-alerts-api.onrender.com/api/events?limit=5 | jq
# Should return 5 real events from USGS/NWS/EONET/etc.
```

## Step 6 — Lock down CORS

Once verified, in Render's web UI:

1. Service → **Environment** tab.
2. Edit `CORS_ORIGIN` to `https://kcheyne-dev.github.io`.
3. Click **Save**. Render auto-redeploys.

## Step 7 — Tell me the URL

Send me the `*.onrender.com` URL and I'll:
- Set `const API_BASE = '<your URL>';` in `index.html`.
- Push the dashboard update.
- The Pages site flips from mock data to live scraper data on next reload.

## Free-tier reality check

| Resource | Free tier | After free expires |
|---|---|---|
| Web service | Free, sleeps after 15 min idle | Stays free; upgrade to $7/mo Starter for always-on |
| Postgres | Free for 90 days | $7/mo Basic, OR delete + recreate before day 90 |
| Bandwidth | 100GB/mo | Plenty for our scale |

So you get ~3 months free, then either pay $7/mo for Postgres or rotate the DB.

## Operational tips

- **Logs**: Service → **Logs** tab (live tail).
- **Manual deploy**: **Manual Deploy** button → **Deploy latest commit**.
- **Roll back**: **Events** tab → find the old deploy → **Redeploy**.
- **Scale up**: Service → **Settings** → **Instance Type** → Starter ($7/mo, no sleep).
- **DB backups**: free plan has daily snapshots; Settings → **Backups** to download.
