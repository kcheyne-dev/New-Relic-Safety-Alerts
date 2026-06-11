# New Relic Safety Alerts — User Manual

**Audience:** Crisis Management Team (CMT) operators
**Status:** Living document — update as features evolve
**Last updated:** 2026-06-10
**Live demo:** https://kcheyne-dev.github.io/New-Relic-Safety-Alerts/

---

## 1. Introduction & Overview

### What this dashboard is for

An internal Crisis Management Team tool. Designed to answer three operational questions in real time:

- **Q1 — Office threat.** Is there an event with extreme likelihood to affect an office (shelter-in-place / evacuate level)?
- **Q2 — Traveler threat.** Is there an event with extreme likelihood to affect a traveling employee?
- **Q3 — Business continuity.** Is there an event affecting enough employees to disrupt operations (terror, mass-casualty, major natural disaster)?

Q1 and Q2 are *detection* problems — the system spots localized threats and routes them to CMT before the news would. Q3 is a *response* problem — operator declares the event, the dashboard computes affected population, drafts comms, and tracks responses.

### Who uses this dashboard

CMT (Crisis Management Team) members, primarily. Future role tiers planned (Admin / CMT / Office Manager / Employee), driven by Okta when integrated.

### Severity levels

| Tier | Color | Meaning |
| --- | --- | --- |
| **Extreme** | red | Mass impact / shelter or evacuate level |
| **High** | orange | Significant likelihood of office or traveler impact |
| **Moderate** | yellow | Awareness; possible localized impact |
| **Low** | gray | Informational; no immediate action |

Severity is set per source via the rules in [severity-thresholds.md](./severity-thresholds.md). Earthquakes use magnitude; weather warnings use CAP severity; civil unrest uses ACLED fatality counts; etc.

### Alert categories

- **Natural Disaster** — earthquakes, weather, wildfires, floods, volcanoes, storms
- **Civil Unrest** — protests, riots, armed conflict (ACLED-pending for production)
- **Public Safety** — police incidents, transit disruption, suspicious packages
- **Travel Advisory** — US State Department country-level advisories (L3+ only after threshold rules)

### Monitored offices (9)

| IATA | Name | Country | Region |
| --- | --- | --- | --- |
| SFO | San Francisco | USA | Americas |
| PDX | Portland | USA | Americas |
| ATL | Atlanta | USA | Americas |
| BCN | Barcelona | Spain | EMEA |
| DUB | Dublin | Ireland | EMEA |
| LON | London | UK | EMEA |
| TYO | Tokyo | Japan | APAC |
| BLR | Bengaluru | India | APAC |
| HYD | Hyderabad | India | APAC |

Office identity (id, name, country, lat/lng, address) is real and current. Per-office headcounts are mock until Workday integrates.

---

## 2. Operating Modes

The dashboard runs in one of three modes, auto-detected from the URL:

| URL | Mode | Use case |
| --- | --- | --- |
| `localhost:8000` | **Live** | Talks to local backend on `:8080`. Real polling data from USGS / NWS / EMSC / GDACS / EONET / State Dept. JWT login required. |
| `https://kcheyne-dev.github.io/New-Relic-Safety-Alerts/` | **Bare Pages** | No backend reachable. Static seed alerts only — used as a clean stakeholder demo. |
| Any URL with `#api=mock` hash | **Demo** | Cycling alerts simulator + full mock people-data (travelers, remote employees, ACLED, WHO outbreaks). Use for tabletop exercises and feature exploration. |

A `#api=mock` hash overrides into Demo mode regardless of hostname. The URL hash persists across page loads in the same tab — if you see "fake" data on `localhost:8000`, check the URL bar for `#api=mock`.

---

## 3. Layout

Three-zone layout with collapsible icon rails:

```
┌─────────────────────── Header ─────────────────────────┐
│ Logo · NR Safety Alerts · CMT Dashboard                │
│      [Map Tools] [✈ Travelers] [🌐 Risk Profile]       │
│                  [🚨 Declare BCI] [🌙 Theme] [? Manual] │
├─────────────────────── Status strip ───────────────────┤
│ LOGGED IN AS · OPEN INCIDENTS · HIGHEST ACTIVE ·       │
│ NEED HELP · SOURCES · VIEW · saved indicator           │
├──────┬──────────────────────────────────┬──────────────┤
│ 🔔   │                                  │ 📣 Crisis    │
│ ALERT│            World Map             │ Comms (top)  │
│ FEED │                                  ├──────────────┤
│ (left│                                  │ 🚨 Incidents │
│ rail)│                                  │ (lower)      │
└──────┴──────────────────────────────────┴──────────────┘
```

