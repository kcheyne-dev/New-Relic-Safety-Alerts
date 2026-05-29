# NR Safety Alerts — Backend

Real-time alert ingestion + REST API for the CMT Dashboard.

## What's in this build (Sprints 1–5)

**12 live sources** with auto-ingestion:

| Source | Cadence | Format | Notes |
|---|---|---|---|
| USGS Earthquakes | 60s | GeoJSON | M4.5+ globally; magnitude → severity |
| NWS Active Alerts (US) | 5m | GeoJSON | Severity = Minor/Moderate/Severe/Extreme |
| NASA EONET | 10m | JSON | Wildfires, storms, volcanoes, floods globally |
| GDACS | 10m | GeoJSON | UN multi-hazard with Green/Orange/Red severity |
| EMSC | 5m | GeoJSON | European seismic; faster than USGS for EU |
| MeteoAlarm | 15m | Atom XML | EU weather warnings color-coded; geocoded by area |
| US State Dept | 24h | RSS XML | Travel advisories L1–L4 by country |
| **SF Police (Socrata)** | 10m | JSON | Local incidents within 10km of SFO |
| **Atlanta APD (ArcGIS)** | 15m | JSON | Local incidents within 8km of ATL |
| **Portland FlashAlert** | 10m | RSS XML | Public-safety announcements PDX area |
| **London TfL** | 10m | JSON | Transit disruptions for LON |
| **GDELT 2.0** | 15m | JSON | Global news with theme + tone filtering (civil unrest, terror, evac) |

- **Cross-source clustering**: USGS + EMSC + GDACS publishing the same Tokyo quake within 30 min and 25 km gets folded into ONE event. The cluster keeps the highest-severity primary source; all contributing sources are listed in `contributing_sources`.
- **Centralized severity normalization** (`pipeline/severity.ts`): one place where every source's scale is mapped to canonical Low/Mod/High/Ext.
- **Postgres + PostGIS** for event storage with spatial queries.
- **Office proximity matching**: every ingested alert is stamped with the IDs of NR offices within a category-default radius.
- **Geocoding layer**: cache-backed Nominatim with 1 req/sec throttle.
- **Fastify REST API** at `/api/events`, `/api/events/:id`, `/api/sources/health`, `/api/health`.
- **Server-Sent Events** at `/api/events/stream` — dashboard subscribes and gets pushes on every new/updated event. No polling.
- **In-process scheduler** with stagger-on-boot to avoid thundering-herd fetches.
- **Stale-event sweeper** (`workers/sweeper.ts`): runs every 30 min; flags non-travel events older than 24h or past their `expires_at` as `is_stale=true`. The default `/api/events` query filters them out.
- **Source-health monitor + webhook alerts** (`workers/health_check.ts` + `notifications/webhook.ts`): every 5 min checks for sources that haven't fetched successfully in >30 min. Auto-detects Slack / PagerDuty / generic webhook from `WEBHOOK_URL`. Throttled per-source so you don't get repeat pages.
- **Optional self-hosted Nominatim** (`docker compose --profile geocode up -d`) for unlimited-volume geocoding without rate limits or third-party dependencies.
- **Server-side incidents** with full CRUD: `POST /api/incidents`, `POST /api/incidents/:id/messages`, `PUT /api/incidents/:id/responses/:employeeId`, `POST /api/incidents/:id/notes`, `POST /api/incidents/:id/close`, `POST /api/incidents/:id/reopen`. Incidents now persist in Postgres instead of dashboard localStorage.
- **JWT auth + role-based access**: `admin > cmt > office > employee`. Login via `POST /api/auth/login`, returns a Bearer token. Routes use `requireAuth` and `requireRole('cmt')` Fastify hooks. Okta migration is a single-function swap in `auth/jwt.ts` — see "Okta migration path" below.
- **Append-only audit log**: every authenticated mutation writes to `audit_log` with user_id, action, target, IP, user-agent, payload. Compliance-ready.

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

## Wiring the dashboard to live data via SSE

In `index.html`:

```js
// Replace the const ALERTS = [...] block with:
let ALERTS = [];

// Initial backfill on load
async function initialBackfill() {
  const resp = await fetch('http://localhost:8080/api/events?limit=500');
  const data = await resp.json();
  ALERTS = data.events;
  renderAll();
}

// Live stream — pushed every time the backend ingests
function subscribeStream() {
  const es = new EventSource('http://localhost:8080/api/events/stream');
  es.addEventListener('event', (msg) => {
    const data = JSON.parse(msg.data);
    if (data.kind === 'new' && data.event) {
      // De-dup against current array on id
      ALERTS = [data.event, ...ALERTS.filter(a => a.id !== data.event.id)];
      renderAll();
      toast(`New alert: ${data.event.title}`);
    } else if (data.kind === 'updated' && data.event) {
      ALERTS = ALERTS.map(a => a.id === data.event.id ? data.event : a);
      renderAll();
    }
  });
  es.onerror = () => console.warn('SSE disconnected; will auto-reconnect');
}

initialBackfill();
subscribeStream();
```

