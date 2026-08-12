# NRSA / S.T.A.R. View — Claude project pointers

What Claude can't guess about this repo. Standard TS/ES-modules conventions,
API endpoints, and file-by-file walk-throughs aren't here — grep the code
for those.

## What this is

CMT (Crisis Management Team) dashboard for New Relic. Pulls 11 hazard feeds
into a Leaflet map, surfaces alerts by proximity to offices/travelers, and
supports Crisis Comms sends + BCI (Business Continuity Incident)
declarations. Backend (Fastify + Postgres) + frontend (vanilla ES modules +
Leaflet) live in the same repo. Prototype for a design review, not a
production deployment.

## Local runtime layout

- **Postgres.app** in the menu bar → `localhost:5432`, DB `nrsa`, user/pw `nrsa/nrsa`
- **Backend** at `:8080` (launchd-supervised — `ops/com.newrelic.nrsa-backend.plist`)
- **Frontend** at `:8000` (launchd-supervised — `ops/com.newrelic.nrsa-frontend.plist`)
- **Login (local DB):** `kcheyne@newrelic.com` / `YourChoice` (see `nrsa_local_ops` memory for how it got there)

Both LaunchAgents auto-start at login. After `.env` changes, kickstart to
pick them up. Frontend needs no kickstart for HTML/JS/CSS edits — just
refresh the browser.

## Bash commands that matter

```bash
# Restart backend to pick up backend/.env changes
launchctl kickstart -k gui/$(id -u)/com.newrelic.nrsa-backend

# Restart frontend
launchctl kickstart -k gui/$(id -u)/com.newrelic.nrsa-frontend

# Backend health
curl -s http://localhost:8080/api/health

# Data freshness diagnostic
psql postgres://nrsa:nrsa@localhost:5432/nrsa -c \
  "SELECT primary_source_id, COUNT(*) FILTER (WHERE NOT is_stale) AS active,
   MAX(issued_at) AS newest, NOW() - MAX(issued_at) AS age
   FROM events GROUP BY primary_source_id ORDER BY active DESC;"

# Playwright smokes (from repo root)
cd tests && npm test

# Manual smoke-incident cleanup (fallback if afterAll didn't fire)
bash tests/scripts/cleanup-smoke-incidents.sh   # dry-run by default; flip
                                                # ROLLBACK→COMMIT in the .sql
                                                # for a real delete

# TypeScript check backend-side
cd backend && npx tsc --noEmit

# Lint frontend
npm run lint    # from repo root
```

## URL modes — dashboard has three

- `localhost:8000`                  — live mode, backend at :8080, real data
- `localhost:8000/#api=mock`        — mock mode, demo cycler + fake people-data
- GitHub Pages (kcheyne-dev.github.io/...) — bare static, seed alerts only

The hash mode is sticky within a tab. If the dashboard is showing mock data
when you expect live, check the URL bar for `#api=mock`.

## MeteoAlarm — two providers via config-flip

```
METEOALARM_PROVIDER=meteoalarm-direct    # default; api.meteoalarm.org/edr/v1
METEOALARM_PROVIDER=meteogate            # fallback; api.meteogate.eu
METEOALARM_TRANSPORT=rest|mqtt|both      # default rest; MQTT optional
METEOALARM_BASE_URL_OVERRIDE=<url>       # optional staging override
```

Full comparison: `docs/meteoalarm-direct-vs-meteogate.md`. Response shape is
byte-for-byte compatible between the two REST providers — swap is a config
flip, not an adapter change.

## Frontend must be served via `http://`

Chrome blocks ES modules from null origin, so `file://` breaks the app.
Always serve via `python3 -m http.server` (launchd handles this) or any
static server on `:8000`.

## Architectural gotchas

1. **Bridge pattern at `js/legacy-app.js:425`** — `Object.assign(window, {...})`
   MUST run before render.js function calls further down the file. See
   `bridge_cleanup` memory for the story of why. Moving it later breaks
   boot because render fns look up `window.map` / `window.layers`.
2. **`state.UI_STATE.outbox` persists via `saveState`.** Attachments in
   `apiPayload` are stripped via `_stripOutboxAtts` in `persistence.js` so a
   few queued failed sends don't blow the localStorage quota.
3. **Failed-outbox concurrency guard**: `retryEntry` early-returns when
   `entry.status === 'retrying'`. Prevents duplicate POSTs if auto-retry
   and manual retry fire simultaneously.
4. **Idempotent persist** in `pipeline/persist.ts`: upsert on
   `(source_id, source_event_id)`. Same alert arriving via REST + MQTT
   dedupes automatically — last write wins.