### Header controls

- **Map Tools** — combined Layers (hazard zones, live overlays, severity filter, office visibility, employee CSV) and Geo-fence (circle / rectangle / polygon scoping)
- **✈ Travelers** — modal with sortable table, search, type filter, CSV export. Badge shows `—` when Navan integration pending.
- **🌐 Risk Profile** — standalone modal with country picker, Live Hazards, ACLED historical context, WHO outbreaks
- **🚨 Declare BCI** — Business Continuity Incident declaration; opens scope picker + exposure readout
- **🌙 Theme** — light / dark toggle
- **? Manual** — link to this document

### Status strip

Read left to right: who you're logged in as → open incidents count → highest currently-active alert → "need help" tally (employees who replied HELP) → source health (X/15 active) → office-relevant vs all-global view toggle → autosave indicator. Click "Highest active" to zoom the map there.

### Three panels

All three start collapsed. Click the icon rail to expand. Drag the inner edge to resize (280-600px, double-click to reset). Widths persist to localStorage.

---

## 4. The Map

Powered by Leaflet with CartoDB Dark Matter / Positron tiles. Auto-fits to all 9 offices on load and on resize (only when no specific selection is active).

### Office markers

Each office shows as a labeled bubble: `SFO 412 ✈3` — IATA code, headcount, and a traveler badge if visiting employees are present. In live mode (no Workday), the headcount is omitted: just `SFO ✈3` or `SFO`. The bubble is color-tinted by the office's highest active alert severity.

### Office popups

Click any office bubble to open its popup — name, country, address, headcount (or "pending Workday integration"), active alerts count, visiting traveler list, and a Crisis Comms shortcut.

### Hazard layers (Map Tools → Layers tab)

Six polygon hazard zones with clickable source citations: Wildfire / Flood / Seismic / Civil Unrest / AQI / Heat. Two live tile overlays: RainViewer precipitation, NASA GIBS land-surface temperature. Toggle each layer independently.

### Reset View

Top-left button labeled `🌐 All offices` (or `Esc` keyboard shortcut) re-fits the map to all offices and clears any selection. Esc precedence: close modal → close tools dropdown → reset view.

---

## 5. Alert Feed (left rail)

Two tabs:

### By Office

Groups alerts by office. Within each office, sorted by **smart priority score** — severity-dominant with recency penalty:

| Severity | Score base |
| --- | --- |
| Extreme | 1000 |
| High | 100 |
| Moderate | 10 |
| Low | 1 |

Score decays by 1 per hour aged. Result: a fresh Extreme always outranks a 12-hour-old High. Inside each office, the top 5 show by default; "Show N more" expands.

### Timeline

Top 20 events chronologically by `issued_at` — most recent first.

### Alert card

Each card shows:
- Severity pill (color-coded)
- Source badge (USGS / NWS / GDACS / etc.)
- Title (real-world or backend-derived)
- Location · age · category
- Impact badges: 🏢 office IDs in radius · ✈ travelers in radius · 👥 employees in radius
- **Details** button — opens a full alert detail page in a new tab
- **Crisis** button — pre-fills the Compose form with smart-suggested template

### Office-relevant vs All-global filter

Status strip has a chip toggling between 🎯 (Office-relevant) and 🌐 (All global). Default is 🎯, hiding events that don't affect any office, traveler, or employee population. Click to toggle to 🌐 for the firehose view.

---

## 6. Severity Thresholds

The dashboard applies per-source rules at ingest time to keep the alert feed actionable. Tuning principle: **tight for low-sev, loose for high-sev** — high-severity events pass globally, low-severity events get aggressive proximity gating.

Quick summary:

| Source | Threshold rule |
| --- | --- |
| USGS / EMSC | M6.5+ ext globally · M6+ high · M5.5+ high · M5+ high if office < 500 km · M4.5+ shallow mod if office < 250 km |
| NWS | CAP Severe / Extreme only — Watches, Advisories, Statements drop |
| GDACS | Orange / Red only — Green drops |
| EONET | Volcanoes globally; wildfires / floods / severeStorms / earthquakes only if office < 250 km; everything else drops |
| State Dept | Level 3 / Level 4 only — Levels 1 and 2 drop |
| ACLED | Violent events with fatalities pass globally; 0-fatality violent events require office < 500 km; 0-fatality riots and strategic developments drop |
| MeteoAlarm | Orange / Red only |

