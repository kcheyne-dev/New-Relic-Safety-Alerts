# NRSA / S.T.A.R. View — Data Source Inventory

**Document purpose.** Single reference for every external data source the New Relic Safety Alerts dashboard (S.T.A.R. view) connects to: what each provides, how the project connects, and the terms-of-use posture for each. Maintained alongside the codebase.

**Last reviewed:** 2026-06-16. Verify ToS at each provider's site before any production rollout — ToS language drifts and this document captures only the project-relevant clauses.

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
| 7 | ACLED | Civil unrest | OAuth2 | **Commercial license required** | **No — license needed** |
| 8 | MeteoAlarm | Weather (EU) | None | Free w/ attribution | Yes (currently disabled) |
| 9 | Transport for London | Transit | App key (free) | TfL Open Data License | Yes (attribution) |
| 10 | SF Open Data (Socrata) | Public safety | App token (free) | Public domain / open | Yes |
| 11 | Atlanta APD ArcGIS | Public safety | None | US local gov, no formal terms | Likely yes |
| 12 | WHO Disease Outbreak News | Health | None | **WHO Terms of Use — restricted** | Caution |
| 13 | PDX FlashAlert | Press releases | None | Service ToS exists | Caution (currently disabled) |
| 14 | GDELT 2.0 | News events | None | Free / academic | **Disabled by design** (article noise) |
| 15 | OSAC | Travel security | Member portal | **Code of Conduct restricts redistribution** | **BLOCKED** — see note |
| 16 | Nominatim / OSM | Geocoding | UA header | ODbL + Nominatim usage policy | Yes (rate-limited) |
| 17 | CartoDB basemap tiles | Map tiles | None | CARTO free-tier ToS | Yes (attribution) |
| 18 | RainViewer | Radar overlay | None | Free with attribution | Yes (attribution) |
| 19 | NASA GIBS | Satellite overlay | None | NASA Open Data Policy | Yes (attribution) |

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

### 1.7 ACLED — Armed Conflict Location & Event Data ⚠️ LICENSE REQUIRED

- **What:** Vetted civil unrest incidents (battles, violence against civilians, explosions, riots, strategic developments) with lat/lng and fatalities.
- **Endpoints:**
  - Token: `https://acleddata.com/oauth/token` (OAuth2 password flow)
  - Read: `https://acleddata.com/api/acled/read?…&limit=500`
