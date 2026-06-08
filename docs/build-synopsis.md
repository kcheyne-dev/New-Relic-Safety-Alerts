# New Relic Safety Alerts — Build Synopsis

**Status:** Prototype, actively developed
**Last updated:** 2026-06-06
**Live demo:** https://kcheyne-dev.github.io/New-Relic-Safety-Alerts/
**Repo:** `git@github.com:kcheyne-dev/New-Relic-Safety-Alerts.git`

---

## What it is

An internal Crisis Management Team dashboard for New Relic. Single-purpose tool answering three operational questions in real time:

- **Q1 — Office threat.** Is there an event with extreme likelihood to affect an office (shelter / evacuate level)?
- **Q2 — Traveler threat.** Is there an event with extreme likelihood to affect a traveling employee?
- **Q3 — Business continuity.** Is there an event affecting enough employees to disrupt operations (terror, mass-casualty, major natural disaster)?

Q1 and Q2 are detection problems — the system spots localized threats and routes them to CMT before the news would. Q3 is a response problem — operator declares the event and the dashboard computes affected population, drafts comms, tracks responses.

This is an internal tool, not a portfolio piece, not a paid-product replacement (Factal, Crisis24, Dataminr).

## Architecture

**Frontend** is a single-file HTML/JS prototype (`index.html`, ~5,500 lines) deployed via GitHub Pages. Three operating modes auto-detected from URL:

| URL | Mode | Data source |
| --- | --- | --- |
| `localhost:8000` | Live | Real backend on `:8080` |
| Bare GitHub Pages URL | Mock (clean) | Static seed alerts only — for stakeholder viewing |
| Any URL with `#api=mock` hash | Full demo | Cycling alerts, mock people-data, test scenarios |

**Backend** is a TypeScript / Fastify / Postgres+PostGIS service in `backend/`. ~25 files, 7 active source adapters polling on per-source intervals. Runs locally on the user's Mac via Postgres.app + `npm run dev`. Production hosting (Hetzner / Fly.io / Railway) estimated at $10-30/month, not yet wired.

**Data sources active.** USGS earthquakes, EMSC (EU seismic), NWS (US weather), GDACS (global disasters), EONET (NASA wildfires/storms/volcanoes), State Department travel advisories, ACLED (armed conflict — scaffolded but inert pending license). All free, no API keys required.

## What works today

### Detection pipeline

Each source adapter runs on its own schedule, applies per-source severity threshold rules, normalizes events, geocodes if needed, matches to nearest office via PostGIS, clusters across sources to dedupe, persists with audit trail. A sweeper marks aged events stale at 48 hours measured from `issued_at`.

Severity thresholds follow a "tight for low-severity, loose for high-severity" tuning principle:

- M6.5+ earthquakes pass globally; M5+ require an office within 500 km; M4.5+ require shallow depth AND an office within 250 km
- NWS Severe and Extreme Warnings only — Watches, Advisories, Statements all drop
- GDACS Orange and Red only — Green drops
- EONET volcanoes globally; wildfires/floods/storms only when an office is within 250 km
- State Department Level 3 and Level 4 only — Levels 1 and 2 drop
- ACLED violent events with fatalities pass globally; 0-fatality violent events require office within 500 km; 0-fatality riots and strategic developments drop entirely

A 2026-05-31 audit reduced ~7,000 noisy events to ~329 trustworthy events. The full rule table lives in `docs/severity-thresholds.md`.

### Operator workflow

World map (Leaflet + CartoDB Dark Matter) with 9 office markers and live alert feed. Three resizable panels with localStorage persistence:

- **Alerts feed** (left rail) with By-Office and Timeline tabs, smart-priority sort (severity-dominant with recency penalty), per-office severity-count breakdown
- **Crisis Comms** (upper right) with Room / Compose / Log tabs
- **Incidents** (lower right) with Open / Closed / All filter, full lifecycle UI

Alert cards show severity, source health dot, traveler/employee impact badges. Inline "Crisis" button pre-fills Compose with smart-suggested template.

### Crisis communications

17 event-class templates organized into 8 categories with grouped picker UI:

