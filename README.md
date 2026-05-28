# New Relic Safety Alerts

A global threat-monitoring and crisis-communications dashboard for the Crisis Management Team (CMT).

Single-file static web app. Open `index.html` in a browser, or host on GitHub Pages.

## Features

- **Live map** with 9 office hubs (SFO, PDX, ATL, BCN, DUB, LON, TYO, BLR, HYD), color-coded by highest active severity (Low / Moderate / High / Extreme).
- **Alert feed** with By-Office and Timeline tabs, fed by 15 mock data sources (NWS, USGS, EMSC, NASA EONET, GDACS, ACLED, GDELT, Flashalert, Socrata, ArcGIS APD, FEMA IPAWS, State Dept, MeteoAlarm, OpenWeatherMap, OpenAQ).
- **Layers panel** — hazard overlays, severity threshold filter, office visibility, alert type filters, employee CSV upload (By-Office vs By-ZIP), traveler Navan CSV upload.
- **Geo-fence** — circle / rectangle / polygon, Highlight vs Filter mode, dual results (dropdown + bottom bar with employee/traveler chips), CSV export, Crisis fast-path.
- **Crisis Communications** — Compose / Log / Room tabs, multi-office targeting with chips, Slack/Email channels (SMS coming-soon), 5 templates, Response Required tracking, configurable reminder interval, send confirmation.
- **Incidents** — Details / Messages / Notes / Log tabs, per-employee OK/Help responses, traveler subsection, color-coded activity timeline, sealed close-out.
- **Travelers** plotted at destination — office badge ("N✈"), airplane (air booking), hotel (hotel booking), cluster.
- **Theme toggle** — dark (default) / light, with matching CartoDB tiles.
- **Data freshness indicator** — green/yellow/red per source.

## Hosting on GitHub Pages

```bash
git remote add origin https://github.com/<your-user>/<repo>.git
git push -u origin main
```

Then in repo Settings → Pages → Source: `main` branch, root.

## Stack

- Pure HTML / CSS / vanilla JS — no build step.
- [Leaflet](https://leafletjs.com/) + Leaflet.draw + Leaflet.markercluster (via CDN).
- [CartoDB tiles](https://carto.com/) (dark/light basemaps).
- All data is mocked client-side; CSV uploads parse Navan-style traveler exports and standard employee directories.

Built with Cowork.