Full rule details and tuning rationale: [severity-thresholds.md](./severity-thresholds.md).

---

## 7. Crisis Communications (right upper panel)

Three tabs: **Room** (chat-room style timeline), **Compose** (send), **Log** (history).

### Compose form (collapsed-by-default to essentials)

- **Offices** — single-select dropdown + custom location text input + chip list of selected
- **Channels** — Slack / Email (SMS planned)
- **Recipients** — auto-populated based on offices and channels
- **Template** — grouped picker by category (Shelter, Evacuate, Check-in, All Clear, BC Announce, BC Check-in, Office Closure, Travel)
- **Message** — pre-filled from template; editable
- **Send** button (teal)

### Advanced (collapsed disclosure)

- **Subject** — auto-prefilled from alert context
- **Attachments** — drag-drop, ≤2MB embedded as data URL
- **Response Required** — toggle whether to expect OK/HELP replies
- **Reminder Interval** — minutes between auto-reminders to non-responders

### Smart-suggest

When you click 📣 Crisis on an alert card, the system pre-picks the most relevant template based on the alert's title, type, and source:

| Alert signal | Suggested template |
| --- | --- |
| USGS / EMSC earthquake | Shelter — Earthquake |
| NWS Tornado Warning | Shelter — Severe Weather |
| Active shooter / armed assailant | Shelter — Active Threat |
| Bomb threat / suspicious package | Evacuation — Bomb |
| Wildfire | Evacuation — Fire |
| Civil Unrest in city, no office, has traveler | Safety Check — Traveler |
| Travel Advisory | Travel — Advisory Upgrade |
| Default | Safety Check — Office |

You can override the suggestion in the dropdown at any time. The toast notification confirms which template was picked.

### Templates (17 total in 8 categories)

| Category | Variants |
| --- | --- |
| **Shelter in Place** | Generic, Earthquake, Severe Weather, Active Threat, Civil Unrest |
| **Evacuation** | Generic, Fire, Bomb / Suspicious Package |
| **Safety Check-in** | Office, Traveler |
| **All Clear** | Generic |
| **BC Announcement** | Generic, Major Earthquake, Terror / Mass-Casualty |
| **BC Check-in** | Country-wide |
| **Office Closure** | Directive |
| **Travel** | Suspension, Advisory Upgrade |

Custom templates can be added via the `+` button next to the dropdown. They persist to localStorage.

---

## 8. Incident Lifecycle (right lower panel)

Filter tabs: Open / Closed / All. Five detail tabs per incident: **Details**, **Comms**, **Responses**, **Notes**, **Log**.

### Declare

Click `+ New Incident` → fill title / description / affected offices → Declare. Or click 🚨 Open incident from this alert on an Alert Details page to auto-link.

### Comms tab

Full timeline of messages sent for this incident, with attachments, linkified bodies, "Send Another Message" button. Multi-message flows track as one incident.

### Responses tab

Per-employee OK / HELP / no-response status. Traveler subsection. Filters: All / Replied / Not yet / Help requested.

### Notes tab

Free-text per-incident notes. Drag-drop attachments per note. URLs auto-linkify.

### Log tab

Append-only audit log of every state change (declared, message sent, employee replied, closure note, reopened).

### Close

`End Incident` button → closure note prompt → moves to Closed filter. Reopen button (`↻`) on closed incidents.

### Export Report

Comprehensive printable HTML report in a new tab:

- Incident Summary facts table
- Originating Alert (with source link)
- Source feed health row at incident time
- Affected Offices (with Maps links)
- Response Tally
- Communications Sent
- Employee Responses
- Visiting Travelers
- Notes
- Activity Log
- References & Source Links table

JSON download includes everything machine-readable.

---

## 9. Travelers

Click ✈ Travelers in the header. Modal opens with:

- Sortable table (name / home office / country & city / type / itinerary / last seen)
- Search box (matches name, city, country, hotel, airline)
- Type filter chips: All / ✈ Flight / 🏨 Hotel / 🏢 Office
- CSV export
- Per-row actions: 📍 zoom map to traveler, ✉ pre-fill Crisis Comms with traveler context

### Live mode

