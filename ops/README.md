# NRSA ops artifacts

Machine-specific deployment files that live outside the runtime code.
Currently: launchd LaunchAgents keeping the backend and frontend alive.

## Backend uptime — launchd LaunchAgent

**Problem this solves:** the backend runs via `npm run dev` in an
interactive terminal. Terminal close, Ctrl-C, Mac sleep for hours, or
terminal crash silently kills the backend. Twice the outage went
unnoticed for 4 days (2026-06-10 and 2026-07-03) — 8 days of missed
alerts total.

**Solution:** register the backend as a launchd LaunchAgent with
`KeepAlive=true`. On any process exit, launchd waits 10 seconds then
restarts. On user login, `RunAtLoad` starts it fresh.

**Architectural note — `start:launchd` vs `dev`:** the LaunchAgent
invokes `npm run start:launchd`, which runs `tsx src/server.ts`
*without* the `--watch` flag. Watch mode is fragile under supervision:
when its child crashes, `tsx watch` may hang as a zombie parent
instead of exiting, defeating `KeepAlive` (launchd only restarts when
the top-level process dies). Watch mode remains available for
interactive dev via `npm run dev`, which you'd run manually in a
terminal for hot-reload during coding. Under launchd, we want plain
single-process supervision — `npm run start:launchd` — with manual
`launchctl kickstart` to pick up code changes.

**Complementary signal** (shipped separately, commit `f2b5d57`): the
freshness banner in the dashboard shows a red pulsing bar when the
last successful `/api/events` fetch is > 5 minutes old. Two layers of
defense — launchd self-heals, banner tells the operator if launchd
somehow failed too.

### Install

One-time setup on this Mac:

```bash
# Copy the plist into the LaunchAgents directory
cp "ops/com.newrelic.nrsa-backend.plist" ~/Library/LaunchAgents/

# Stop any manually-running backend first
kill $(lsof -i :8080 -sTCP:LISTEN -t) 2>/dev/null

# Load the agent — starts the backend immediately due to RunAtLoad
launchctl load ~/Library/LaunchAgents/com.newrelic.nrsa-backend.plist

# Verify it's listening
lsof -i :8080 -sTCP:LISTEN
```

Expected output: one `node` or `npm` process bound to `:8080`.

### Verify recovery works

Kill the backend process and confirm launchd restarts it within ~10s:

```bash
kill $(lsof -i :8080 -sTCP:LISTEN -t)
sleep 12
lsof -i :8080 -sTCP:LISTEN    # should still show a process (different PID)
```

If launchd is working, this returns a process on the second `lsof`.

### Watch logs

Real-time log tail (Pino pretty output):

```bash
tail -f ~/Library/Logs/nrsa-backend.log
```

Error stream separately:

```bash
tail -f ~/Library/Logs/nrsa-backend.error.log
```

### Uninstall / disable

If launchd is causing problems and you want to go back to manual
`npm run dev`:

```bash
launchctl unload ~/Library/LaunchAgents/com.newrelic.nrsa-backend.plist

# Optional: remove the installed file entirely
rm ~/Library/LaunchAgents/com.newrelic.nrsa-backend.plist
```

Then `npm run dev` in `backend/` as before.

### Troubleshooting

**Backend won't start under launchd:**

1. Check the error log: `tail -50 ~/Library/Logs/nrsa-backend.error.log`
2. Common causes:
   - **Postgres.app not running yet.** The backend needs Postgres up first.
     Postgres.app has its own LaunchAgent that starts on login; usually races
     ok, but if launchd starts backend first, it'll fail and retry via
     KeepAlive until Postgres is ready. Should converge within a minute.
   - **PATH issue.** `npm` needs `node` on PATH. The plist sets
     `PATH=/opt/homebrew/bin:...` — confirm your npm is at `/opt/homebrew/bin`
     with `which npm`. If it's elsewhere, edit the plist and reload.
   - **backend/.env missing.** dotenv loads from cwd; if `.env` is absent,
     the backend logs `no_api_key` warnings for MeteoGate and possibly
     others but should still boot.

**launchd is spinning (restart every 10s):**

That means the backend is crashing on startup. Check
`~/Library/Logs/nrsa-backend.error.log` for the crash reason. Common
culprit: DATABASE_URL env var missing or Postgres unreachable. Unload
the agent, fix the config, reload.

**Reload after editing the plist:**

```bash
launchctl unload ~/Library/LaunchAgents/com.newrelic.nrsa-backend.plist
cp "ops/com.newrelic.nrsa-backend.plist" ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.newrelic.nrsa-backend.plist
```