5. **MeteoAlarm bbox math doesn't handle anti-meridian wrap.** Europe-only,
   safe today. Add a wrap check before reusing for Pacific / global data.
6. **DB migrations are append-only.** Never delete files in
   `backend/migrations/`, even for archived adapters (see
   `006_acled.sql` — kept even though the adapter was removed 2026-07-13).

## Testing

- **Playwright** in `tests/e2e/` — 3 specs, 6 tests, ~25s when healthy:
  - `proximity-detection.spec.ts` — Q1/Q2 relevance-tier math (mock mode)
  - `smoke-crisis-comms.spec.ts` — full round-trip: login → send → close → reopen
  - `outbox.spec.ts` — force-fail POST /api/comms, verify enqueue/retry/dismiss
- `afterAll` hooks in each spec purge its RUN_ID rows via psql (see
  `tests/e2e/lib/cleanup-run-id.ts`). Failing psql is non-fatal.
- No formal backend unit tests. Playwright is the safety net. Code reviews
  via `Agent(subagent_type: general-purpose, ...)` after substantive commits
  have proven to catch real bugs multiple times (outbox persistence gap,
  MeteoAlarm cleanup drift).

## Working style — user preferences

- **Minimal formatting.** No bullet-heavy responses unless the content
  genuinely benefits from it. Prose > bullets.
- **No emojis** in code, commits, docs, or chat unless explicitly asked.
- **No "AI-generated" markers** in commit messages or code comments. Commits
  read like a human wrote them.
- **Independent code review** via subagent after any substantive commit.
  Delegate with `Agent(subagent_type: general-purpose, ...)`, ask for a
  punch list ordered by severity. Real value has been demonstrated.
- **Verify with real tests.** Playwright, node --check, npm run lint after
  every commit. "Looks right" is not a success criterion.
- **Task tracking.** Use `TaskCreate` for multi-step work; keep task
  descriptions rich enough that a future session can pick up where this
  one left off.

## Commit conventions

- Author: `kcheyne-dev <kcheyne@newrelic.com>` (see the `-c` flags in prior
  commits — Claude sessions don't have git config set up)
- Push happens on user's Mac only. Sandbox can't reach GitHub SSH.
- Long, detailed commit messages. Explain the WHY, list the concrete
  file changes, note verification steps. The commit log is the primary
  historical record of design decisions.

## Memory (Cowork auto-memory system)

Persists across sessions at
`~/Library/Application Support/Claude-3p/local-agent-mode-sessions/*/spaces/*/memory/`.
Key files:
- `MEMORY.md` — index; one line per memory
- `project_nr_safety_alerts.md` — dashboard overview + module structure
- `nrsa_local_ops.md` — creds, restart runbook, browser recovery
- `meteogate_api.md` — MeteoGate API reference notes
- `bridge_cleanup.md` — the full ES-module migration story
- `failed_outbox.md` — outbox architecture + persistence hotfix history

## In-repo docs

- `docs/data-sources.md` — every external source, ToS class, and § 7
  archived sources (ACLED / GDELT / PDX FlashAlert / OSAC)
- `docs/severity-thresholds.md` — per-source severity rules
- `docs/meteoalarm-direct-vs-meteogate.md` — MeteoAlarm provider comparison
- `docs/action-plan-2026-06-19.md` — post-review action plan (mostly closed)
- `ops/README.md` — launchd runbook for backend + frontend

## When something is broken

- **Backend down.** `curl http://localhost:8080/api/health` should return
  `{"ok":true,...}`. If not, `launchctl kickstart -k gui/$(id -u)/com.newrelic.nrsa-backend`,
  then check `~/Library/Logs/nrsa-backend.log`.
- **Frontend down.** `lsof -i :8000 -sTCP:LISTEN` should show a Python
  process. If not, `launchctl kickstart -k gui/$(id -u)/com.newrelic.nrsa-frontend`.
  If it still won't start, check `~/Library/Logs/nrsa-frontend.error.log` —
  most common failure is macOS TCC blocking python3 from reading
  `~/Documents/` (fix: grant `/usr/bin/python3` Full Disk Access).
- **Data feels stale.** Run the psql diagnostic above. `time_since_newest`
  in days = adapter issue; hours = quiet weather (plausible). Log lines
  `<source>.persisted` confirm the poll is firing regardless of new-event
  count.
- **Playwright red across the board.** Usually the backend or frontend
  isn't running. Fix those first, then rerun.

## Not applicable to this project

- No Kubernetes, containers, CI/CD, or production deployment (local dev only)
- No secrets manager. `backend/.env` is gitignored; tokens live there
- No formal design system on the frontend (vanilla CSS + one-off styles)