| Category | Templates |
| --- | --- |
| Shelter in Place | Generic, Earthquake, Severe Weather, Active Threat, Civil Unrest |
| Evacuation | Generic, Fire, Bomb / Suspicious Package |
| Safety Check-in | Office, Traveler |
| All Clear | Generic |
| BC Announcement | Generic, Major Earthquake, Terror / Mass-Casualty |
| BC Check-in | Country-wide |
| Office Closure | Directive |
| Travel | Suspension, Advisory Upgrade |

Smart-suggest picks the best template when an alert's Crisis button fires, based on title keywords (active shooter / bomb threat / tornado / etc.), alert type, and source. USGS earthquake → Shelter — Earthquake. NWS Tornado Warning → Shelter — Severe Weather. ACLED civil unrest near a traveler → Safety Check — Traveler. Operator can override.

Compose supports multi-channel output (Slack, email; SMS planned), attachments (data-URL up to 2 MB), custom templates, drafts persisted, linked-incident banner for multi-message flows.

### Incident lifecycle

Declare → acknowledge → track per-employee responses (OK / HELP / no-response) with traveler subsection → close with note → reopen if needed → export comprehensive report.

Reports are HTML for printing plus JSON download. Include incident summary, originating alert with source link, affected offices with Maps links, response tally, communications sent, employee responses, visiting travelers, notes, activity log, and references table. Auto-link to originating alert when incident is created from Crisis Comms.

### Business Continuity Incident declaration

Manual operator trigger for Q3 events ("9/11-class terrorism, Israel major bombing, typhoons, hurricanes, major earthquakes"). Header button opens modal with:

- Event-type picker (terror / mass-casualty / quake / hurricane / outage / etc.)
- Title + country chip picker covering 17 NR-presence countries
- Live exposure readout: offices in scope / office headcount / travelers / remote employees
- Recommended template dropdown (per-event-class BC variants)
- Geo-fence option for sub-country scope (closes modal → opens Map Tools fence draw → reopens BCI with form preserved)
- Acknowledgment checkbox + Declare button

Creates an Incident tagged BCP, pre-fills Crisis Comms with affected scope.

### Synthetic test scenarios (mock mode only)

Three preset scenarios for end-to-end validation without waiting for real disasters:

1. **Office threat** — M6.5 quake 28 km east of SFO. Validates Extreme alert card, status-strip wash, impact badges, Crisis Comm pre-fill.
2. **Traveler threat** — civil unrest at a current non-office traveler's location. Validates traveler-proximity badge and Crisis Comm traveler context.
3. **BCI declaration** — pre-fills the BCI modal for an M7.4 Tohoku earthquake. Validates exposure readout (TYO + travelers + remote employees in Japan).

Auto-clearing red pill appears when synthetic events exist; one click wipes them. Tagged with `id` prefix `test-` to keep separate from demo and real events.

## Mock vs Real

Office identity (locations, addresses, lat/lng) is **real**. Everything else "people-related" is **mock pending integration**, gated behind the `#api=mock` URL hash:

| Data | Source (future) | State today |
| --- | --- | --- |
| Office headcounts | Workday | Mock numbers in `#api=mock`; "pending Workday integration" placeholder elsewhere |
| Travelers (itineraries, locations) | Navan | 12 fictitious travelers in `#api=mock`; pending placeholder elsewhere |
| Remote employees | Workday | ~80 fictitious entries in `#api=mock`; pending placeholder elsewhere |
| Country presence list | Editorial seed | 17 countries always loaded; verify against real NR ops |
| Real-time alerts (USGS / NWS / etc.) | Live source feeds | Real data in localhost-live mode |
| Office identity (location / address / lat/lng) | Confirmed by user | Real, always loaded |

In live mode (production-ready surface), no fake numbers anywhere. BCI exposure shows three independent "pending integration" placeholders plus a "Total exposure unavailable — Workday + Navan integrations pending" message until those integrations land.

## Persistence + auth

**localStorage** holds incidents, responses, crisis log, custom templates, custom locations, draft compose, panel widths, expanded office groups, and other state. Schema versioned (`nrsa-state-v1`) for migration. Manual export (JSON) and reset buttons in the manual modal.

