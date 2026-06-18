# NRSA Smoke Harness

Playwright-driven end-to-end smoke test for NRSA (S.T.A.R. View). Catches regressions across the boot → login → backfill → alert click → Crisis Comms → message send → Postgres round-trip → render flow. Designed as a confidence gate before any non-trivial frontend or backend change — and as the safety net under the planned frontend modularization.

## What it covers

A single comprehensive happy-path test in `e2e/smoke-crisis-comms.spec.ts`:

1. **Boot + login.** Navigates to the frontend, fills the login modal (or skips if a JWT is already in localStorage).
2. **Backfill.** Asserts at least one alert appears in the feed within 15s.
3. **Status strip "Last fetch" chip** turns green.
4. **Alert click.** First alert card gains the `selected` class.
5. **Crisis Comms rail toggle.** Panel uncollapses, Compose tab is active by default.
6. **Real-message send.** Picks an office, types a body tagged with the run ID, hits Send. Auto-creates a real incident.
7. **Round-trip 1.** Fetches the new incident from `/api/incidents/:id` and asserts the message persists with `is_test=false`.
8. **Unlink + test-mode toggle.** Clicks Unlink; the test-mode row appears; checks the box; Send button label flips to the test variant.
9. **Test-message send.** Picks an office, types a body, hits Send.
10. **Round-trip 2.** Fetches the new incident; message has `is_test=true`, subject prefixed with `[TEST]`, body contains the drill-warning preamble.
11. **Render verification.** Test incident card shows the 🧪 badge; Comms-tab message has the cyan tint and the inline TEST badge; the real incident card does **not** have the test badge.

If any of these fails, the regression is real. False failures in this harness are usually environmental — see the troubleshooting list below.

## Preconditions

These must be true before `npm test`:

- **Postgres + backend** running at `http://localhost:8080`. Migration 008 applied (`is_test` column on `crisis_messages`):
  ```
  psql postgres://nrsa:nrsa@localhost:5432/nrsa -c "\d crisis_messages" | grep is_test
  ```
- **Frontend** served at `http://localhost:8000` (typically `python3 -m http.server 8000` from the repo root).
- **A test user** exists in the local DB:
  - `kcheyne@newrelic.com` / `YourChoice` (default — set via `npm run create-user` from `backend/`).
- **At least one event** in the database. Any backend adapter polling for ~a minute is enough — USGS reliably populates inside 60s.

Override the URLs / credentials if your local setup differs:

```bash
NRSA_FRONTEND_URL=http://localhost:8000 \
NRSA_API_URL=http://localhost:8080 \
NRSA_USER_EMAIL=kcheyne@newrelic.com \
NRSA_USER_PASSWORD=YourChoice \
  npm test
```

## First-time setup

```bash
cd tests
npm install
npx playwright install chromium       # ~200MB browser download
```

## Running

```bash
npm test                  # headless, full smoke, 1 worker
npm run test:headed       # see the browser drive itself — useful for debugging
npm run test:debug        # step through interactively (PWDEBUG=1)
npm run report            # open the HTML report from the last run
```

A passing run prints a single ✓ line at the end with the two incident IDs the harness created.

## Cleanup

The smoke harness creates **real incidents** in your dev database (per the design decision: standalone test sends create real incidents with a flagged message inside). Each incident's title is prefixed with `smoke-<timestamp>` so they're easy to identify and prune.

```bash
npm run cleanup
```

This runs `psql ... < scripts/cleanup-smoke-incidents.sql`. The script default-rolls-back so the first run is a dry run; flip `ROLLBACK` → `COMMIT` on the last line of the SQL file to actually delete.

## Troubleshooting

If the harness fails, start here:

| Failure | Most likely cause |
|---|---|
| `JWT should be in localStorage after login` | Wrong credentials, or the user doesn't exist. Run `npm run create-user` from `backend/`. |
| `at least one alert should backfill` | No events in the DB yet, or the backend isn't running. Check `psql ... -c "select count(*) from events where not is_stale;"`. |
| `Last fetch chip should be visible` | Backend running but `/api/events` is failing — check backend logs. |
| Test fails at `Send button` step | The Compose form isn't binding handlers — usually caused by a JS error earlier in boot. Open `npm run test:headed` and watch the console. |
| `is_test should be false on a real send` | Migration 008 not applied. Apply it: `psql ... -f backend/migrations/008_test_messages.sql`. |
| Test passes but incidents pile up in dev DB | Run `npm run cleanup` and flip `ROLLBACK` → `COMMIT` in the SQL. |

## Caveats

- **This is a smoke test, not exhaustive coverage.** It exercises the load-bearing happy path. Edge cases (failed sends, network drops, malformed inputs, concurrent operators) are not covered.
- **It runs against your dev DB.** Don't point it at production.
- **It requires browsers downloaded** via `npx playwright install`. CI environments need this in their setup step.
- **Adding more cases is encouraged** but mind the scope — the value of a smoke harness is that it stays fast (<60s) and runs every change.