Browser `EventSource` auto-reconnects on disconnect. No polling, no polling jitter.

## Webhook configuration examples

**Slack** — paste your incoming webhook URL into `WEBHOOK_URL`:
```
WEBHOOK_URL=https://hooks.slack.com/services/T0000000/B0000000/abc123
```
Alerts will appear in the channel as severity-tinted attachments with an "Open" button.

**PagerDuty** — Events API v2:
```
WEBHOOK_URL=https://events.pagerduty.com/v2/enqueue
PAGERDUTY_ROUTING_KEY=R00000000000000000000000000
```
"Source down" creates an incident with severity=warning and dedup_key=`source-down-{id}`. Recovery resolves it.

**Generic** — any URL that accepts POST + JSON:
```
WEBHOOK_URL=https://hooks.your-internal-tool.com/safety-alerts
```
Receives `{ title, body, severity, dedupKey, link }`.

**Empty** — pure log-only mode, no outbound (default):
```
WEBHOOK_URL=
```

## Self-hosted geocoding

The default config uses the **public Nominatim** service at openstreetmap.org. It's free, but rate-limited to 1 req/sec and asks you not to use it for high-volume production. We honor that.

For real production, run your own:

```bash
# Pick your region first by setting PBF_URL in .env (or accept the small Liechtenstein default for testing):
# PBF_URL=https://download.geofabrik.de/north-america-latest.osm.pbf

# Bring up Postgres + Nominatim
docker compose --profile geocode up -d

# First boot will download + import the OSM extract. This takes ~30 minutes for
# a small region, ~12 hours for the planet. Monitor with:
docker compose logs -f nominatim

# Once "Nominatim is ready" appears, set in .env:
NOMINATIM_URL=http://localhost:7070/search
```

After that, `pipeline/geocode.ts` will hit your local instance — no rate limits, no third-party dependency.

## Auth — quick start

Create your first admin user (after `npm run migrate`):

```bash
npm run create-user -- --email=admin@newrelic.com --password='ChangeMe123!' --role=admin --name="Admin"
```

Login:

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@newrelic.com","password":"ChangeMe123!"}'
# → { "token": "eyJhbGc...", "user": { ... } }
```

Use the token in subsequent requests:

```bash
TOKEN=eyJhbGc...
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/incidents
```

### Roles

| Role | Can do |
|---|---|
| `admin`    | everything |
| `cmt`      | create/close/reopen incidents, send crisis messages |
| `office`   | log responses (OK/Help) on existing incidents |
| `employee` | read-only |

### Okta migration path

When you're ready to swap our locally-issued JWTs for Okta SSO:

1. Set in `.env`:
   ```
   OKTA_ISSUER=https://yourorg.okta.com/oauth2/default
   OKTA_AUDIENCE=api://nr-safety-alerts
   OKTA_JWKS_URI=https://yourorg.okta.com/oauth2/default/v1/keys
   ```
2. Add `jwks-rsa` to `package.json`.
3. Replace the body of `verifyToken()` in `src/auth/jwt.ts` with a JWKS-based verifier (about 15 lines).
4. The dashboard's login page becomes an Okta OIDC redirect instead of email+password — you'll add `/auth/callback` route to handle the code exchange.

Everything else (incident routes, role checks, audit log) stays untouched. The token's `sub`/`email`/`role` claims continue to drive RBAC; you map Okta groups → roles in step 3.

## What this DOESN'T do yet (Sprint 6+)

- **Slack outbound bot** — actually send Crisis messages to Slack channels (currently they're just stored).
- **Email outbound** — Gmail / SendGrid integration to actually send the email channel.
- **Workday employee directory sync** — replace mock employees with real ones.
- **Incident persistence on the server** — still in dashboard localStorage. Sprint 5 migrates incidents/responses/messages to Postgres.
- **Automated stale sweeper** — events older than 24h should be flagged. Sprint 4.
- **Source health alerting** — push to PagerDuty/email when a feed has been down >30 min. Sprint 4.
- **GDELT + ACLED** — heaviest filtering work; Sprint 4.

## Geocoding

- For sources that publish a place name without coordinates (MeteoAlarm, State Dept), the persist pipeline calls `pipeline/geocode.ts` before insert.
- Lookups are cached in Postgres (`geocode_cache` table). TTL: 180 days for hits, 24h for misses.
- The **public Nominatim service** is rate-limited to 1 req/sec. We honor that with both a server-side throttle and the cache. For commercial-volume operation, run your own Nominatim Docker container — the only change needed is `NOMINATIM_URL=http://localhost:7070/search` in `.env`.

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
