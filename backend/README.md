# NR Safety Alerts — Backend (Sprint 1)

Real-time alert ingestion + REST API for the CMT Dashboard. This Sprint 1 build ships:

- **Two live sources**: USGS earthquakes (1-min cadence) and NWS weather alerts (5-min cadence).
- **Postgres + PostGIS** for event storage with spatial queries.
- **Office proximity matching**: every ingested alert is stamped with the IDs of any NR offices within a category-default radius.
- **Fastify REST API** at `/api/events`, `/api/events/:id`, `/api/sources/health`, `/api/health`.
- **In-process scheduler** that runs the ingestion adapters on their declared intervals.

## Stack

- Node 20+ / TypeScript / ESM
- Fastify (HTTP) + node-cron-style intervals (workers)
- PostgreSQL 16 with PostGIS extension
- pino (logging), zod (validation), pg (driver)

## Run it locally (5-min path)

```bash
cd backend
cp .env.example .env

# 1. Bring up the database
docker compose up -d
# Wait ~5s for the healthcheck to pass

# 2. Install + migrate + seed
npm install
npm run migrate          # creates schema + seeds the 9 NR offices

# 3. Run the dev server (API + scheduler in one process)
npm run dev
```

You should see logs like:

```
INFO  db.connected
INFO  api.listening :8080
INFO  source.scheduled  source=usgs intervalSeconds=60
INFO  usgs.persisted    fetched=42 inserted=42 updated=0 skipped=0
```

Hit the API:

```bash
curl http://localhost:8080/api/health
curl 'http://localhost:8080/api/events?minSev=high&limit=20'
curl http://localhost:8080/api/sources/health
```

## Wiring the dashboard to this backend

In `index.html`, the prototype currently has a hardcoded `ALERTS` array. To swap in live data:

```js
// Replace the const ALERTS = [...] block with:
let ALERTS = [];
async function refreshAlerts() {
  const resp = await fetch('http://localhost:8080/api/events?limit=200');
  const data = await resp.json();
  ALERTS = data.events.map(e => ({ ...e, sev: e.sev, officeId: e.officeId }));
  renderAll();
}
refreshAlerts();
setInterval(refreshAlerts, 60000);
```

(In Sprint 3 we replace this polling with Server-Sent Events.)

## Adding a new source

1. Create `src/adapters/<id>.ts` exporting a `SourceAdapter`. Use `usgs.ts` as the template.
2. Insert a row in the `sources` table (or add to `migrations/001_init.sql`).
3. Register in `src/workers/scheduler.ts` `ADAPTERS` array.
4. Restart `npm run dev`. New source begins ingesting immediately on boot.

## Architecture pointers

- `src/config.ts` — env-driven config
- `src/db.ts` — pg pool + transaction helper
- `src/types.ts` — `NormalizedEvent`, `SourceAdapter`, `ApiEvent` contracts
- `src/adapters/` — one file per source, implements `SourceAdapter`
- `src/pipeline/persist.ts` — writes raw + normalized + matches offices
- `src/workers/scheduler.ts` — runs adapters on their intervals
- `src/routes/` — HTTP endpoints
- `migrations/` — versioned SQL
- `seeds/` — static reference data (offices)

## Project conventions

- **Severity** is always `'low' | 'mod' | 'high' | 'ext'`. Adapters map source-specific scales to this.
- **Office matching** uses PostGIS `ST_DWithin`. Default per-category radii live in `pipeline/persist.ts` and can be overridden per event when the source publishes one (e.g. USGS magnitude → felt radius).
- **Idempotency**: every adapter's events are upserted on `(source, source_event_id)`. Re-running ingestion is safe and cheap.
- **Audit**: `raw_events` keeps the original payload of every ingested item, forever (until you decide to truncate). Nothing is lost; reprocessing is possible by replaying.

## What this DOESN'T do yet (Sprint 2+)

- Cross-source deduplication (USGS + EMSC + GDELT publishing the same quake → one event, not three)
- Server-Sent Events streaming (currently the dashboard would poll)
- Geocoding via Nominatim (only sources that publish lat/lng work today)
- Auth / Okta SSO
- Incident persistence on the server (still in dashboard localStorage)
- Automated stale-event sweeper (24h TTL)
- Source health alerting via PagerDuty / email

These are Sprints 2-5 in the build plan.

## Cost to run

- Dev: free (Docker on a laptop)
- Production: ~$10-30/month on a single Hetzner / Fly.io / Railway box. Postgres can be Neon's free tier for the first 90 days of a real deployment.

## Hand-off checklist for the engineer picking this up

- [ ] Read this README + `src/types.ts` for the contracts
- [ ] Run `docker compose up -d && npm install && npm run migrate && npm run dev` — verify USGS data appears
- [ ] Open `src/adapters/usgs.ts` — that's the template for everything else
- [ ] Pick the next adapter (NASA EONET is the easiest second add) and implement
- [ ] Write a fixture-based test for it under `src/adapters/__tests__/`
- [ ] Add a migration for any new source rows or schema changes