**Pick up backend code changes OR `.env` changes** (without a plist change):

`start:launchd` doesn't watch files, and `dotenv/config` reads `backend/.env`
once at process startup. Either kind of change (`.ts` edit or new/edited
`.env` var like `METEOALARM_PROVIDER=meteoalarm-direct`) requires a
supervised restart:

```bash
launchctl kickstart -k gui/$(id -u)/com.newrelic.nrsa-backend
```

The `-k` flag kills the running process first, then relaunches. Log
tail should show a fresh `db.connected` within ~15s, then look for
`meteoalarm.cycle.start` to confirm any provider flip took effect.

If you're actively iterating on backend code, temporarily unload the
LaunchAgent and use `npm run dev` in a terminal (with `tsx watch`) —
that gives you hot-reload without touching launchd every save.

### Deploying on a different Mac

The plist bakes in machine-specific paths. If you set up NRSA on
another machine:

1. Confirm npm/node paths: `which npm && which node`
2. Confirm architecture / homebrew prefix: `uname -m && brew --prefix`
3. Edit the plist's `ProgramArguments`, `WorkingDirectory`,
   `EnvironmentVariables.PATH`, and log paths to match
4. Then follow the install steps above

---

## Frontend uptime — launchd LaunchAgent

**Problem this solves:** the frontend runs via `python3 -m http.server 8000`
in an interactive terminal. Terminal close, Ctrl-C, or Mac restart drops
the server and `http://localhost:8000/` returns nothing. Recurring
friction in the 2026-07 and 2026-08 sessions — the backend recovered
via its own LaunchAgent but the frontend didn't, so the dashboard was
half-broken after every reboot.

**Solution:** register the frontend as a launchd LaunchAgent with
`KeepAlive=true`, same pattern as the backend. On any process exit,
launchd waits 10 seconds then restarts. On user login, `RunAtLoad`
starts it fresh.

**Note on trade-offs:** unlike the backend, the frontend has no
build-step or dependencies (python3 http.server is stdlib), so there's
no "watch mode" analog. If you're editing HTML/JS/CSS, just refresh the
browser — the LaunchAgent's copy serves the same on-disk files. No
kickstart needed for frontend code changes.

### Install

One-time setup on this Mac:

```bash
# Copy the plist into the LaunchAgents directory
cp "ops/com.newrelic.nrsa-frontend.plist" ~/Library/LaunchAgents/

# Stop any manually-running http.server first
kill $(lsof -i :8000 -sTCP:LISTEN -t) 2>/dev/null

# Load the agent — starts http.server immediately due to RunAtLoad
launchctl load ~/Library/LaunchAgents/com.newrelic.nrsa-frontend.plist

# Verify it's listening
lsof -i :8000 -sTCP:LISTEN
```

Expected output: one `Python` process bound to `:8000`.

### Verify recovery works

Kill the python3 process and confirm launchd restarts it within ~10s:

```bash
kill $(lsof -i :8000 -sTCP:LISTEN -t)
sleep 12
lsof -i :8000 -sTCP:LISTEN    # should still show a process (different PID)
```

### Watch logs

Every browser request lands in the error log (python3 http.server logs
to stderr by design — quirky, but it's not real errors). Useful for
confirming a fresh boot actually serves traffic:

```bash
tail -f ~/Library/Logs/nrsa-frontend.error.log
```

The `.log` (stdout) file will mostly be empty — python3 http.server
doesn't print to stdout.

### Uninstall / disable

If you want to go back to manual `python3 -m http.server`:

```bash
launchctl unload ~/Library/LaunchAgents/com.newrelic.nrsa-frontend.plist
rm ~/Library/LaunchAgents/com.newrelic.nrsa-frontend.plist
```

Then start it manually from the repo root when needed.

### Troubleshooting

**Port 8000 already in use:** if you had a manual `python3 -m http.server`
running when you loaded the LaunchAgent, `launchctl` won't kill the
existing process — it'll just fail silently. Check with
`lsof -i :8000 -sTCP:LISTEN`, kill any lingering process, then reload.

**Not picking up file changes:** the LaunchAgent serves whatever is on
disk at request time. No caching, no build step. If a hard refresh
(Cmd-Shift-R) doesn't show your changes, verify you edited the right
file (repo root, not a nested copy).

**Python version issues:** the plist uses `/usr/bin/python3` (the
macOS Command Line Tools' python3, always present). If your machine's
`/usr/bin/python3` is missing, install Xcode Command Line Tools:
`xcode-select --install`.
