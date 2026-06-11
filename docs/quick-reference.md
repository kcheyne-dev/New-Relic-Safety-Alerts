# NR Safety Alerts — Quick Reference

**One-page operator card.** Last updated 2026-06-10.

For full detail: [user-manual.md](./user-manual.md). For threshold rules: [severity-thresholds.md](./severity-thresholds.md).

---

## The three operating questions

| | Question | Detection or response? |
| --- | --- | --- |
| **Q1** | Is there an event likely to affect an office? | Detection |
| **Q2** | Is there an event likely to affect a traveler? | Detection |
| **Q3** | Is there an event affecting enough employees to disrupt business? | Response |

---

## Three operating modes (auto-detected from URL)

| URL | Mode | Data |
| --- | --- | --- |
| `localhost:8000` | **Live** | Real polling from local backend |
| GitHub Pages bare URL | **Bare Pages** | Static seed alerts only |
| Any URL with `#api=mock` | **Demo** | Cycling alerts + full mock people-data |

---

## Workflow at a glance

```
┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐
│ 1. MONITOR │───▶│ 2. DETECT  │───▶│ 3. RESPOND │───▶│ 4. TRACK   │
│ Map +      │    │ Alert card │    │ Crisis     │    │ Incident   │
│ Alert feed │    │ + Crisis   │    │ Comms      │    │ + Reports  │
│            │    │ button     │    │            │    │            │
└────────────┘    └────────────┘    └────────────┘    └────────────┘
```

---

## STEP 1 — MONITOR

**Watch the world map.** Office bubbles colored by their highest active alert severity.

**Watch the alert feed (left rail).** Two tabs:
- **By Office** — grouped by office, top 5 each
- **Timeline** — top 20 chronologically

**Watch the status strip.** Read left to right: who's on shift → open incidents → highest active → need help count → sources health (X/15) → 🎯 office-relevant view toggle → save indicator.

**Default view is 🎯 office-relevant.** Click the chip to flip to 🌐 all-global if you need the firehose.

---

## STEP 2 — DETECT

**Click any alert card** to zoom the map and read the inline summary.

**Click `Details`** to open a full alert detail page (new tab). Includes severity-tinted header, source link, related alerts, "Show on dashboard" + "Open incident" actions, print CSS.

**Click `📣 Crisis`** on any alert card to pre-load Crisis Comms.

The system **smart-suggests a template** based on the alert:

| Alert | Suggested template |
| --- | --- |
| USGS / EMSC quake | Shelter — Earthquake |
| NWS Tornado / Severe Storm | Shelter — Severe Weather |
| Active shooter / armed | Shelter — Active Threat |
| Bomb / suspicious package | Evacuation — Bomb |
| Wildfire | Evacuation — Fire |
| Civil unrest near traveler (no office) | Safety Check — Traveler |
| Travel Advisory | Travel — Advisory Upgrade |

You can override the suggestion in the dropdown.

---

## STEP 3 — RESPOND

### Crisis Comms (right upper panel)

**Compose tab essentials:**
- Offices · Channels (Slack/Email) · Recipients · Template · Message · `Send →`

**Advanced (collapsed):**
- Subject · Attachments · Response required · Reminder interval

**17 templates in 8 categories:**

| Category | Templates |
| --- | --- |
| **Shelter** | Generic, Quake, Severe Weather, Active Threat, Civil Unrest |
| **Evacuate** | Generic, Fire, Bomb |
| **Check-in** | Office, Traveler |
| **All Clear** | Generic |
| **BC Announce** | Generic, Major Quake, Terror / Mass-Casualty |
| **BC Check-in** | Country-wide |
| **Office Closure** | Directive |
| **Travel** | Suspension, Advisory Upgrade |

Pick a template, edit if needed, click Send. Multi-message flows track as one incident.

---

### Q3 / BCI declaration

For macro events the operator already knows about (terror, mass-casualty, major quake, hurricane, geopolitical):

1. Click **🚨 Declare BCI** in the header
2. Pick **event type** + write **title**
3. Select **countries** (chip picker) OR draw a **geo-fence**
4. Review **Exposure in Scope** — offices · headcount · travelers · remote employees
5. Glance at the **Country Risk Profile** (one-liner with link to full modal)
6. Pick a **template** (BC Announce / Check-in / Closure / Travel)
7. Add optional **context**
8. Check the **acknowledgment** box
9. Click **Declare**

