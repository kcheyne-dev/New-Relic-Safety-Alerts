# NRSA / S.T.A.R. View — Data Source Inventory

**Document purpose.** Single reference for every external data source the New Relic Safety Alerts dashboard (S.T.A.R. view) connects to: what each provides, how the project connects, and the terms-of-use posture for each. Maintained alongside the codebase.

**Last reviewed:** 2026-07-13. Verify ToS at each provider's site before any production rollout — ToS language drifts and this document captures only the project-relevant clauses.

**2026-07-13 cleanup:** ACLED, GDELT, PDX FlashAlert, and OSAC were removed from the active source list. Their history, why they were removed, and how each decision was made now lives in § 7 Archived sources at the bottom of this doc.

---

## At-a-glance summary

| # | Source | Category | Auth | ToS class | Production-safe? |
|---|---|---|---|---|---|
| 1 | USGS Earthquake Hazards | Seismic | None | US Gov public domain | Yes |
| 2 | NWS (api.weather.gov) | Weather | UA header | US Gov public domain | Yes |
| 3 | NASA EONET | Natural events | None | NASA Open Data Policy | Yes (attribution) |
| 4 | EMSC (seismicportal.eu) | Seismic | None | Open / attribution | Yes (attribution) |
| 5 | GDACS | Multi-hazard | None | EU JRC public service | Yes (attribution) |
| 6 | US State Dept Travel Advisories | Travel | None | US Gov public domain | Yes |
| 7 | MeteoAlarm | Weather (EU) | Bearer / apikey | Free w/ attribution | Yes (live in prod) |
| 8 | Transport for London | Transit | App key (free) | TfL Open Data License | Yes (attribution) |
| 9 | SF Open Data (Socrata) | Public safety | App token (free) | Public domain / open | Yes |
| 10 | Atlanta APD ArcGIS | Public safety | None | US local gov, no formal terms | Likely yes |
| 11 | WHO Disease Outbreak News | Health | None | **WHO Terms of Use — restricted** | Caution |
| 12 | Nominatim / OSM | Geocoding | UA header | ODbL + Nominatim usage policy | Yes (rate-limited) |
| 13 | CartoDB basemap tiles | Map tiles | None | CARTO free-tier ToS | Yes (attribution) |
| 14 | RainViewer | Radar overlay | None | Free with attribution | Yes (attribution) |
| 15 | NASA GIBS | Satellite overlay | None | NASA Open Data Policy | Yes (attribution) |

(ACLED, PDX FlashAlert, GDELT, OSAC removed 2026-07-13 — see § 7 Archived sources.)

---

## 1. Backend event adapters

These are the polled data feeds that populate the Postgres `events` table via `backend/src/adapters/*.ts` and the persist pipeline. Each adapter is registered in `backend/src/workers/scheduler.ts` and gated by a `*_DISABLED` flag in `.env`.

### 1.1 USGS — Earthquake Hazards Program

