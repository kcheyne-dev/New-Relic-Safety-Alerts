# New Relic Safety Alerts

Internal Crisis Management Team (CMT) dashboard. Real-time threat monitoring, crisis communications, and incident lifecycle management for New Relic offices and travelers worldwide.

**Live demo:** https://kcheyne-dev.github.io/New-Relic-Safety-Alerts/

## Documentation

The docs are living markdown — edit, commit, push, and the GitHub-rendered version updates within ~30 seconds.

| Doc | Purpose |
| --- | --- |
| [`docs/build-synopsis.md`](./docs/build-synopsis.md) | Comprehensive system synopsis — architecture, what's shipped, what's mock, what's pending. **The doc to share with stakeholders.** |
| [`docs/user-manual.md`](./docs/user-manual.md) | Full operator manual — every feature explained section by section |
| [`docs/quick-reference.md`](./docs/quick-reference.md) | One-page operator card — workflow + keyboard moves + diagnostic queries |
| [`docs/severity-thresholds.md`](./docs/severity-thresholds.md) | Per-source severity rule tables, tuning principle, proximity gate |

Original pre-rebuild HTML docs are preserved for historical reference at `docs/project-overview.html`, `docs/user-manual.html`, `docs/quick-reference.html`. They predate today's threshold work, mock-data gating, Crisis Comm template expansion, Risk Profile, and Live Hazards — treat as historical context, not current truth.

## Three operating modes

The dashboard auto-detects mode from the URL:

| URL | Mode | Data |
| --- | --- | --- |
| `localhost:8000` | **Live** | Real polling from local backend on `:8080`. JWT login required. |
| GitHub Pages bare URL | **Bare Pages** | Static seed alerts only. Clean stakeholder demo. |
| Any URL with `#api=mock` hash | **Demo** | Cycling alerts simulator + full mock people-data. Tabletop exercises. |

## Architecture

**Frontend** is a single-file HTML/JS prototype (`index.html`) deployed via GitHub Pages.

**Backend** is a TypeScript / Fastify / Postgres+PostGIS service in `backend/`. Polls 7 active source feeds (USGS, NWS, EMSC, GDACS, EONET, State Department, ACLED-pending), applies per-source severity threshold rules at ingest time, persists to the DB, and exposes `/api/events` + SSE stream `/api/events/stream` to the frontend. Runs locally via Postgres.app + `npm run dev`. Production hosting (Hetzner / Fly.io / Railway) estimated at $10-30/month.

## Source feeds

| Source | Coverage | Cadence | Status |
| --- | --- | --- | --- |
| USGS | Global earthquakes M4.5+ | 60s | active |
| EMSC | EU seismic | 5min | active |
| NWS | US weather warnings | 5min | active |
| GDACS | Global disasters Orange/Red | 10min | active |
| EONET | NASA wildfires/storms/volcanoes | 10min | active (occasional 503s) |
| State Department | Travel advisories L3+ | 24h | active |
| ACLED | Civil unrest (vetted) | 15min | scaffolded; license pending |
| GDELT | News-mention noise | — | disabled |
| MeteoAlarm | EU weather | — | broken (HTTP 406) |
| TfL | London transit | — | broken (HTTP 400) |
| FlashAlert | Portland public safety | — | broken (HTTP 404) |
| SF Socrata | SF police | — | broken (HTTP 400) |

Severity thresholds in [`docs/severity-thresholds.md`](./docs/severity-thresholds.md). Threshold module in `backend/src/pipeline/thresholds.ts`.

## Pending integrations

- **Workday** → office headcounts, remote employees, country presence verification
- **Navan** → traveler itineraries
- **Okta** → SSO + role-based access (Admin / CMT / Office Manager / Employee)
- **Slack** outbound (programmatic Crisis Comm sends) → inbound (employee OK/HELP capture)
- **Gmail** → email-channel parity with Slack
- **ACLED** commercial license → real civil-unrest historical data

Until each integration lands, the dashboard shows "pending integration" placeholders rather than fake numbers — see [`docs/build-synopsis.md`](./docs/build-synopsis.md) for the full mock-vs-real status table.

## Running locally

Postgres.app must be running. Three terminals:

```bash
# Backend
cd backend && npm run dev

# Frontend
python3 -m http.server 8000

# Scratch — for psql, git, etc.
```

Then open `http://localhost:8000` and log in. Default users in the local DB are `kcheyne@newrelic.com` and `kevin@newrelic.com` with role `cmt`.

To reset a password:

```bash
cd backend && npm run create-user -- --email=<email> --password=<pw> --role=cmt
```

## Stack

- **Frontend:** vanilla HTML/CSS/JS, Leaflet + Leaflet.draw + Leaflet.markercluster (via CDN), CartoDB tiles.
- **Backend:** TypeScript, Fastify, Postgres + PostGIS, Pino logging.
- **Build:** none — frontend has no build step. Backend uses tsx for dev, esbuild for prod (when hosted).

## Repo

`git@github.com:kcheyne-dev/New-Relic-Safety-Alerts.git` — main branch deploys to GitHub Pages within 1-3 minutes of push.

Built with Cowork.