Pending Navan integration — modal shows a placeholder card explaining traveler itineraries will populate once Navan is connected. Header badge shows `—`.

### Demo mode (`#api=mock`)

12 fictitious travelers populated. Demo simulator advances a random traveler one leg every 45 seconds with a toast notification.

---

## 10. Country Risk Profile

Click 🌐 Risk Profile in the header (or "View full Risk Profile →" link inside Declare BCI modal).

### Layout

- **Header** — title, ACLED disclaimer about 5-14 day publication lag
- **Toolbar** — search input, region filter chips (All / Americas / EMEA / APAC), country count
- **Live Hazards panel** — appears when 1+ countries selected; aggregates current alerts for those countries
- **ACLED Historical Context panel** — last-30-day vetted civil-unrest counts (mock data until license)
- **Country chip grid** — sortable by ACLED event count, click to add/remove from selection

### Live Hazards

Real-time read of what's happening *now* in the selected countries. Pulls from the existing alert pipeline (USGS / NWS / EMSC / GDACS / EONET / State Dept). Shows rows for:

- 🚨 Travel Advisory level (max across selected countries)
- 🌍 Recent earthquakes
- 🌪 Severe weather warnings
- 🚨 GDACS Orange/Red events
- 🔥 Wildfires
- 🌋 Volcanic events
- ⚠️ Civil unrest events
- 🦠 Active disease outbreaks (WHO Disease Outbreak News + per-country/disease detail with links)

Empty / quiet state shows "No active hazards detected" rather than empty rows.

### ACLED Historical Context

Vetted 30-day rollups: Battles · VAC (violence against civilians) · Explosions · Riots · Strategic Developments · Total events · Total fatalities. Per-country breakdown when 2+ countries selected.

In live + bare Pages mode (no ACLED license): "Pending ACLED license & integration" placeholder.

### Use cases

- Pre-trip planning: "We're sending engineers to Mexico City — what's the picture?"
- BCI scope decision: "Yemen had 158 violent events last 30 days; we should escalate"
- Post-incident review of a region

---

## 11. Business Continuity Incident (BCI) Declaration

For Q3 events — operator-declared, response-side. Click 🚨 Declare BCI.

### Modal sections