Creates an Incident tagged BCP and pre-fills Crisis Comms with the affected scope.

---

### Country Risk Profile (header button: 🌐)

Standalone modal for browsing, comparing, and pre-trip planning.

**Live Hazards panel** (always works, including in live mode):
- 🚨 Travel Advisory level (max across selection)
- 🌍 Recent earthquakes
- 🌪 Severe weather warnings
- 🚨 GDACS Orange/Red events
- 🔥 Wildfires · 🌋 Volcanoes
- ⚠️ Civil unrest events
- 🦠 Active disease outbreaks (WHO + per-country detail with links)

**ACLED Historical Context** (mock until license):
- Battles · VAC · Explosions · Riots · Strategic developments
- Total events · Total fatalities
- Per-country breakdown when 2+ countries selected

Reads ACLED as **context, not trigger** — 5-14 day publication lag means it's for situational awareness, not real-time alerting.

---

## STEP 4 — TRACK

### Incident tabs (right lower panel)

| Tab | What's there |
| --- | --- |
| **Details** | Title, description, affected offices, originating alert link |
| **Comms** | Full message-flow timeline + "Send Another Message" |
| **Responses** | Per-employee OK / HELP / no-response with traveler subsection |
| **Notes** | Free-text notes with drag-drop attachments |
| **Log** | Append-only audit of every state change |

### Close

`End Incident` → closure note → moves to Closed filter.
`↻ Reopen` button on closed incidents.

### Export Report

`📄 Export Report` opens a printable HTML report in a new tab. Includes incident summary, originating alert, source feed health row, affected offices with Maps links, response tally, comms sent, employee responses, visiting travelers, notes, activity log, references table. JSON download includes everything machine-readable.

---

## Synthetic test scenarios (Demo mode only)

Cyan **🧪 Tests** pill in the top-center of the page when URL has `#api=mock`. Click → modal with three preset scenarios:

1. **🏢 Office threat** — M6.5 quake near SFO
2. **✈ Traveler threat** — civil unrest at first non-office traveler's location
3. **🚨 BCI declaration** — Tohoku M7.4 earthquake (Japan)

Red **🧹 Clear N** pill auto-appears when synthetic events exist. One click wipes them.

---

## When something feels off

### "Data feels old"

Run this in your scratch terminal:

```
psql postgres://nrsa:nrsa@localhost:5432/nrsa -c "SELECT primary_source_id, COUNT(*) FILTER (WHERE NOT is_stale) AS active, NOW() - MAX(issued_at) AS time_since_newest FROM events GROUP BY primary_source_id ORDER BY active DESC;"
```

`time_since_newest` should be **minutes-to-hours** for active sources. If **days**, the backend stopped polling — restart with:

```
cd "/Users/kcheyne/Documents/Claude/Projects/New Relic Safety Alerts/backend" && npm run dev
```

### "Dashboard shows seed alerts in live mode"

Frontend hit a stale state. In DevTools Console:

```
localStorage.clear()
```

Then `Cmd+Shift+R` to hard refresh. Sign in when the modal appears.

### "Login fails: Invalid credentials"

Reset the password from `backend/`:

```
npm run create-user -- --email=<email> --password=<pw> --role=cmt
```

### "Am I in live or mock mode?"

Look at the URL bar. If it has `#api=mock`, you're in Demo mode regardless of hostname.

In DevTools Console: `ALERTS[0].id` returns a UUID for live data, a short string like `a5` or `demo-xyz` for seed/demo data.

---

## Source health legend

`SOURCES X/15` in the status strip:

| Health | What it means |
| --- | --- |
| green dot | Source polled successfully within its interval |
| yellow dot | Stale — last successful poll older than 2× interval |
| red dot | Error on most recent poll |

Currently expected breakages (4-5 sources): TfL HTTP 400 · FlashAlert HTTP 404 · SF Socrata HTTP 400 · MeteoAlarm HTTP 406. Plus GDELT and ACLED disabled in `.env`. Healthy sources: USGS, NWS, EMSC, GDACS, EONET, State Dept.

---

## How to keep this card current

This is a living document. When workflows change:

1. Edit `docs/quick-reference.md`
2. Update "Last updated" date
3. Commit + push — GitHub renders it automatically
4. Share: https://github.com/kcheyne-dev/New-Relic-Safety-Alerts/blob/main/docs/quick-reference.md