**Auth scaffolding** supports JWT login (local) and Okta JWKS verification (when migrated). Production role tiers planned: Admin / CMT Member / Office Manager / Employee — fed by Okta org tree when integrated.

## Pending integrations (long-term plan)

Phasing recommended:

1. **Workday + Okta foundation.** Replaces `OFFICE_HEADCOUNTS_MOCK`, `REMOTE_EMPLOYEES_MOCK`, the editorial `COUNTRY_PRESENCE` seed; provides org-tree role tiers.
2. **USGS first real feed.** Already shipped.
3. **Slack outbound.** Send Crisis Comm messages programmatically.
4. **Slack inbound.** Capture employee replies (OK / HELP) into incident response tracking.
5. **Navan.** Replaces `TRAVELERS_MOCK` with real itineraries and current locations.
6. **Gmail.** Email-channel parity with Slack output.

Bedrock evaluated as the LLM-layer destination if NR is AWS-shop (Guardrails for PII, multi-model routing, IAM auth, CloudTrail audit). Recommended model routing when AI layer is wired: Sonnet for message drafting and incident summaries; Haiku for high-volume dedup/classification; Opus for low-volume high-stakes judgment (evacuation / escalation).

## Known gaps + open questions

- **Office headcount numbers** in `OFFICE_HEADCOUNTS_MOCK` (412 / 188 / 262 / etc.) are placeholder; verify against actual NR data when Workday lands.
- **Country presence editorial seed** (17 countries: 6 office + 11 likely-presence additions) should be reviewed against NR's real operating countries.
- **Acceptable false-negative rate for severity thresholds** is the open question from the threshold-tuning work — rules are currently tuned "balanced," but production tuning needs operator data we don't have yet.
- **5 source adapters broken** (TfL HTTP 400, FlashAlert HTTP 404, SF Socrata HTTP 400, MeteoAlarm HTTP 406, GDELT disabled) — deprioritized given the higher severity bar; global feeds (USGS / NWS / GDACS / EONET / EMSC) cover the high-stakes events.
- **ACLED commercial license** is required for production deployment (free for personal/academic). Application in progress.
- **OSAC State Department membership** application in progress — provides paid-grade intel free for qualifying companies.

## Costs

| Phase | Cost |
| --- | --- |
| Development | $0 |
| Production backend hosting | ~$10-30/month (Hetzner, Fly.io, or Railway) |
| Source feeds | All free, no API keys |
| ACLED commercial license | TBD when contacted |
| Optional paid escalation | Factal first paid pick (~$30-50K/year), Crisis24 mid-tier, Dataminr only if post-mortems show value |

## Backlog (queued, not committed)

**Code work, ready to pick up:**

- Three-tier relevance (Direct / Indirect / Watch) — replace binary office-relevant filter with three categories: in-radius of office or current traveler / in country with NR presence / Extreme severity globally (info-only).
- Fix the 5 broken adapters — boring, low marginal value at the new severity bar, but they sit returning 4xx in scheduler logs.
- Backend Sprint 5 — migrate incidents / responses / comms log from localStorage to Postgres; Okta SSO scaffolding.

**External / process work, in progress:**

- ACLED license email
- OSAC application

**Far-future, plan-then-build:**

- Workday integration → fills office headcounts, remote employees, country presence
- Navan integration → fills traveler manifests
- Slack inbound (employee response capture) and outbound (programmatic comms)
- LLM noise classifier — only relevant if real-data tuning shows rules-based filtering needs help; deprioritized given the new severity bar

## Repo + deploy

- Repo: `git@github.com:kcheyne-dev/New-Relic-Safety-Alerts.git` (SSH remote)
- Live: https://kcheyne-dev.github.io/New-Relic-Safety-Alerts/
- Deploy: `git push` from `main` triggers GitHub Pages rebuild within 1-3 minutes
- Local development: Postgres.app + `npm run dev` from `backend/` + `python3 -m http.server 8000` from project root → `http://localhost:8000`

Backend is not yet hosted; lives in `backend/` subdirectory of the repo for portability.