1. **Event Type** — Terror / Mass-casualty / Quake / Hurricane / Civil collapse / Transit / Geopolitical / Other
2. **Title** — concise headline operators will see
3. **Geographic Scope** — country chip picker (17 NR-presence countries + dynamic additions) OR drawn geo-fence
4. **Exposure in Scope** — live readout of offices in scope, office headcount, travelers, remote employees (placeholders for what's not yet integrated)
5. **Country Risk Profile (compact)** — ACLED context one-liner with link to full Risk Profile
6. **Recommended Template** — BC Announce / BC Check-in / BC Closure / Travel templates
7. **Additional Context** — optional textarea (appended to message body)
8. **Acknowledgment** — checkbox that operator understands they're declaring an incident
9. **Declare** button

### What Declare does

- Creates an Incident tagged `bcp:true` with the full scope snapshot
- Pre-fills Crisis Comms with the affected offices, recipients, template
- Switches to the Compose tab so operator can review before sending

### Geo-fence option

Sub-country scope: closes the BCI modal, opens Map Tools → Fence tab with polygon mode auto-selected. After drawing, BCI modal reopens with the form preserved and the fence applied. A floating chip lets the operator cancel and return.

---

## 12. Synthetic Test Scenarios (Demo mode only)

In `#api=mock` mode, a cyan 🧪 Tests pill appears in the top-center pill row. Click to open a modal with three preset scenarios:

| Scenario | What it tests |
| --- | --- |
| **🏢 Office threat** | M6.5 quake 28 km E of SFO. Validates Extreme alert card, status-strip wash, impact badges, Crisis Comm pre-fill |
| **✈ Traveler threat** | Civil unrest at the current location of the first non-office traveler. Validates traveler-proximity badge and traveler-targeted Crisis Comm |
| **🚨 BCI declaration** | Pre-fills the BCI modal for an M7.4 Tohoku earthquake in Japan. Validates exposure readout and BCI flow |

A red 🧹 Clear N pill auto-appears when synthetic events exist; one click wipes them. Synthetic events use `id` prefix `test-` to keep separate from demo-cycler events (`demo-` prefix) and seed events.

---

## 13. Persistence

State persists to localStorage:

- Incidents, responses, crisis log
- Custom templates, custom locations
- Draft compose state
- Panel widths, expanded office groups
- Map view selection
- Theme preference

Schema versioned (`nrsa-state-v1`) for future migrations. Manual modal has **⬇ Export Data (JSON)** and **🗑 Reset Local Data** buttons. On boot, a toast confirms `Restored from local save (Xh ago)`.

**⚠ Known limitation:** localStorage is browser-local. Closing the tab doesn't lose data, but clearing site data, switching browsers, or a "Reset Local Data" click does. Migration to Postgres for incident persistence is queued (Backend Sprint 5).

---

## 14. Pending Integrations

Honest status of what isn't yet wired up. The dashboard shows "pending integration" placeholders wherever fake numbers would otherwise appear:

| Data source | Future integration | Current state |
| --- | --- | --- |
| Office headcounts | Workday | Mock numbers in Demo mode; "pending Workday integration" placeholder elsewhere |
| Per-individual remote employees | Workday | Mock entries in Demo mode; "pending Workday integration" elsewhere |
| Traveler itineraries | Navan | 12 fictitious travelers in Demo mode; "pending Navan integration" elsewhere |
| Civil-unrest historical | ACLED (license in progress) | Mock 30-day rollups in Demo mode; "pending ACLED license & integration" elsewhere |
| Disease outbreaks | WHO Disease Outbreak News (no integration yet) | 8 mock entries in Demo mode; absent in live + bare Pages |
| Auth / role tiers | Okta | JWT login locally; Okta JWKS scaffold ready |
| Comms outbound | Slack, Gmail | Compose UI logs to incident; no actual messages sent |
| Comms inbound (replies) | Slack | UI tracks responses but no real reply capture |

Phasing recommended: Workday + Okta foundation → Slack outbound → Slack inbound → Navan → Gmail.

---

## 15. Troubleshooting

### Data feels old

Likely cause: backend `npm run dev` stopped polling. Run this in your scratch terminal:

```
psql postgres://nrsa:nrsa@localhost:5432/nrsa -c "SELECT primary_source_id, COUNT(*) FILTER (WHERE NOT is_stale) AS active, MAX(issued_at) AS newest, NOW() - MAX(issued_at) AS time_since_newest FROM events GROUP BY primary_source_id ORDER BY active DESC;"
```

`time_since_newest` should read minutes-to-hours for active sources. If days, restart the backend. See [nrsa_local_ops.md](https://github.com/...)... actually that's in your private memory, not the public repo. Restart command:

```
cd "/Users/kcheyne/Documents/Claude/Projects/New Relic Safety Alerts/backend" && npm run dev
```

### Dashboard shows seed alerts on `localhost:8000`

Frontend hit a stale state. Recovery: in DevTools Console, run `localStorage.clear()`, then `Cmd+Shift+R` to hard refresh. The login modal should appear; sign in and the live data path will engage.

### "Invalid credentials" on login

Reset the password from `backend/`:

```
npm run create-user -- --email=<your-email> --password=<your-password> --role=cmt
```

The script does `ON CONFLICT UPDATE` so it always overwrites the existing row.

### "Mode confusion" — am I looking at real or fake data?

Check the URL bar. If it has `#api=mock`, the dashboard is in Demo mode regardless of hostname. The hash persists across page navigations on the same tab.

Also check `ALERTS[0].id` in DevTools Console:

- UUID format like `c5de828e-2b49-4dc0-b048-f81556872b90` → live backend data
- Short string like `a5` or `demo-xyz` or `test-...` → mock / seed data

---

## Reference docs

- [build-synopsis.md](./build-synopsis.md) — comprehensive system synopsis
- [severity-thresholds.md](./severity-thresholds.md) — per-source threshold rules
- [project-overview.html](./project-overview.html) — original (pre-rebuild) overview, historical context
- [user-manual.html](./user-manual.html) — original HTML user manual, historical context
- [quick-reference.html](./quick-reference.html) — original HTML quick reference, historical context

---

## How to update this manual

This is a living document. When features change:

1. Edit `docs/user-manual.md` directly
2. Update the "Last updated" date at the top
3. Commit + push — the rendered version on GitHub updates automatically within ~30 seconds
4. Share the link: https://github.com/kcheyne-dev/New-Relic-Safety-Alerts/blob/main/docs/user-manual.md

Markdown chosen over HTML so updates are diff-friendly and review-able. The original `.html` versions are preserved for historical reference.
