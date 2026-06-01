# Deploy the backend to Fly.io

End-to-end guide. ~15 minutes once you have the prereqs.

## Prereqs (one-time)

1. **Sign up for Fly.io** — https://fly.io/app/sign-up. Free tier; credit card may be required for verification but you won't be charged at our scale.
2. **Install the flyctl CLI** on your Mac:
   ```bash
   brew install flyctl
   fly auth login
   ```
3. **Make sure Docker Desktop is running** — Fly builds the image locally before pushing.

## Step 1 — Launch the app

From the project root:

```bash
cd "/Users/kcheyne/Documents/Claude/Projects/New Relic Safety Alerts/backend"
fly launch --no-deploy
```

`fly launch` will:
- Detect the `fly.toml` we already created
- Ask if you want to use it: **Yes**
- Ask if you want to copy it: **Yes**
- Ask about Postgres / Redis: **say No** to both for now (we'll attach Postgres separately)
- Ask if you want to deploy now: **No** (we still need to set up Postgres)

If the suggested app name `nr-safety-alerts-api` is taken, Fly will offer alternatives. Pick one and update `fly.toml`'s `app = ...` line.

## Step 2 — Provision Postgres

```bash
fly postgres create --name nr-safety-alerts-db --region ord --vm-size shared-cpu-1x --volume-size 1
```

Accept the defaults. Save the connection details Fly prints — especially the **postgres password** — somewhere safe.

Then attach it to the app:

```bash
fly postgres attach nr-safety-alerts-db --app nr-safety-alerts-api
```

This sets `DATABASE_URL` as a secret on the app.

## Step 3 — Set the JWT secret

```bash
JWT_SECRET=$(openssl rand -hex 64)
fly secrets set JWT_SECRET="$JWT_SECRET" --app nr-safety-alerts-api
```

## Step 4 — Deploy

```bash
fly deploy --app nr-safety-alerts-api
```

Watch the build. The `[deploy]` section in `fly.toml` runs `npm run migrate` automatically right before the new version goes live, so the schema is created on first deploy.

## Step 5 — Create your admin user

```bash
fly ssh console --app nr-safety-alerts-api -C "npm run create-user -- --email=admin@newrelic.com --password='ChangeMe123!' --role=admin --name='Admin'"
```

## Step 6 — Verify

```bash
fly status --app nr-safety-alerts-api
```

Look for the public URL — something like `https://nr-safety-alerts-api.fly.dev`.

Test it:

```bash
curl https://nr-safety-alerts-api.fly.dev/api/health
# → {"ok":true,"ts":"..."}

curl https://nr-safety-alerts-api.fly.dev/api/sources/health | jq
# Should show 12 sources, with ok/stale/error status
```

Wait ~2 minutes for the scrapers to do their first pass, then:

```bash
curl https://nr-safety-alerts-api.fly.dev/api/events?limit=5 | jq
# Should return 5 real events
```

## Step 7 — Lock down CORS

Once you know the dashboard URL, edit `fly.toml`:

```
[env]
  CORS_ORIGIN = "https://kcheyne-dev.github.io"
```

Then `fly deploy` again.

## Operational commands

```bash
# Tail logs
fly logs --app nr-safety-alerts-api

# SSH into the running instance
fly ssh console --app nr-safety-alerts-api

# Add another user
fly ssh console --app nr-safety-alerts-api \
  -C "npm run create-user -- --email=user@newrelic.com --password='...' --role=cmt --name='Name'"

# Restart
fly apps restart nr-safety-alerts-api

# Scale up to always-on (~$2/mo extra)
fly scale count 1 --app nr-safety-alerts-api

# Pause the app entirely (no charges; data preserved)
fly scale count 0 --app nr-safety-alerts-api

# Connect to Postgres
fly postgres connect --app nr-safety-alerts-db
```

## Costs at our scale

| Resource | Free tier | Our usage | Extra cost |
|---|---|---|---|
| App machine (shared 1x, 512MB) | 3 free machines | 1 machine | $0 |
| Postgres (shared 1x, 1GB) | 1 free machine | 1 machine | $0 |
| Outbound bandwidth | 100GB/mo | Probably <1GB/mo | $0 |
| **Total** | — | — | **$0/mo** |

If traffic grows beyond the free tier (unlikely for an internal CMT tool), Fly auto-bills your card at standard rates.

## Roll back

If a deploy breaks something:

```bash
fly releases --app nr-safety-alerts-api
fly releases rollback <version> --app nr-safety-alerts-api
```

Postgres data is preserved across rollbacks; only the app code changes.