- **What:** Earthquake feed, magnitude 4.5+ in the past week.
- **Endpoint:** `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson`
- **Format:** GeoJSON FeatureCollection
- **Auth:** None
- **Cadence:** 60 s (`USGS_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/usgs.ts`
- **Terms of use:** USGS data is produced by a US Government agency and is in the public domain (17 U.S.C. § 105). No license, no attribution legally required (attribution requested as a courtesy: "Data courtesy of the U.S. Geological Survey"). Heavy/automated use should follow the standard "be reasonable, identify yourself with a User-Agent" guidance.
- **Project compliance:** Compliant. Polling cadence (60 s) is well within the public feed's intended use.

### 1.2 NWS — National Weather Service alerts (api.weather.gov)

- **What:** Active US weather warnings/watches/advisories, with CAP severity and polygon geometry.
- **Endpoint:** `https://api.weather.gov/alerts/active`
- **Format:** GeoJSON FeatureCollection
- **Auth:** None, but the API requires a `User-Agent` identifying the application (set in adapter).
- **Cadence:** 300 s (`NWS_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/nws.ts`
- **Terms of use:** US National Weather Service / NOAA data is public domain. The api.weather.gov developer terms ask developers to set a unique `User-Agent` so NOAA can contact a misbehaving client — already done. No attribution legally required; attribution requested as courtesy.
- **Project compliance:** Compliant.

### 1.3 NASA EONET — Earth Observatory Natural Event Tracker

- **What:** Curated list of natural events (wildfires, storms, volcanoes, floods, drought, dust, sea/lake ice).
- **Endpoint:** `https://eonet.gsfc.nasa.gov/api/v3/events?status=open`
- **Format:** JSON
- **Auth:** None
- **Cadence:** 600 s (`EONET_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/eonet.ts`. Recency floor of 7 days applied (see severity-thresholds.md).
- **Terms of use:** NASA Open Data Policy — content produced by NASA is generally not copyrighted and may be used freely. Attribution requested ("Image courtesy of NASA EONET" or similar).
- **Project compliance:** Compliant. UI shows source attribution on each alert card and on the map-tools layer popup.

### 1.4 EMSC — European-Mediterranean Seismological Centre

- **What:** Seismic events (FDSN web service), magnitude 4.0+ globally.
- **Endpoint:** `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=200&minmag=4`
- **Format:** GeoJSON FeatureCollection (FDSN)
- **Auth:** None
- **Cadence:** 300 s (`EMSC_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/emsc.ts`
- **Terms of use:** EMSC data is published under a community open-access policy. Attribution required: cite EMSC and ORFEUS, the FDSN, and contributing networks. EMSC asks that high-volume / commercial users contact them.
- **Project compliance:** Source attribution shown on alert cards. Polling cadence (5 min) is reasonable. **Action item if going to production:** notify EMSC of corporate use as a courtesy; verify attribution string on alert detail views matches their requested form.

### 1.5 GDACS — Global Disaster Alert and Coordination System

- **What:** Multi-hazard alerts (earthquake / tropical cyclone / flood / volcano / drought / wildfire) with Green/Orange/Red severity.
- **Endpoint:** `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&fromdate=…&alertlevel=Green;Orange;Red`
- **Format:** GeoJSON FeatureCollection
- **Auth:** None
- **Cadence:** 600 s (`GDACS_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/gdacs.ts`
- **Terms of use:** GDACS is a service of the European Commission's Joint Research Centre and the UN OCHA. Free to use with attribution: "Source: GDACS – European Commission JRC". Re-publication is permitted; commercial use is allowed with attribution.
- **Project compliance:** Compliant. Source line shown in alert card and incident export.

### 1.6 US State Department — Travel Advisories

- **What:** Country-level travel advisories at L1–L4 levels.
- **Endpoint:** `https://travel.state.gov/_res/rss/TAsTWs.xml`
- **Format:** RSS 2.0 XML
- **Auth:** None
- **Cadence:** 86 400 s (24 h)
- **Adapter:** `backend/src/adapters/state_dept.ts` (geocoded via Nominatim)
- **Terms of use:** US Government work, public domain. Travel.state.gov has a copyright/disclaimer page noting US Gov works are not copyrighted. No formal limit on automated retrieval. Daily polling is well within reasonable use.
- **Project compliance:** Compliant.

### 1.7 MeteoAlarm — European weather warnings

- **What:** Pan-European severe weather warnings (color-coded Yellow/Orange/Red), aggregated by EUMETNET from 38 national meteorological services (DWD Germany, AEMET Spain, Met Éireann Ireland, Météo-France, etc.).
- **Transport (config-flip):** two OGC EDR providers supported via `METEOALARM_PROVIDER` env var:
  - **`meteogate`** (default) — `https://api.meteogate.eu/warnings/collections/warnings/locations/ALL`. Auth: `apikey: <TOKEN>` header. Token: `METEOGATE_API_KEY` (or legacy `METEOALARM_API_KEY`).
  - **`meteoalarm-direct`** — `https://api.meteoalarm.org/edr/v1/collections/warnings/locations/ALL`. Auth: `Authorization: Bearer <TOKEN>`. Token: `METEOALARM_DIRECT_TOKEN`. Currently active in prod (flipped 2026-07-13 after 3 probe rounds + full OpenAPI review confirmed byte-for-byte response compatibility with MeteoGate).
- **Format:** GeoJSON FeatureCollection (OGC EDR spec, both providers). CAP JSON payloads follow the `links[rel=json]` presigned DigitalOcean Spaces URL (same storage backend for both providers).
- **Cadence:** 900 s (15 min, `METEOALARM_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/meteoalarm.ts`. Full architecture in `memory/meteogate_api.md` + comparison at `docs/meteoalarm-direct-vs-meteogate.md`.
- **Terms of use:** EUMETNET service. Free to use with attribution. Requires: (a) crediting MeteoAlarm in redistribution, (b) not modifying warning info in a misleading way, (c) refreshing at reasonable cadence (~15 min matches their ~10-min upstream update). Commercial use permitted with attribution.
- **Project compliance:** Compliant. UI shows source attribution on alert cards. Future capability: MQTT real-time push (task #56, sub-second latency vs current 15-min poll).

### 1.8 Transport for London (TfL) — disruption feed

- **What:** Tube / DLR / Overground / Elizabeth-line line-status disruptions for the London office.
- **Endpoint:** `https://api.tfl.gov.uk/Line/Mode/{modes}/Status?detail=true`
- **Format:** JSON
- **Auth:** Optional free TfL API key (env: `TFL_APP_KEY`, passed as `?app_key=`). Without a key, requests are rate-limited (~50/min); with a key, ~500/min.
- **Cadence:** 600 s (10 min, `LONDON_TFL_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/london_tfl.ts`
- **Terms of use:** TfL Open Data is licensed under the **TfL Open Data License** (a bespoke license, broadly Open Government Licence v3.0-style). Required: (a) attribution — "Powered by TfL Open Data", (b) display the line "Contains OS data © Crown copyright and database rights …" if mapping data is used, (c) data must not be presented in a misleading way. Commercial use is permitted.
- **Project compliance:** **Action item:** add the "Powered by TfL Open Data" attribution string somewhere visible (alert detail view or footer) before any production rollout. Currently the source name "TfL" is shown but the prescribed attribution wording is not. Free TfL API key should be registered and added to `.env` for production cadence headroom.

### 1.9 SF Open Data — Police incidents (Socrata)

- **What:** SFPD incident reports, last 24 h, in a bounding box around the SFO office.
- **Endpoint:** `https://data.sfgov.org/resource/wg3w-h783.json` (SoQL filtered, see adapter)
- **Format:** JSON (Socrata Open Data API)
- **Auth:** Optional free Socrata App Token (env: `SOCRATA_APP_TOKEN`, passed as `X-App-Token` header). Without a token, requests are throttled; with a token, much higher quota.
- **Cadence:** 600 s (`SF_POLICE_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/sf_police.ts`
- **Terms of use:** DataSF / SF Open Data publishes datasets under SF's Open Data policy. Most datasets, including `wg3w-h783` (Police Department Incident Reports 2018-Present), are explicitly placed in the public domain or under terms equivalent to no-rights-reserved. Tyler Technologies / Socrata's platform ToS apply to the API itself: standard fair-use, no attempt to disrupt service, register an App Token for serious use.
- **Project compliance:** Compliant. **Recommended:** register an App Token before production for rate-limit headroom.

### 1.10 Atlanta Police Department — COBRA daily ArcGIS feed

- **What:** ATL APD daily reported incidents.
- **Endpoint:** `https://services2.arcgis.com/4FcmTqzRN6XvUDA8/arcgis/rest/services/COBRA_Daily_Updated/FeatureServer/0/query?…`
- **Format:** ArcGIS REST FeatureCollection (JSON)
- **Auth:** None
- **Cadence:** 900 s (15 min, `ATL_APD_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/atl_apd.ts`
- **Terms of use:** No formal published terms specific to this ArcGIS feed. The City of Atlanta publishes data via its open-data portal under permissive terms; ESRI's ArcGIS Online has standard fair-use terms. **Action item:** verify with the City of Atlanta (or the Atlanta Police Department public-information office) that scraping this feed at 15-min cadence for an internal corporate dashboard is acceptable use; if a more formal feed exists (Open Data Atlanta portal), prefer it.

### 1.11 WHO — Disease Outbreak News (DON) ⚠️ TERMS WORTH REVIEWING

- **What:** WHO-published infectious-disease outbreak reports, country-scoped.
- **Endpoint:** `https://www.who.int/api/news/diseaseoutbreaknews?…&$top=100&$orderby=PublicationDateAndTime%20desc`
- **Format:** JSON (Sitecore CMS API)
- **Auth:** None
- **Cadence:** 21 600 s (6 h)
- **Adapter:** `backend/src/adapters/who_don.ts`. Persists to dedicated `who_outbreaks` table (separate from `events` because WHO data is contextual, not real-time).
- **Terms of use:** The WHO website operates under the [WHO Terms of Use](https://www.who.int/about/policies/terms-of-use) and content is generally licensed under **CC BY-NC-SA 3.0 IGO** or its successors. Key clauses for our use: (a) **NC = non-commercial only** unless permission is granted, (b) attribution required, (c) share-alike. The "non-commercial" definition matters — internal corporate use (a CMT dashboard within New Relic) is generally considered non-commercial under most interpretations of CC-NC, but this is not unambiguous and WHO has been known to take a narrower view. Republication / public-facing display would more clearly require permission.
- **Project compliance:** **Action item:** the GitHub Pages mirror is publicly accessible. While bare Pages mode currently shows seed alerts only (live mode requires backend creds), the moment WHO outbreaks are surfaced anywhere a non-NR user can see them, the CC-NC clause becomes load-bearing. Recommend (a) keep WHO data behind authenticated CMT access, (b) add explicit "Source: WHO Disease Outbreak News" attribution per CC-BY, (c) before any external sharing of the dashboard, contact WHO permissions desk (`permissions@who.int`).

(§ 1.13 PDX FlashAlert, § 1.14 GDELT, § 1.15 OSAC — removed 2026-07-13. See § 7 Archived sources.)

---

## 2. Geocoding

### 2.1 Nominatim — OpenStreetMap geocoder

- **What:** Forward geocoding (place-name → lat/lng) used to enrich text-only sources (State Dept advisories, MeteoAlarm areas).
- **Endpoint:** `https://nominatim.openstreetmap.org/search?q=…&format=json&limit=1` (configurable via `NOMINATIM_URL`)
- **Format:** JSON
- **Auth:** None, but a `User-Agent` identifying the application is required (set via `NOMINATIM_USER_AGENT`).
- **Rate limit:** **1 request per second**, enforced in our code (`backend/src/pipeline/geocode.ts`, ~1.1 s throttle).
- **Caching:** Hits cached in Postgres `geocode_cache` table for 180 days (`GEOCODE_CACHE_TTL_DAYS`); misses cached for 24 h.
- **Terms of use:** The public Nominatim instance is governed by the [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) — strict requirements: (a) absolute max 1 req/sec, (b) valid `User-Agent` with contact info, (c) HTTP caching headers must be respected, (d) **must not display heavy use as a public service** — meaning a corporate production dashboard that hammers the public Nominatim is a policy violation.
- **Project compliance for production:** **Action item.** For any production deployment, switch to a self-hosted Nominatim Docker container (`docker compose --profile geocode up -d` is already scaffolded — see `.env.example` lines 41–42). The underlying OSM data is licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/) — attribution to "© OpenStreetMap contributors" required wherever results are displayed.

---

## 3. Frontend map tiles & overlays

These are loaded directly by `index.html` via Leaflet, not via the backend.

### 3.1 CartoDB basemap tiles

- **Dark mode:** `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`
- **Light mode:** `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`
- **Auth:** None (free CARTO basemap tier, subdomains a–d).
- **Terms of use:** CARTO basemaps are free for use in line with [CARTO's basemap ToS](https://carto.com/attributions). Required attribution: "© OpenStreetMap contributors © CARTO". CARTO's free tier has a fair-use cap; high-traffic deployments are expected to either pay or self-host (e.g., MapTiler, Mapbox, or self-hosted tileserver-gl).
- **Project compliance:** Attribution string is rendered by Leaflet by default. **Action item for production:** verify expected dashboard traffic stays inside CARTO's free fair-use band; if not, plan a paid tile provider before scale.

### 3.2 RainViewer — precipitation radar overlay

- **Metadata API:** `https://api.rainviewer.com/public/weather-maps.json`
- **Tile pattern (returned by metadata):** `{host}{path}/256/{z}/{x}/{y}/2/1_1.png`
- **Auth:** None
- **Terms of use:** RainViewer offers their tiles free of charge. Their ToS asks for attribution ("RainViewer.com" or "Powered by RainViewer") and prohibits resale of the tiles as a paid product. Commercial use in dashboards / apps is allowed with attribution.
- **Project compliance:** Verify attribution string is shown when the RainViewer layer is enabled.

### 3.3 NASA GIBS — Land Surface Temperature

- **Endpoint:** `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/{YYYY-MM-DD}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`
- **Auth:** None
- **Terms of use:** NASA Open Data Policy. Free to use, attribution requested ("NASA GIBS / MODIS Terra"). No commercial restriction.
- **Project compliance:** Attribution is shown on the layer popup ("© NASA GIBS · MODIS Terra LST").

### 3.4 Leaflet plugin libraries (CDN)

These are JavaScript libraries served from `unpkg.com`, not data sources:

- Leaflet 1.9.4 — `https://unpkg.com/leaflet@1.9.4/` — BSD-2-Clause license.
- Leaflet.draw 1.0.4 — `https://unpkg.com/leaflet-draw@1.0.4/` — MIT license.
- Leaflet.markercluster 1.5.3 — `https://unpkg.com/leaflet.markercluster@1.5.3/` — MIT license.

All three are bundleable and self-hostable for production; no usage restrictions. **Recommendation:** for production, vendor these into the repo rather than depending on `unpkg.com` (CDN availability + supply-chain integrity).

---

## 4. People-data integrations (planned, not yet wired)

These are referenced in the design but not yet connected. Each will introduce its own ToS regime when integrated.

| Integration | Will provide | License model | Status |
|---|---|---|---|
| Workday | Employee headcount per office, remote employee roster | Vendor SaaS contract | Mock-only; Workday integration deferred |
| Navan | Traveler itineraries | Vendor SaaS contract | Mock-only; Navan integration deferred |
| Okta | SSO + role assignment (Admin / CMT / Office Mgr / Employee) | Vendor SaaS contract | Mock-only |
| Slack | Outbound Crisis Comms; inbound check-ins | Slack API ToS (standard) | Phased after Workday/Okta |
| Gmail | Outbound Crisis Comms (email channel) | Google API ToS | Phased after Slack |

For any of the above, internal use of the corporate tenant is governed by New Relic's existing vendor contracts, not the public ToS — so the gating question is internal IT/legal sign-off, not public license terms.

---

## 5. Headline ToS risk register

**Soft items — verify or add attribution before rollout:**
1. **WHO DON CC-BY-NC-SA** — internal corporate use is likely (but not unambiguously) allowed; gate behind authenticated CMT access; do not surface to public Pages mirror.
2. **TfL** — add "Powered by TfL Open Data" attribution string. Register a free `TFL_APP_KEY`.
3. **EMSC** — courtesy notice to EMSC for corporate / production cadence; verify attribution form on alert detail.
4. **Atlanta APD ArcGIS** — confirm with City of Atlanta or APD PIO that the COBRA feed is appropriate for this use case.
5. **Nominatim** — switch to self-hosted instance (Docker compose profile already scaffolded) for any production deployment; current public-instance use is fine for dev only.
6. **CartoDB tiles** — verify production traffic stays inside CARTO's free-tier fair-use; if not, plan a paid provider.
7. **RainViewer** — ensure attribution string is shown when the layer is active.

**No-action / already compliant:**
8. USGS, NWS, EONET, GDACS, US State Dept, SF Open Data, GIBS, MeteoAlarm — public-domain, open-license, or (for MeteoAlarm) attribution-with-permission sources currently meeting their attribution requirements. Continue current practice.

(Hard-blocker entries for ACLED / OSAC were removed 2026-07-13 when both were archived — see § 7. If either is ever revived, restore the entry.)

---

## 6. Where to find the connection code

| Concern | File |
|---|---|
| Per-source endpoint URL, parsing, severity mapping | `backend/src/adapters/<source>.ts` |
| Poll cadence + scheduler registration | `backend/src/workers/scheduler.ts`, `backend/src/config.ts` |
| Source health tracking | `backend/src/routes/sources.ts`, `GET /api/sources/health` |
| Severity threshold rules per source | `backend/src/pipeline/thresholds.ts`, `docs/severity-thresholds.md` |
| Geocoding pipeline | `backend/src/pipeline/geocode.ts` |
| Persist + office-match | `backend/src/pipeline/persist.ts` |
| Frontend tile / overlay layers | `index.html` (Leaflet layer config near the map init block) |
| Environment / API keys | `backend/.env` (gitignored), template at `backend/.env.example` |

---

## 7. Archived sources

Sources previously listed here that have been removed from the active adapter roster. Kept for the historical record — what was tried, what didn't work, and why. Each entry documents the decision + how it was made so a future engineer doesn't rediscover the same dead ends. Git history (`git log --follow -- backend/src/adapters/<name>.ts`) preserves the actual adapter code from before removal.

### 7.1 ACLED — Armed Conflict Location & Event Data

Removed 2026-07-13. Never fed live production data; adapter was built but always disabled at runtime.

- **What it was:** Vetted civil unrest incidents (battles, violence against civilians, explosions, riots, strategic developments) with lat/lng and fatalities. Adapter used OAuth2 password flow against `acleddata.com/oauth/token` + `acleddata.com/api/acled/read`.
- **Why removed:** ACLED operates a tiered license model. Free use is limited to academic / journalist / non-profit contexts. **Any corporate / commercial / private-sector use requires a paid commercial license** — negotiated bespoke, pricing not published, redistribution to third parties restricted.
- **How the decision was made:** Adapter was scaffolded pre-2026-06 with the assumption that a commercial license would be obtained through procurement / legal. As of 2026-07-13 the license conversation hadn't progressed and the adapter had been runtime-disabled the entire time (no `ACLED_EMAIL` / `ACLED_PASSWORD` in `.env`, plus `ACLED_DISABLED=true` when set). Sitting there indefinitely as inert code with no live signal made the source list misleading — new engineers had to be told "yes, it's listed, no it doesn't run, no there's no ETA." Cleaner to remove and add back only when a license is actually in hand.
- **What was preserved:** Threshold logic (`evaluateAcled` + `ACLED_VIOLENT` set + `acledZeroFat` proximity constant in `backend/src/pipeline/thresholds.ts`) removed alongside; if license comes through, `git log --follow -- backend/src/adapters/acled.ts` recovers the OAuth flow + threshold rules. Mock data (`ACLED_RISK_MOCK` in `js/mock-data.js`) intentionally stayed — it powers the Risk Profile demo modal in `#api=mock` mode and doesn't touch production.
- **Revival requires:** commercial license signed with ACLED → `ACLED_EMAIL` + `ACLED_PASSWORD` in prod `.env` → resurrect adapter from git history (or rewrite fresh) → re-register in scheduler + config → re-add threshold logic → attribution string on alert cards.

### 7.2 PDX FlashAlert Network — Portland press releases

Removed 2026-07-13. Was disabled since 2026-06-20 after the source itself pivoted.

- **What it was:** RSS feed of Portland-area public-safety press releases (police, fire, transit) at `flashalert.net/news.xml`. Intended coverage for the PDX office.
- **Why removed:** **Source itself no longer exists in the form we needed.** 2026-06-20 investigation confirmed FlashAlert pivoted to a paid B2B press-release SaaS. The free public RSS was retired, no replacement URL exists at their domain. Adapter was disabled with a docblock in `pdx_flashalert.ts` explaining the pivot; that docblock is now in git history.
- **How the decision was made:** Adapter had been returning 404 across two URL guesses since ~2026-06 pipeline changes. A dedicated investigation in June confirmed the pivot was intentional (checked their new marketing site + support email) and that there was no free-tier successor URL. Sitting disabled indefinitely made the source list misleading. Recommended replacement (2026-06-20 review): **Factal** — a commercial event-detection service that covers Portland public-safety releases along with global event streams.
- **Revival requires:** either (a) FlashAlert restore a free tier (unlikely — they explicitly pivoted for revenue), (b) NR signs up for the FlashAlert paid B2B tier, or (c) switch strategy to direct agency feeds (Portland Police + Portland Fire & Rescue + TriMet as separate adapters).

### 7.3 GDELT 2.0 — Global Database of Events, Language and Tone

Removed 2026-07-13. Was `DISABLED_BY_DESIGN` since 2026-05-31 after the initial-integration audit.

- **What it was:** Worldwide news article database (`api.gdeltproject.org/api/v2/doc/doc`), geocoded and CAMEO event-coded. Attractive on paper for global civil-unrest / political-event coverage.
- **Why removed:** **Article-level noise, not event-level signal.** Per the 2026-05-31 audit: 853 active rows post-ingest produced zero office matches. Dominated by celebrity gossip, state politics, and single-incident traffic-death articles. Country-level geocoding made proximity matching structurally useless — a story could be tagged "USA" and describe an event 3000 miles from any NR office.
- **How the decision was made:** Adapter was built and enabled in early integration. First cycle populated hundreds of rows. First operator review identified the noise pattern within the same day. Threshold tuning was tried (`GDELT_MIN_MENTIONS`, tone thresholds) but couldn't recover useful signal — the underlying data is fundamentally not event-shaped for our use case. Set `GDELT_DISABLED=true`; adapter sat inert until this cleanup.
- **What was preserved:** GDELT could be re-approached later with a very different pipeline (e.g., NLP re-classification, city-level geocoding, per-event clustering) but that's a substantial redesign — not a "flip it back on" job. Git history has the original adapter for reference. Not recommended without a fundamentally different data-shape hypothesis.
- **Revival requires:** an integration design that solves the article-vs-event mismatch. Absent that, don't reintroduce.

### 7.4 OSAC — Overseas Security Advisory Council

Removed 2026-07-13. Adapter was never built. Compliance-blocked since inception.

- **What it was:** US Department of State / Bureau of Diplomatic Security service for US private-sector orgs operating abroad. Country Security Reports (CSRs), threat alerts, and analyst-by-email engagement. Access via OSAC.gov member portal (kcheyne@newrelic.com is an approved full member).
- **Why removed:** **Redistribution restrictions in OSAC's Code of Conduct make any integration a compliance risk.** Three specific clauses:
  1. **Chatham House Rule** on OSAC communications.
  2. **Prohibition on unauthorized capture / distribution** of OSAC content.
  3. **Prohibition on sharing sensitive operational details** with non-members.
  Penalty for misuse: temporary or permanent termination of OSAC access — losing the individual seat + potentially the corporate relationship.
- **How the decision was made:** Integration was scoped in `docs/osac-integration-plan.md` with three plausible outcomes. A compliance-guidance email was sent to `OSACPrograms@state.gov` on 2026-06-11 asking specifically whether ingesting OSAC content into a corporate CMT dashboard (visible to non-OSAC-member colleagues) is acceptable. **~1 month with no response** — enough time to signal that OSAC compliance staff either (a) don't respond to hypotheticals about redistribution or (b) consider the answer obvious enough that no clarification is needed. Either way, building without explicit written permission is uncomfortable given the penalty regime.
- **What was preserved:** `docs/osac-integration-plan.md` remains in the repo as an inventory of the three outcomes + code sketches. No adapter code was ever written, so nothing to recover from git.
- **Revival requires:** written response from OSACPrograms@state.gov (or successor contact) explicitly permitting internal corporate redistribution. Absent that: don't build. If a green light does come, `docs/osac-integration-plan.md` has the design starting point.