- **Format:** JSON
- **Auth:** OAuth2 Bearer token. Credentials from env: `ACLED_EMAIL`, `ACLED_PASSWORD`.
- **Cadence:** 900 s (15 min, `ACLED_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/acled.ts` — currently inert (no creds in .env, ACLED_DISABLED).
- **Terms of use:** ACLED operates a tiered license model. Free use is restricted to academic, journalist, and non-profit contexts and requires registration + attribution. **Any corporate / commercial / private-sector use requires a paid commercial license** (negotiated directly with ACLED; pricing is bespoke and not published). Republication requires written consent; redistribution to third parties is restricted. Attribution form: "Armed Conflict Location & Event Data Project (ACLED); www.acleddata.com".
- **Project compliance:** **Not currently production-compliant.** Adapter is built but disabled pending license. License email is in progress (per project memory). Until ACLED commercial license is signed, the adapter must remain disabled in any deployment that any non-licensed user can see — including the public GitHub Pages preview.

### 1.8 MeteoAlarm — European weather warnings

- **What:** Pan-European severe weather warnings (color-coded Yellow/Orange/Red).
- **Endpoint:** `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-europe`
- **Format:** Atom XML (legacy feed; v1 JSON API also exists but not used)
- **Auth:** None
- **Cadence:** 900 s (15 min, `METEOALARM_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/meteoalarm.ts` — **currently disabled** (URL returning 404 across two URL guesses; deferred until URL is verifiable in a browser).
- **Terms of use:** MeteoAlarm is a service of EUMETNET (a consortium of European national meteorological services). Free to use with attribution. The MeteoAlarm Terms of Use require: (a) crediting MeteoAlarm in any redistribution, (b) not modifying the warning information in a way that could mislead, (c) refreshing data at a reasonable cadence (their feeds are updated roughly every 10 min). Commercial use is permitted with attribution; some national member services have additional terms for their own data.
- **Project compliance:** Will be compliant when re-enabled. UI already shows source attribution on alert cards.

### 1.9 Transport for London (TfL) — disruption feed

- **What:** Tube / DLR / Overground / Elizabeth-line line-status disruptions for the London office.
- **Endpoint:** `https://api.tfl.gov.uk/Line/Mode/{modes}/Status?detail=true`
- **Format:** JSON
- **Auth:** Optional free TfL API key (env: `TFL_APP_KEY`, passed as `?app_key=`). Without a key, requests are rate-limited (~50/min); with a key, ~500/min.
- **Cadence:** 600 s (10 min, `LONDON_TFL_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/london_tfl.ts`
- **Terms of use:** TfL Open Data is licensed under the **TfL Open Data License** (a bespoke license, broadly Open Government Licence v3.0-style). Required: (a) attribution — "Powered by TfL Open Data", (b) display the line "Contains OS data © Crown copyright and database rights …" if mapping data is used, (c) data must not be presented in a misleading way. Commercial use is permitted.
- **Project compliance:** **Action item:** add the "Powered by TfL Open Data" attribution string somewhere visible (alert detail view or footer) before any production rollout. Currently the source name "TfL" is shown but the prescribed attribution wording is not. Free TfL API key should be registered and added to `.env` for production cadence headroom.

### 1.10 SF Open Data — Police incidents (Socrata)

- **What:** SFPD incident reports, last 24 h, in a bounding box around the SFO office.
- **Endpoint:** `https://data.sfgov.org/resource/wg3w-h783.json` (SoQL filtered, see adapter)
- **Format:** JSON (Socrata Open Data API)
- **Auth:** Optional free Socrata App Token (env: `SOCRATA_APP_TOKEN`, passed as `X-App-Token` header). Without a token, requests are throttled; with a token, much higher quota.
- **Cadence:** 600 s (`SF_POLICE_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/sf_police.ts`
- **Terms of use:** DataSF / SF Open Data publishes datasets under SF's Open Data policy. Most datasets, including `wg3w-h783` (Police Department Incident Reports 2018-Present), are explicitly placed in the public domain or under terms equivalent to no-rights-reserved. Tyler Technologies / Socrata's platform ToS apply to the API itself: standard fair-use, no attempt to disrupt service, register an App Token for serious use.
- **Project compliance:** Compliant. **Recommended:** register an App Token before production for rate-limit headroom.

### 1.11 Atlanta Police Department — COBRA daily ArcGIS feed

- **What:** ATL APD daily reported incidents.
- **Endpoint:** `https://services2.arcgis.com/4FcmTqzRN6XvUDA8/arcgis/rest/services/COBRA_Daily_Updated/FeatureServer/0/query?…`
- **Format:** ArcGIS REST FeatureCollection (JSON)
- **Auth:** None
- **Cadence:** 900 s (15 min, `ATL_APD_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/atl_apd.ts`
- **Terms of use:** No formal published terms specific to this ArcGIS feed. The City of Atlanta publishes data via its open-data portal under permissive terms; ESRI's ArcGIS Online has standard fair-use terms. **Action item:** verify with the City of Atlanta (or the Atlanta Police Department public-information office) that scraping this feed at 15-min cadence for an internal corporate dashboard is acceptable use; if a more formal feed exists (Open Data Atlanta portal), prefer it.

### 1.12 WHO — Disease Outbreak News (DON) ⚠️ TERMS WORTH REVIEWING

- **What:** WHO-published infectious-disease outbreak reports, country-scoped.
- **Endpoint:** `https://www.who.int/api/news/diseaseoutbreaknews?…&$top=100&$orderby=PublicationDateAndTime%20desc`
- **Format:** JSON (Sitecore CMS API)
- **Auth:** None
- **Cadence:** 21 600 s (6 h)
- **Adapter:** `backend/src/adapters/who_don.ts`. Persists to dedicated `who_outbreaks` table (separate from `events` because WHO data is contextual, not real-time).
- **Terms of use:** The WHO website operates under the [WHO Terms of Use](https://www.who.int/about/policies/terms-of-use) and content is generally licensed under **CC BY-NC-SA 3.0 IGO** or its successors. Key clauses for our use: (a) **NC = non-commercial only** unless permission is granted, (b) attribution required, (c) share-alike. The "non-commercial" definition matters — internal corporate use (a CMT dashboard within New Relic) is generally considered non-commercial under most interpretations of CC-NC, but this is not unambiguous and WHO has been known to take a narrower view. Republication / public-facing display would more clearly require permission.
- **Project compliance:** **Action item:** the GitHub Pages mirror is publicly accessible. While bare Pages mode currently shows seed alerts only (live mode requires backend creds), the moment WHO outbreaks are surfaced anywhere a non-NR user can see them, the CC-NC clause becomes load-bearing. Recommend (a) keep WHO data behind authenticated CMT access, (b) add explicit "Source: WHO Disease Outbreak News" attribution per CC-BY, (c) before any external sharing of the dashboard, contact WHO permissions desk (`permissions@who.int`).

### 1.13 PDX FlashAlert Network — Portland press releases

- **What:** Portland-area public-safety press releases (police, fire, transit) — relevant to the PDX office.
- **Endpoint:** `https://www.flashalert.net/news.xml`
- **Format:** RSS 2.0 XML
- **Auth:** None
- **Cadence:** 600 s (`PDX_FLASHALERT_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/pdx_flashalert.ts` — **currently disabled** (URL 404 across guesses; deferred until verifiable).
- **Terms of use:** FlashAlert Newswire is operated by FlashAlert.net LLC, a private press-release distribution service. Their site terms allow personal use of the content (the press releases themselves are typically issued by public agencies and are public-record). However, scraping the consolidated feed for a corporate redistribution use is a gray zone — preferable to either subscribe officially (FlashAlert offers a free email/API subscription tier) or pull press releases directly from the originating agency feeds (Portland Police, Portland Fire & Rescue, TriMet).
- **Project compliance:** Will need a quick ToS check before re-enabling. Recommend registering a FlashAlert subscriber account before production rollout.

### 1.14 GDELT 2.0 — Global Database of Events, Language and Tone

- **What:** Worldwide news article database, geocoded and CAMEO-coded.
- **Endpoint:** `https://api.gdeltproject.org/api/v2/doc/doc`
- **Format:** JSON
- **Auth:** None
- **Cadence:** 900 s (15 min, `GDELT_FETCH_INTERVAL`)
- **Adapter:** `backend/src/adapters/gdelt.ts` — **disabled by design** (`GDELT_DISABLED=true`). Per project audit (2026-05-31): GDELT produces article-level news noise, not events. 853 active rows post-ingest, 0 office-matched, dominated by celebrity gossip / state politics / single-incident traffic deaths. Country-level geocoding makes proximity matching useless.
- **Terms of use:** GDELT is published by The GDELT Project under a free, open license — attribution required ("This research uses data from the GDELT Project"). Commercial use is permitted. The free tier of the API has fair-use rate limits (no published number, but heavy users have reported throttling at ~1 req/sec).
- **Project compliance:** Disabled, so currently a non-issue. If re-enabled in the future, the adapter would be compliant with attribution requirements.

### 1.15 OSAC — Overseas Security Advisory Council 🚫 BLOCKED

- **What:** US Department of State / Bureau of Diplomatic Security service for US private-sector orgs operating abroad. Country security reports (CSRs), threat alerts, and analyst-by-email engagement.
- **Endpoint:** None — OSAC has **no programmatic API**. Access is via OSAC.gov member portal, OSAC newsletters (email), and analyst email engagement.
- **Auth:** OSAC member account (kcheyne@newrelic.com is approved for full member access).
- **Adapter:** None built. Integration plan exists at `docs/osac-integration-plan.md`.
- **Terms of use:** **OSAC Code of Conduct contains three clauses that block the planned integration:**
  1. **Chatham House Rule** on OSAC communications.
  2. **Prohibition on unauthorized capture/distribution** of OSAC content.
  3. **Prohibition on sharing sensitive operational details** with non-members.
  Penalty for misalignment: temporary or permanent termination of OSAC access.
- **Project compliance:** **DO NOT BUILD** any OSAC integration until written guidance comes back from `OSACPrograms@state.gov` (sent 2026-06-11). Even a simple newsletter parser into the dashboard surfaces OSAC-derived content to non-OSAC-member CMT colleagues — exactly what the redistribution clauses are written for. Three plausible outcomes detailed in the integration-plan doc.

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

**Hard blockers — must resolve before production:**
1. **ACLED commercial license** — adapter is built but currently inert. Cannot be enabled in any non-licensed deployment, including the public GitHub Pages preview. License email is in flight.
2. **OSAC integration** — blocked entirely on `OSACPrograms@state.gov` written guidance about Code-of-Conduct compatibility. Do not build until guidance returns. Penalty for misuse is termination of OSAC access.

**Soft items — verify or add attribution before rollout:**
3. **WHO DON CC-BY-NC-SA** — internal corporate use is likely (but not unambiguously) allowed; gate behind authenticated CMT access; do not surface to public Pages mirror.
4. **TfL** — add "Powered by TfL Open Data" attribution string. Register a free `TFL_APP_KEY`.
5. **EMSC** — courtesy notice to EMSC for corporate / production cadence; verify attribution form on alert detail.
6. **Atlanta APD ArcGIS** — confirm with City of Atlanta or APD PIO that the COBRA feed is appropriate for this use case.
7. **Nominatim** — switch to self-hosted instance (Docker compose profile already scaffolded) for any production deployment; current public-instance use is fine for dev only.
8. **CartoDB tiles** — verify production traffic stays inside CARTO's free-tier fair-use; if not, plan a paid provider.
9. **PDX FlashAlert** — register a subscriber account if re-enabling; consider switching to direct agency feeds.
10. **RainViewer** — ensure attribution string is shown when the layer is active.

**No-action / already compliant:**
11. USGS, NWS, EONET, GDACS, US State Dept, SF Open Data, GIBS — public-domain or open-license sources currently meeting their attribution requirements. Continue current practice.

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
