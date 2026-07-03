/**
 * NRSA / S.T.A.R. View — legacy app script (extracted from inline block).
 *
 * SESSION 2 / Step A (2026-06-19): the entire inline <script>...</script>
 * block from index.html was lifted into this file verbatim. No logic changes
 * vs. the previous inline version — purely a mechanical move so:
 *   - <script defer src="./js/legacy-app.js"> actually defers (the inline
 *     defer attribute is silently ignored by the HTML spec when there is
 *     no src attribute);
 *   - the module bridge in main.js can execute BEFORE this script and
 *     wire window.STATE / window.ALERTS / etc. (bridge added in Step B).
 *
 * This file is intentionally LARGE (~6300 lines). It will shrink in
 * sessions 3+ as render / modals / persistence / api functions migrate
 * to their dedicated modules. For now, treat it as the single legacy unit.
 */

/* ============================================================
   New Relic Safety Alerts — single-file prototype (v2, faithful)
   ============================================================ */

/* ---------- 1. Static reference data ---------- */



/** Office directory.
 *  Office identity (id, name, country, lat/lng, address) is REAL and current —
 *  these are the actual New Relic office locations. Safe to keep in the public repo.
 *
 *  HEADCOUNTS are mock data, populated only in #api=mock by the demo bootstrap
 *  from OFFICE_HEADCOUNTS_MOCK (defined alongside TRAVELERS_MOCK and
 *  REMOTE_EMPLOYEES_MOCK in the demo simulator IIFE). In live + bare GitHub
 *  Pages, o.headcount is undefined and the UI shows "pending Workday integration"
 *  placeholders wherever a count would render.
 */

/** Country presence — countries where NR has any meaningful footprint.
 *
 *  This is an EDITORIAL SEED, not Workday data. The fact that NR operates in
 *  these countries is publicly knowable; the per-country headcount is not
 *  (that's deferred to Workday integration — see OFFICE_HEADCOUNTS_MOCK and
 *  REMOTE_EMPLOYEES_MOCK).
 *
 *  Why this exists: bcpAvailableCountries() needs the BCI scope picker to
 *  surface every country an operator might need to declare for, including
 *  countries with no office and no current traveler/remote-employee record.
 *  Without this seed, declaring BCI for "Brazil" would be impossible until
 *  someone manually showed up in the mock data — a gap for Q3 events in
 *  countries where current data is sparse.
 *
 *  Always-loaded (not gated behind #api=mock). Workday integration will
 *  verify and extend this list with authoritative per-country counts.
 */

/* Headcount helpers — office.headcount is mock data populated only in
 * #api=mock (see OFFICE_HEADCOUNTS_MOCK + demo IIFE boot). In live + bare
 * Pages headcount is undefined and the UI should show pending-integration
 * placeholders rather than NaN or "undefined". */

/* ACLED risk-rollup helpers — ACLED_RISK is mock data populated only in
 * #api=mock (see ACLED_RISK_MOCK + demo IIFE boot). In live + bare Pages
 * the BCI Country Risk Profile panel shows a "pending ACLED" placeholder. */

/* Sum the per-country rollups across the supplied country names. Returns
 * the same schema each ACLED_RISK_MOCK entry has, with totalEvents added.
 * Countries the operator selected that aren't in ACLED_RISK contribute 0. */

/* WHO Disease Outbreak helpers — same gating pattern as ACLED. Empty in
 * live + bare Pages until the WHO adapter ships; populated from
 * WHO_OUTBREAKS_MOCK by the demo bootstrap in #api=mock mode. */

/* WHO uses long-form country names ("Democratic Republic of the Congo")
 * but COUNTRY_PRESENCE / OFFICES use short forms ("DRC", "USA"). Map
 * known long-forms here so per-country lookups match. Add to this list
 * when new WHO entries surface unfamiliar long-forms. */


/* Live-hazards helpers — aggregate the EXISTING alert pipeline data
 * (NWS / MeteoAlarm / GDACS / USGS / EMSC / EONET / State Dept) into
 * a per-country snapshot for the Risk Profile modal. Distinct from
 * ACLED, which is historical context. Live hazards is "what's
 * currently active" — same data the dashboard's primary alert feed
 * shows, just grouped by country.
 *
 * Works in BOTH live and mock modes (no integration gating needed —
 * uses ALERTS state directly). In live mode, the backend feeds it
 * real data. In mock mode, the seed ALERTS + demo cycler feed it.
 */

/** Map an alert to a country name. Tries office country first (most
 *  reliable), then keyword-matches the alert's location/title text
 *  against COUNTRY_PRESENCE names (handles Travel Advisories etc.
 *  whose alerts have no officeId). */

/**
 * Three-tier relevance classification for an enriched alert.
 *
 *   'direct'   — an office or current traveler is in the impact radius.
 *                Highest priority; the operator should know NOW. (Q1/Q2.)
 *   'indirect' — alert is in a country where NR has presence (office,
 *                remote employees, or active traveler going there). Worth
 *                tracking; not an immediate response trigger. (Q3 input.)
 *   'watch'    — extreme severity globally with no NR presence overlap.
 *                Useful context for BCI decisions but informational only,
 *                hidden from the feed by default behind the 🌐 All toggle.
 *   null       — no NR-relevant signal. Default-hidden.
 *
 * Computed once during enrichEventWithImpact and cached on the alert
 * object as `relevanceTier` so the feed renderer can sort + tint without
 * recomputing per render pass.
 */

/** Empty hazard rollup with all keys zeroed and travelAdvisoryLevel null. */

/** Aggregate active alerts in the given country into a single hazard rollup.
 *  Looks at ALERTS state — the same array the dashboard renders. */

/** Sum live-hazard rollups across multiple countries. Travel Advisory level
 *  takes the MAX across countries (highest sev wins). */

/** Logged-in operator. Hardcoded for the prototype; will come from Okta when wired up.
 *  role: 'admin' | 'cmt' | 'office' | 'employee' */
/**
 * BACKEND CONFIG.
 *
 * Auto-detects environment:
 *   - localhost / 127.0.0.1 / file://  → http://localhost:8080  (live backend)
 *   - everywhere else (GitHub Pages…)   → ''                     (MOCK MODE)
 *
 * Override either way with URL hash:  #api=https://your-deployed-backend.example.com
 * Or force mock mode:                  #api=mock
 *
 * MOCK MODE = no network calls, hardcoded ALERTS, dashboard works fully offline.
 * LIVE MODE = JWT login modal, fetches /api/events, subscribes to SSE stream.
 */


/* ---------- 2. Mock data generators ---------- */

ALERTS = [
  { id:'a1',  sev:'high', type:'Civil Unrest',     source:'GDELT',      title:'Planned protest near Westminster — possible road closures',
    location:'London, UK', officeId:'LON', lat:51.501, lng:-0.124, radiusKm:5,
    summary:'Multiple groups gathering at Parliament Square 14:00 local. MPS advising avoidance of Whitehall.', issued: nowMinus(95) },
  { id:'a2',  sev:'high', type:'Public Safety',    source:'Socrata',    title:'Armed robbery reported — Mission District (within 0.4mi of office)',
    location:'San Francisco', officeId:'SFO', lat:37.762, lng:-122.418, radiusKm:1,
    summary:'SFPD: armed robbery at Mission & 16th. Suspect at large.', issued: nowMinus(7) },
  { id:'a3',  sev:'mod',  type:'Natural Disaster', source:'NWS',        title:'SIGMET — Severe convective turbulence near ATL',
    location:'Atlanta, GA', officeId:'ATL', lat:33.7, lng:-84.4, radiusKm:120,
    summary:'Line of thunderstorms moving E at 35kt. Tops to FL450.', issued: nowMinus(18) },
  { id:'a4',  sev:'mod',  type:'Natural Disaster', source:'MeteoAlarm', title:'Severe rain & flood watch — Catalonia',
    location:'Barcelona', officeId:'BCN', lat:41.385, lng:2.17, radiusKm:80,
    summary:'Orange-level alert for heavy precipitation through 22:00 local.', issued: nowMinus(42) },
  { id:'a5',  sev:'ext',  type:'Natural Disaster', source:'USGS',       title:'M5.8 earthquake — 65km E of Tokyo, depth 38km',
    location:'Tokyo', officeId:'TYO', lat:35.68, lng:140.4, radiusKm:200,
    summary:'Strong shaking reported. No tsunami warning.', issued: nowMinus(3) },
  { id:'a6',  sev:'high', type:'Natural Disaster', source:'EMSC',       title:'Aftershock M4.6 near Tokyo Bay',
    location:'Tokyo Bay', officeId:'TYO', lat:35.6, lng:140.0, radiusKm:80,
    summary:'Aftershock following earlier M5.8.', issued: nowMinus(1) },
  { id:'a7',  sev:'low',  type:'Travel Advisory',  source:'State Dept', title:'Smart Traveler Advisory L2 — Mexico (1 traveler)',
    location:'Mexico (nationwide)', officeId:null, lat:23.63, lng:-102.55, radiusKm:0,
    summary:'Exercise increased caution. Affects 1 employee.', issued: nowMinus(360) },
  { id:'a8',  sev:'high', type:'Natural Disaster', source:'MeteoAlarm', title:'Heavy monsoon flooding — multiple zones',
    location:'Bengaluru', officeId:'BLR', lat:12.97, lng:77.59, radiusKm:30,
    summary:'IMD red alert. Outer Ring Road impassable.', issued: nowMinus(28) },
  { id:'a9',  sev:'mod',  type:'Natural Disaster', source:'NWS',        title:'Heat advisory — humidity index ≥47°C',
    location:'Hyderabad', officeId:'HYD', lat:17.385, lng:78.486, radiusKm:50,
    summary:'Heat index above 47°C for 3 days.', issued: nowMinus(180) },
  { id:'a10', sev:'low',  type:'Public Safety',    source:'Flashalert', title:'Petty crime uptick — Pioneer Square',
    location:'Portland', officeId:'PDX', lat:45.518, lng:-122.679, radiusKm:3,
    summary:'+18% property crime month-over-month. Awareness only.', issued: nowMinus(1500) },
  { id:'a11', sev:'mod',  type:'Natural Disaster', source:'NASA EONET', title:'Wildfire smoke — air quality declining',
    location:'Northern California', officeId:'SFO', lat:38.5, lng:-122.5, radiusKm:200,
    summary:'AQI 165 (Unhealthy). N95s recommended.', issued: nowMinus(220) },
  { id:'a12', sev:'high', type:'Public Safety',    source:'GDELT',      title:'Suspicious package — Liffey Quay (cordon active)',
    location:'Dublin', officeId:'DUB', lat:53.347, lng:-6.247, radiusKm:1,
    summary:'AGS bomb squad on scene. Roads closed.', issued: nowMinus(11) },
  { id:'a13', sev:'low',  type:'Travel Advisory',  source:'State Dept', title:'Travel advisory — UAE (1 traveler)',
    location:'UAE', officeId:null, lat:25.276, lng:55.296, radiusKm:0,
    summary:'Routine advisory. R. Chen lodged in Dubai.', issued: nowMinus(5000) },
  { id:'a14', sev:'mod',  type:'Natural Disaster', source:'MeteoAlarm', title:'Severe winds — gusts to 95 km/h',
    location:'Greater London', officeId:'LON', lat:51.51, lng:-0.13, radiusKm:50,
    summary:'Yellow wind warning. Possible transit disruption.', issued: nowMinus(140) },
  { id:'a15', sev:'ext',  type:'Civil Unrest',     source:'ACLED',      title:'Civil unrest — escalation reported, multiple injuries',
    location:'Bengaluru', officeId:'BLR', lat:12.972, lng:77.595, radiusKm:5,
    summary:'Demonstrations turned confrontational in Whitefield.', issued: nowMinus(22) },
  { id:'a16', sev:'low',  type:'Public Safety',    source:'ArcGIS APD', title:'Routine safety bulletin — flu activity moderate',
    location:'Atlanta', officeId:'ATL', lat:33.749, lng:-84.388, radiusKm:0,
    summary:'CDC ILI activity moderate Region 4. No action.', issued: nowMinus(2880) },
  { id:'a17', sev:'mod',  type:'Public Safety',    source:'Flashalert', title:'Power grid advisory — rolling brownouts',
    location:'Hyderabad', officeId:'HYD', lat:17.385, lng:78.487, radiusKm:25,
    summary:'14:00–18:00 IST. UPS verified.', issued: nowMinus(60) },
  { id:'a18', sev:'low',  type:'Public Safety',    source:'GDELT',      title:'Dublin Bus & Luas service reductions',
    location:'Dublin', officeId:'DUB', lat:53.349, lng:-6.26, radiusKm:8,
    summary:'Industrial action Tue–Thu. Recommend remote-first.', issued: nowMinus(720) },
  { id:'a19', sev:'mod',  type:'Civil Unrest',     source:'ACLED',      title:'Demonstration permit issued — march route through City',
    location:'London', officeId:'LON', lat:51.515, lng:-0.09, radiusKm:3,
    summary:'Saturday march; estimated 5k participants.', issued: nowMinus(540) },
  { id:'a20', sev:'low',  type:'Natural Disaster', source:'GDACS',      title:'Tropical storm watch — distant approach',
    location:'Tokyo', officeId:'TYO', lat:35.68, lng:139.65, radiusKm:300,
    summary:'72h monitoring. No immediate impact.', issued: nowMinus(1800) },
];

/* employees: ~headcount/3 each, By-Office plot at office; By-ZIP plot scattered.
   These dots are mock visualization data ("here are the people at this office").
   In live + bare Pages mode where o.headcount is undefined (Workday not yet
   integrated), produce zero dots — no fake employees. Mock mode populates
   o.headcount via the demo bootstrap and the dots scatter as before. */
function buildEmployees() {
  const list = [];
  OFFICES.forEach(o => {
    if (o.headcount == null) return;   // no Workday → no synthetic employees
    const n = Math.min(60, Math.max(8, Math.round(o.headcount / 8)));
    for (let i=0;i<n;i++) {
      const dLat = (Math.random()-.5)*.18; const dLng = (Math.random()-.5)*.22;
      list.push({
        id: o.id+'-e'+i,
        name: randomName(),
        office: o.id,
        role: rand(['Engineer','Sales','Marketing','Customer Success','Recruiter','Finance','Legal','IT','Security','Eng Mgr','PM']),
        lat: o.lat + dLat, lng: o.lng + dLng,
        officeLat: o.lat, officeLng: o.lng,
      });
    }
  });
  return list;
}
EMPLOYEES = buildEmployees();

/* Travelers — populated only in #api=mock by the demo bootstrap (TRAVELERS_MOCK
   defined alongside the demo simulator). Live + bare GitHub Pages keep
   TRAVELERS = [] and the Travelers modal / BCI exposure readout show
   "Pending Navan integration" placeholders, mirroring the existing
   Workday-pending pattern for REMOTE_EMPLOYEES. The Navan API will return
   the same record shape as TRAVELERS_MOCK below; production will swap the
   bootstrap line for a fetch. */

/* ---------- 3. App state ---------- */
/* Crisis Comm templates.
 *
 * Each entry has:
 *   - name      : full label (shown in dropdown options and message preview)
 *   - body      : message body inserted into Compose; operator can edit before sending
 *   - category  : one of TEMPLATE_CATEGORIES below — drives optgroup grouping
 *   - priority  : ordering within the category (lower = first)
 *
 * IDs are stable — saved drafts and incident logs reference them. Adding new
 * variants is safe; renaming or removing existing IDs would break those refs.
 *
 * Smart-suggest in App.crisisFromAlert() picks the best-matching template ID
 * based on alert.type / alert.source / alert.title keywords. See suggestTemplate().
 */


STATE.visibleOffices    = OFFICES.map(o => o.id);
STATE.visibleAlertTypes = ALERT_TYPES.slice();

/* ---------- 4. Map setup ---------- */
const map = L.map('map', { worldCopyJump: true, minZoom: 2, maxZoom: 14, zoomControl: true })
  .setView([28, 5], 2.4);

const TILES = {
  dark:  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains:'abcd', attribution:'© OpenStreetMap, © CARTO' }),
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { subdomains:'abcd', attribution:'© OpenStreetMap, © CARTO' }),
};
TILES.dark.addTo(map);

const layers = {
  offices:  L.layerGroup().addTo(map),
  alerts:   L.layerGroup().addTo(map),
  hazards:  L.layerGroup().addTo(map),
  emp:      L.markerClusterGroup({ disableClusteringAtZoom: 7, iconCreateFunction: c => L.divIcon({ html:`<div class="emp-cluster">${c.getChildCount()}</div>`, className:'', iconSize:[28,28] }) }).addTo(map),
  trav:     L.markerClusterGroup({ disableClusteringAtZoom: 5, iconCreateFunction: c => L.divIcon({ html:`<div class="cluster-mk">${c.getChildCount()}</div>`, className:'', iconSize:[26,26] }) }).addTo(map),
  fence:    L.featureGroup().addTo(map),
};

/* ---------- 5. Helpers ---------- */
// Haversine great-circle distance in km. Used to match alerts to travelers/offices.

// Default impact radius (km) when an alert doesn't carry one. Per category — these are
// loose; tighter is better for travel advisories, looser for tropical cyclones.

// Enrich a backend event with client-side impact data (travelers/employees within radius).
// Returns the event object augmented with affectedTravelers, affectedOfficeImpact, isRelevant.


/**
 * Priority score for sorting alerts. Severity-dominant with a recency penalty.
 * Severity buckets are orders of magnitude apart (1, 10, 100, 1000) so a fresh
 * higher-severity alert always outranks any older lower-severity alert. Within
 * a tier, older alerts drift down by 1 unit per hour aged.
 *
 * Examples:
 *   fresh Extreme = 1000
 *   24h Extreme   =  976
 *   fresh High    =  100
 *   12h High      =   88
 * So a fresh Ext (1000) > 24h Ext (976) > fresh High (100) > 12h High (88) > fresh Mod (10) > fresh Low (1).
 */
/** Highest priority score among a list of alerts; -Infinity if empty. */
/** Escape user-provided strings before injecting into HTML. */
/** Check if a modal is currently open. */

/** Auto-linkify http(s) URLs inside escaped text. Pass already-escaped text. */

/** File-size formatting + icon by MIME type. */
/** Read a File into an attachment object. Embeds as data: URL if small. */
/** Render an attachment chip. removable=true when in draft state. */

/* ---------- 6. Office markers + popups ---------- */
const OFFICE_MARKERS = {};

/* ---------- 7. Alert dots ---------- */


/* ---------- 8. Employees & travelers ---------- */

/* ---------- 9. Hazard overlays (mock) ---------- */

/** Live tile-based overlays — actual real-time data when available. */

/* Tile layers cached after first activation. */
const tileOverlayLayers = { precip: null, temp: null };
let tileOverlayLoading = {};

async function ensurePrecipTileLayer() {
  if (tileOverlayLayers.precip) return tileOverlayLayers.precip;
  if (tileOverlayLoading.precip) return null;
  tileOverlayLoading.precip = true;
  try {
    const resp = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await resp.json();
    const past = data.radar?.past || [];
    const latest = past[past.length - 1];
    if (!latest) throw new Error('No radar data');
    const url = `${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
    tileOverlayLayers.precip = L.tileLayer(url, {
      opacity: 0.65, attribution: '© RainViewer', maxZoom: 12,
    });
    return tileOverlayLayers.precip;
  } catch (err) {
    console.error('RainViewer load failed', err);
    toast('Precipitation radar unavailable (network blocked or RainViewer offline).');
    return null;
  } finally {
    tileOverlayLoading.precip = false;
  }
}

/** NASA GIBS — MODIS Terra Land Surface Temperature (Day). Free, no API key.
 *  Updated daily; we request "yesterday" since today's tiles may not be ready globally. */
function ensureTempTileLayer() {
  if (tileOverlayLayers.temp) return tileOverlayLayers.temp;
  const d = new Date(Date.now() - 24*3600*1000);  // yesterday
  const date = d.toISOString().slice(0, 10);
  const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/${date}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;
  tileOverlayLayers.temp = L.tileLayer(url, {
    opacity: 0.55,
    attribution: '© NASA GIBS · MODIS Terra LST',
    maxZoom: 7,    // GIBS LST max zoom for this layer
    minZoom: 1,
    tileSize: 256,
    errorTileUrl: '',
  });
  return tileOverlayLayers.temp;
}

/** HTML for a hazard-zone popup, including clickable source link. */
function hazardPopupHTML(def, z) {
  return `
    <h4>${esc(def.label)}</h4>
    <div class="addr">${esc(z.label)} · ${z.radiusKm} km radius</div>
    <div style="font-size:11px;line-height:1.4;color:var(--text);margin-bottom:6px">${esc(def.description)}</div>
    <div class="pop-row" style="border-top:1px solid var(--border);padding-top:6px">
      <span style="color:var(--muted)">Source</span>
      <b>${esc(def.source)}</b>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(def.sourceName)}</div>
    <div class="pop-actions">
      <a class="btn-ghost" href="${def.sourceUrl}" target="_blank" rel="noopener">View at source ↗</a>
    </div>`;
}

/** Render polygon hazard zones (fire, flood, quake, unrest, aqi). */

/** Manage live tile overlays (precip + temp). */
async function applyTileOverlays() {
  // Precipitation radar — RainViewer
  if (STATE.hazards.precip) {
    const layer = await ensurePrecipTileLayer();
    if (layer && STATE.hazards.precip && !map.hasLayer(layer)) layer.addTo(map);
  } else if (tileOverlayLayers.precip && map.hasLayer(tileOverlayLayers.precip)) {
    map.removeLayer(tileOverlayLayers.precip);
  }
  // Live land surface temperature — NASA GIBS
  if (STATE.hazards.temp) {
    const layer = ensureTempTileLayer();
    if (layer && !map.hasLayer(layer)) layer.addTo(map);
  } else if (tileOverlayLayers.temp && map.hasLayer(tileOverlayLayers.temp)) {
    map.removeLayer(tileOverlayLayers.temp);
  }
}

/** Update the legend with all active overlays. */

/** Master hazard render — called on every toggle. */

/* ---------- 10. ALERT FEED render ---------- */

/* ---------- 11. CRISIS COMMS render ---------- */

/* Test-mode routing — single channel + single distro shared across all offices.
 *
 * When STATE.isTest is true at dispatch, the message is routed exclusively
 * to these endpoints regardless of the office picker, AND the body is
 * prefixed with a clear drill-warning preamble. The Slack / email / SMS
 * integrations are still simulated stubs in this build, but encoding the
 * routing here means: when those integrations land, the dispatcher already
 * knows where to send a test (and where NOT to send it) without touching
 * compose UI again.
 *
 * Operator override path: if a per-environment test channel needs to differ
 * (e.g., a separate Slack workspace for staging), set window.NRSA_TEST_ROUTING
 * before script load. */

function testRecipientsForChannel(ch) {
  const dest = TEST_ROUTING[ch];
  return dest ? [dest] : [];
}

/* Smart-suggest the best Crisis Comm template for a given alert.
 *
 * Match order (most specific → least):
 *   1. Title keywords for distinctive event sub-classes (active shooter, bomb,
 *      fire, flood, civil unrest sub-types).
 *   2. alert.type + source heuristics (USGS quake → shelter_quake; NWS Tornado
 *      Warning → shelter_severe_weather).
 *   3. Traveler vs office context (no office match but traveler in proximity
 *      → check_traveler).
 *   4. Generic fallback by alert.type.
 *
 * Returns a template id from the TEMPLATES object, or 'check' as a final
 * fallback. The operator can override the suggestion in the dropdown.
 */

/* Render the Compose template <select> with optgroup headers grouped by
   TEMPLATE_CATEGORIES. Custom user templates land in a "Custom" group at
   the end. Returns inner-HTML for the <select>. */
/** Wire a drag/drop + click + paste attachments zone.
 *  zoneEl + inputEl + pickBtnEl + onAdd(att[]) + onRemove(id) callbacks. */


/* ---------- 12. INCIDENTS render ---------- */
function selectIncident(id) {
  STATE.selectedIncidentId = id;
  STATE.incidentTab = 'details';
  renderIncidents();
}
function visibleIncidents() {
  const f = STATE.incidentListFilter;
  if (f === 'all') return STATE.incidents;
  return STATE.incidents.filter(i => i.status === f);
}

/* ---------- 13. Layers panel + filters ---------- */
function loadEmpCSV(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const lines = String(r.result).split(/\r?\n/).filter(Boolean);
      if (!lines.length) { toast('CSV is empty.'); return; }
      const headers = lines.shift().split(',').map(s=>s.trim().toLowerCase());
      // Require at least one of the two office identifiers + a name column
      if (headers.indexOf('office') === -1 && headers.indexOf('office_code') === -1) {
        toast('CSV missing required column: "office" (or "office_code").'); return;
      }
      if (headers.indexOf('name') === -1) {
        toast('CSV missing required column: "name".'); return;
      }
      const idx = (k) => headers.indexOf(k);
      const rows = lines.map(l => l.split(','));
      const out = []; let skipped = 0;
      rows.forEach((c, i) => {
        const office = ((idx('office') >= 0 ? c[idx('office')] : '') || (idx('office_code') >= 0 ? c[idx('office_code')] : '') || '').trim().toUpperCase();
        const o = OFFICE_BY_ID[office];
        if (!o) { skipped++; return; }
        const lat = parseFloat(c[idx('lat')]); const lng = parseFloat(c[idx('lng')]);
        out.push({
          id:'csv-'+i, name: (c[idx('name')]||'').trim()||randomName(), office,
          role: (idx('role') >= 0 ? c[idx('role')] : '')||'',
          lat: isFinite(lat)?lat:o.lat+(Math.random()-.5)*.18,
          lng: isFinite(lng)?lng:o.lng+(Math.random()-.5)*.22,
          officeLat:o.lat, officeLng:o.lng,
        });
      });
      EMPLOYEES = out;
      renderEmployees();
      toast(`${out.length} employees loaded${skipped?` · ${skipped} skipped (unknown office)`:''}.`);
    } catch(err) {
      toast('Failed to parse CSV. Check the file format.');
      console.error(err);
    }
  };
  r.onerror = () => toast('Failed to read CSV file.');
  r.readAsText(file);
}
function loadTravCSV(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const lines = String(r.result).split(/\r?\n/).filter(Boolean);
      if (!lines.length) { toast('CSV is empty.'); return; }
      const headers = lines.shift().split(',').map(s=>s.trim().toLowerCase());
      if (headers.indexOf('name') === -1) { toast('Traveler CSV missing required column: "name".'); return; }
      const idx = k => headers.indexOf(k);
      // Note: an earlier `safe(i)` helper existed here but was orphaned
      // when the .map callback was inlined. Removed 2026-07-03 after ESLint
      // no-undef flagged it as referencing an out-of-scope `c`.
      const rows = lines.map(l => l.split(','));
      const out = rows.map((c,i) => ({
        id:'tcsv-'+i, name: (c[idx('name')]||'').trim()||randomName(),
        home: ((idx('home_office') >= 0 ? c[idx('home_office')] : '')||'').trim().toUpperCase(),
        destCity: (idx('destination') >= 0 ? c[idx('destination')] : '')||'Unknown',
        type: (idx('booking_type') >= 0 ? c[idx('booking_type')] : '')||'hotel',
        lat: parseFloat(idx('lat') >= 0 ? c[idx('lat')] : 0)||0,
        lng: parseFloat(idx('lng') >= 0 ? c[idx('lng')] : 0)||0,
        atOffice: ((idx('at_office') >= 0 ? c[idx('at_office')] : '')||'').trim().toUpperCase()||null,
      }));
      TRAVELERS = out;
      renderTravelers(); renderOffices();
      toast(`${out.length} travelers loaded.`);
    } catch(err) {
      toast('Failed to parse traveler CSV.');
      console.error(err);
    }
  };
  r.onerror = () => toast('Failed to read CSV file.');
  r.readAsText(file);
}

/* ---------- 14. Geo-fence ---------- */
const drawHandlers = {};
function disableAllDrawHandlers() {
  Object.values(drawHandlers).forEach(h => h?.disable && h.disable());
}
function setupDraw() {
  drawHandlers.circle    = new L.Draw.Circle(map,    { shapeOptions: { color: SEV_COLOR.high, weight: 2, fillOpacity: .1 } });
  drawHandlers.rectangle = new L.Draw.Rectangle(map, { shapeOptions: { color: SEV_COLOR.high, weight: 2, fillOpacity: .1 } });
  drawHandlers.polygon   = new L.Draw.Polygon(map,   { shapeOptions: { color: SEV_COLOR.high, weight: 2, fillOpacity: .1 } });
  document.querySelectorAll('[data-shape]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-shape]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    disableAllDrawHandlers();              // ensure only one shape handler is live
    if (STATE.fence) clearFence();
    drawHandlers[b.dataset.shape].enable();
    toast('Click on the map to draw.');
    // Announce draw-mode activation through the aria-live region in the
    // geo-fence tab body. Helps screen-reader users and serves as a second
    // visual confirmation for sighted users (the toast can be missed when
    // the operator is looking at the map).
    const live = document.getElementById('fence-live-status');
    if (live) {
      const shape = b.dataset.shape;
      const verb = shape === 'polygon' ? 'Click points to outline a polygon, double-click to close.' : 'Click and drag on the map to draw.';
      live.textContent = `${shape.charAt(0).toUpperCase()}${shape.slice(1)} draw mode active. ${verb}`;
    }
  }));
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    STATE.fenceMode = b.dataset.mode;
    if (STATE.fence) computeFenceResults();
  }));
  map.on(L.Draw.Event.CREATED, e => {
    disableAllDrawHandlers();              // exit drawing mode after a shape lands
    document.querySelectorAll('[data-shape]').forEach(x => x.classList.remove('active'));
    const layer = e.layer; layers.fence.addLayer(layer);
    STATE.fence = { layer, shape: e.layerType };
    computeFenceResults();
    // If the BCI form was waiting for a fence, close Map Tools and reopen
    // the modal with form state preserved + useFence pre-checked.
    if (typeof BCP_FORM !== 'undefined' && BCP_FORM._waitingForFence) {
      BCP_FORM.useFence = true;
      if (typeof clearBCIWaitingChip === 'function') clearBCIWaitingChip();
      document.getElementById('tools-dropdown').classList.remove('open');
      showBCPModal(true);
    }
  });
  document.getElementById('btn-fence-clear').onclick = clearFence;
  document.getElementById('btn-fence-export').onclick = exportFenceCSV;
  document.getElementById('btn-fence-crisis').onclick = fenceToCrisis;
}
function clearFence() {
  layers.fence.clearLayers();
  STATE.fence = null;
  document.getElementById('fence-bottom').style.display = 'none';
  document.getElementById('fence-results').innerHTML = '<div class="empty">Draw a shape to see results.</div>';
  document.getElementById('fence-result-summary').textContent = '';
  document.getElementById('fence-badge').textContent = '';
  renderAll();
}
function pointInFence(lat, lng) {
  if (!STATE.fence) return false;
  const layer = STATE.fence.layer;
  if (layer.getRadius) {
    const c = layer.getLatLng();
    return map.distance([lat,lng], [c.lat, c.lng]) <= layer.getRadius();
  }
  if (layer.getBounds && STATE.fence.shape === 'rectangle') {
    return layer.getBounds().contains([lat, lng]);
  }
  if (STATE.fence.shape === 'polygon') {
    const pts = layer.getLatLngs()[0];
    let inside = false;
    for (let i=0,j=pts.length-1;i<pts.length;j=i++) {
      const xi=pts[i].lat, yi=pts[i].lng, xj=pts[j].lat, yj=pts[j].lng;
      const intersect = ((yi>lng)!==(yj>lng)) && (lat < (xj-xi)*(lng-yi)/(yj-yi)+xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  return false;
}
function computeFenceResults() {
  if (!STATE.fence) return;
  const offIn = OFFICES.filter(o => pointInFence(o.lat, o.lng));
  const empIn = EMPLOYEES.filter(e => pointInFence(STATE.empMode==='zip'?e.lat:e.officeLat, STATE.empMode==='zip'?e.lng:e.officeLng));
  const travIn = TRAVELERS.filter(t => pointInFence(t.lat, t.lng));
  const alertIn = ALERTS.filter(a => pointInFence(a.lat, a.lng));
  STATE.fence.results = { offices: offIn, employees: empIn, travelers: travIn, alerts: alertIn };
  // dropdown
  const drop = document.getElementById('fence-results');
  drop.innerHTML = `
    <div class="fence-row"><b>Offices</b><span>${offIn.length}</span></div>
    ${offIn.map(o=>`<div class="fence-row"><span>${o.id} · ${o.name}</span><span>${o.headcount!=null?`${fmtHeadcount(o.headcount)} emp`:`<span style="font-style:italic;opacity:0.7">pending Workday integration</span>`}</span></div>`).join('')}
    <div class="fence-row" style="margin-top:6px"><b>Alerts</b><span>${alertIn.length}</span></div>
    ${alertIn.slice(0,5).map(a=>`<div class="fence-row" style="cursor:pointer" onclick="App.showAlertDetails('${a.id}')"><span class="sev-pill ${a.sev}">${SEV_NAME[a.sev]}</span><span>${a.title.slice(0,30)}…</span><span style="color:var(--green);font-size:10px">Details ›</span></div>`).join('')}
  `;
  document.getElementById('fence-result-summary').textContent = `${empIn.length} emp · ${travIn.length} trav`;
  // bottom bar
  const bar = document.getElementById('fence-bottom');
  bar.style.display = 'flex';
  const empByOffice = {}; empIn.forEach(e => empByOffice[e.office] = (empByOffice[e.office]||0)+1);
  const travByDest = {}; travIn.forEach(t => travByDest[t.destCity] = (travByDest[t.destCity]||0)+1);
  bar.innerHTML = `
    <span class="count-emp">● ${empIn.length} employees in geofence</span>
    <span class="count-trav">● ${travIn.length} travelers in geofence</span>
    ${Object.entries(empByOffice).map(([k,v])=>`<span class="chip emp">${k} ${v}</span>`).join('')}
    ${Object.entries(travByDest).slice(0,4).map(([k,v])=>`<span class="chip trav">✈ ${k} ${v}</span>`).join('')}
    <button class="btn-ghost" onclick="App.exportFenceCSV()">Export CSV</button>
    <button class="btn-primary" style="width:auto;margin:0;padding:6px 12px" onclick="App.fenceToCrisis()">Crisis →</button>
  `;
  // Fence badge
  const maxSev = alertIn.reduce((m,a)=>Math.max(m, SEV_RANK[a.sev]),0);
  const badge = document.getElementById('fence-badge');
  if (maxSev) badge.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${SEV_COLOR[SEVERITY[maxSev-1]]};margin-left:4px"></span>`;
  // Filter mode hides things outside
  if (STATE.fenceMode === 'filter') {
    // dim non-fenced offices visually (re-render with subset)
    STATE.visibleOffices = offIn.map(o => o.id);
    document.querySelectorAll('[data-vis-office]').forEach(c => c.checked = STATE.visibleOffices.includes(c.dataset.visOffice));
    renderAll();
  }
}
function exportFenceCSV() {
  if (!STATE.fence?.results) return;
  const r = STATE.fence.results;
  const rows = [['Type','Name','Office','Role/Dest','Lat','Lng']];
  r.employees.forEach(e => rows.push(['home', e.name, e.office, e.role||'', e.lat, e.lng]));
  r.travelers.forEach(t => rows.push(['traveler', t.name, t.home, t.destCity, t.lat, t.lng]));
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='geofence-export.csv'; a.click();
  URL.revokeObjectURL(url);
  toast('Geofence exported.');
}
function fenceToCrisis() {
  if (!STATE.fence?.results) return;
  STATE.selectedOffices = STATE.fence.results.offices.map(o => o.id);
  openPanel('crisis'); setCcTab('compose'); renderCC();
  toast(`${STATE.selectedOffices.length} office(s) pre-selected.`);
}

/* ---------- 15. Panels & dropdown management ---------- */
['alerts','crisis','incident'].forEach(p => {
  const rail = document.getElementById('rail-'+p);
  rail.addEventListener('click', () => togglePanel(p));
  rail.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(p); }
  });
});
document.getElementById('btn-collapse-alerts').onclick = () => closePanel('alerts');
document.getElementById('btn-collapse-crisis').onclick = () => closePanel('crisis');
document.getElementById('btn-collapse-incident').onclick = () => closePanel('incident');

/* Position the Map Tools dropdown anchored to its trigger button so it
   stays adjacent on any viewport. The fixed top:112px / right:14px in CSS
   only worked when the map had ample room; with both right panels open
   the dropdown's right edge ended up overlapping the map's marker zone.
   Computing position at open time keeps the dropdown glued to the button. */

document.getElementById('btn-tools').onclick = (e) => {
  e.stopPropagation();
  const dd = document.getElementById('tools-dropdown');
  dd.classList.toggle('open');
  if (dd.classList.contains('open')) positionToolsDropdown();
};
document.addEventListener('click', e => {
  if (!e.target.closest('.tools-dropdown') && !e.target.closest('#btn-tools'))
    document.getElementById('tools-dropdown').classList.remove('open');
});
// Keep the dropdown glued to the button across viewport changes (window
// resize, panel drag-resize, theme toggle that shifts header heights, etc.)
// while the dropdown is visible. No-op when closed.
window.addEventListener('resize', () => {
  const dd = document.getElementById('tools-dropdown');
  if (dd && dd.classList.contains('open')) positionToolsDropdown();
});
// Tab switching inside the Map Tools dropdown
function setMapToolsTab(tab) {
  document.querySelectorAll('[data-tools-tab]').forEach(b => {
    const on = b.dataset.toolsTab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('[data-tools-body]').forEach(b => {
    b.style.display = b.dataset.toolsBody === tab ? '' : 'none';
  });
}
document.querySelectorAll('[data-tools-tab]').forEach(t => t.addEventListener('click', () => setMapToolsTab(t.dataset.toolsTab)));
// Helper exposed via App after init (see window.App definition below).
function openMapToolsTab(tab) {
  document.getElementById('tools-dropdown').classList.add('open');
  setMapToolsTab(tab);
}

document.querySelectorAll('[data-feed-tab]').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('[data-feed-tab]').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  STATE.feedTab = t.dataset.feedTab;
  renderFeed();
}));
document.querySelectorAll('[data-cc-tab]').forEach(t => t.addEventListener('click', () => setCcTab(t.dataset.ccTab)));
document.getElementById('feed-search').addEventListener('input', e => { STATE.search = e.target.value; renderFeed(); });

document.getElementById('btn-reset-view').onclick = () => App.resetView();
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (isModalOpen()) { closeModal(); return; }   // close modal first
  const tools = document.getElementById('tools-dropdown');
  if (tools && tools.classList.contains('open')) {
    tools.classList.remove('open');
    return;
  }
  App.resetView();
});

document.getElementById('btn-style').onclick = () => applyTheme(STATE.theme === 'dark' ? 'light' : 'dark');
// restore saved theme on boot
try {
  const saved = localStorage.getItem('nrsa-theme');
  if (saved === 'light' || saved === 'dark') applyTheme(saved);
} catch(_) {}


document.getElementById('btn-help').onclick = () => {
  showModal(`<h3>Quick Reference</h3>
    <ol style="font-size:12px;line-height:1.6;padding-left:18px">
      <li><b>Monitor</b> — Office markers turn yellow/orange/red as severity rises. Click any marker for headcount and active alerts.</li>
      <li><b>Assess</b> — Click an alert card to zoom; hit the inline <span class="sev-pill" style="background:rgba(28,231,131,.12);color:var(--green);border:1px solid var(--green);padding:1px 5px;border-radius:3px">Crisis</span> button to pre-load Crisis Comms.</li>
      <li><b>Geo-fence</b> — Header → ✏︎ Geo-fence → pick a shape → draw. Results appear in the dropdown plus the bottom bar.</li>
      <li><b>Compose</b> — Pick offices, channels, template, then Send. With Response Required, an incident is auto-created and linked. Drag files into the Attachments zone to include them; URLs auto-link.</li>
      <li><b>Track</b> — Incident <b>Comms</b> tab shows the message flow (Safety Check → Shelter → All Clear). <b>Responses</b> tab tracks each employee with All / No Response / OK / Help filters.</li>
      <li><b>Document & Close</b> — Notes tab supports drop-in files. Log tab shows the auto-generated timeline. End Incident to seal — Reopen any time to continue.</li>
      <li><b>Export</b> — Hit 📄 Export Report on any incident for a printable report with originating alert, sources, and full audit trail.</li>
    </ol>
    <h4 style="margin-top:14px">Severity</h4>
    <div style="display:flex;gap:6px;font-size:11px">
      ${SEVERITY.map(s=>`<span class="sev-pill ${s}">${SEV_NAME[s]}</span>`).join('')}
    </div>
    <h4 style="margin-top:12px">Sources active</h4>
    <p style="font-size:11px;color:var(--muted)">${SOURCES.map(s=>s.id).join(' · ')}</p>
    <h4 style="margin-top:14px">Local Data</h4>
    <p style="font-size:11px;color:var(--muted);line-height:1.5;margin-bottom:8px">
      All your incidents, drafts, sent messages, and notes are saved to this browser. Use these tools to back up or wipe.
    </p>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn-ghost" onclick="App.exportData()">⬇ Export Data (JSON)</button>
      <button class="btn-ghost danger" onclick="App.resetData()">🗑 Reset Local Data</button>
    </div>
    <div class="modal-actions"><button class="btn-ghost" onclick="App.closeModal()">Close</button></div>`);
};

document.getElementById('btn-new-incident').onclick = () => {
  showModal(`<h3>New Incident</h3>
    <div class="field"><label>Title</label><input id="ni-title" placeholder="e.g. Office Lockdown — SFO"/></div>
    <div class="field"><label>Severity</label>
      <select id="ni-sev">${SEVERITY.map(s=>`<option value="${s}">${SEV_NAME[s]}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Affected Offices</label>
      <div class="office-picker">${OFFICES.map(o=>`<label><input type="checkbox" data-ni-office="${o.id}"/> ${o.id} · ${o.name}</label>`).join('')}</div>
    </div>
    <div class="field"><label>Description</label><textarea id="ni-desc" placeholder="Brief situation summary..."></textarea></div>
    <div class="modal-actions"><button class="btn-ghost" id="modal-cancel">Cancel</button>
    <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px" id="modal-confirm">Create Incident</button></div>`);
  document.getElementById('modal-cancel').onclick = closeModal;
  document.getElementById('modal-confirm').onclick = () => {
    const title = document.getElementById('ni-title').value || 'Untitled incident';
    const sev = document.getElementById('ni-sev').value;
    const desc = document.getElementById('ni-desc').value || '';
    const offices = [...document.querySelectorAll('[data-ni-office]:checked')].map(c => c.dataset.niOffice);
    if (!offices.length) { toast('Select at least one office.'); return; }
    const inc = createIncident({ title, offices, severity: sev, description: desc });
    closeModal();
    selectIncident(inc.id);
  };
};

/* ---------- 16. Modals + toast ---------- */

/* ---------- 17. Public hooks for popup buttons ---------- */
window.App = {
  targetOffice(id) {
    if (!STATE.selectedOffices.includes(id)) STATE.selectedOffices.push(id);
    openPanel('crisis'); setCcTab('compose'); renderCC();
    toast(`${id} added to Crisis Comms.`);
  },
  zoomOffice(id) {
    const o = OFFICE_BY_ID[id]; if (!o) return;
    const m = OFFICE_MARKERS[id];
    // open the popup once the pan settles (no magic timeout)
    if (m) map.once('moveend', () => m.openPopup());
    map.setView([o.lat, o.lng], 7);
  },
  resetView() {
    // close any open popup, fit to all offices
    map.closePopup();
    map.fitBounds(L.latLngBounds(OFFICES.map(o => [o.lat, o.lng])), { padding: [40, 60] });
    STATE.selectedAlertId = null;
    renderFeed();
  },
  removeOffice(id) {
    STATE.selectedOffices = STATE.selectedOffices.filter(x => x !== id);
    renderCC();
  },
  crisisFromAlert(alertId) {
    const a = ALERTS.find(x => x.id === alertId); if (!a) return;
    if (a.officeId && !STATE.selectedOffices.includes(a.officeId)) {
      STATE.selectedOffices = [a.officeId];
    }
    // Pre-fill subject with alert context, only if currently empty
    if (!STATE.subject) {
      const o = a.officeId ? OFFICE_BY_ID[a.officeId] : null;
      STATE.subject = `[${SEV_NAME[a.sev]}] ${a.title}${o?` — ${o.name}`:''}`;
    }
    // Smart-suggest a template based on the alert. Only if the operator hasn't
    // already picked one (e.g. via a prior Crisis click + draft persistence).
    let suggestedTplName = '';
    if (!STATE.template) {
      const id = suggestTemplate(a);
      if (id && TEMPLATES[id]) {
        STATE.template = id;
        suggestedTplName = TEMPLATES[id].name;
      }
    }
    map.closePopup();
    openPanel('crisis');
    setCcTab('compose');
    renderCC();
    const titleSnippet = a.title.slice(0,40) + (a.title.length>40?'…':'');
    toast(suggestedTplName
      ? `Pre-loaded Crisis Comms for "${titleSnippet}" · template: ${suggestedTplName}`
      : `Pre-loaded Crisis Comms for "${titleSnippet}"`);
  },
  exportFenceCSV, fenceToCrisis, closeModal,
  showAlertDetails,
  selectAlert,
  showFreshness,
  exportData, resetData,
  openMapToolsTab,
};

/* ---------- 17b. Alert Details — opens in a new tab ---------- */

/* ---------- 17c. Incident Report — opens in a new tab ---------- */

/* ---------- 17d. Persistence (localStorage) ---------- */

/** Strip the (potentially huge) data: URL from an attachment, keep metadata. */

/* ---------- 17e. Status Strip ---------- */


/* ---------- 18. Master render ---------- */

/* Tick the status strip once a minute so the "Last fetch" chip ages without
   needing another event to trigger a re-render. Cheap (renderStatusStrip is
   <1ms), and only does meaningful work in live mode where the chip exists.
   The 60s cadence is intentional — finer would over-render; coarser would
   leave operators staring at a stale label during a real backend outage. */
// Kick off on next tick so DOM has been built.
setTimeout(startStatusStripTicker, 0);

/* ---------- 18b. Panel resize ---------- */

/* ---------- 19. Boot ---------- */
const _restored = loadState();
buildLayerControls();
setupDraw();
applyPanelWidths();
setupPanelResize();
renderAll();
if (_restored) {
  setTimeout(() => toast(`Restored from local save${lastSavedAt?` (${relTime(lastSavedAt.toISOString())} ago)`:''}.`), 400);
}
/* Fit map to show all offices, with padding for the rails/header */
map.fitBounds(L.latLngBounds(OFFICES.map(o => [o.lat, o.lng])), { padding: [40, 60] });
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    map.invalidateSize();
    // only re-fit if user hasn't drilled into a specific selection
    if (!STATE.selectedAlertId && !STATE.selectedIncidentId && !STATE.fence) {
      map.fitBounds(L.latLngBounds(OFFICES.map(o => [o.lat, o.lng])), { padding: [40, 60] });
    }
  }, 120);
});
function tick() {
  // Re-render just the status strip every 30s so the relative "refreshed Xm ago" updates.
  renderStatusStrip();
}
tick(); setInterval(tick, 30000);

/* ---------- 20. URL hash routing ---------- */
function handleHashRoute() {
  const h = location.hash;
  let m;
  if (m = h.match(/^#alert\/(.+)$/)) {
    const a = ALERTS.find(x => x.id === m[1]);
    if (a) { selectAlert(a.id); openPanel('alerts'); }
    history.replaceState(null, '', location.pathname + location.search);
  } else if (m = h.match(/^#open-incident\/(.+)$/)) {
    const a = ALERTS.find(x => x.id === m[1]);
    if (a && a.officeId) {
      const inc = createIncident({
        title: a.title, offices: [a.officeId], severity: a.sev,
        description: `Auto-opened from alert ${a.id}: ${a.summary}`,
        alertId: a.id,
      });
      openPanel('incident');
      selectIncident(inc.id);
      toast('Incident opened from alert.');
    }
    history.replaceState(null, '', location.pathname + location.search);
  } else if (m = h.match(/^#incident\/(.+)$/)) {
    const inc = STATE.incidents.find(x => x.id === m[1]);
    if (inc) { openPanel('incident'); selectIncident(inc.id); }
    history.replaceState(null, '', location.pathname + location.search);
  }
}
window.addEventListener('hashchange', handleHashRoute);
handleHashRoute();

/* Map opens at global view — no auto-selection */

/* ============================================================
   21. LIVE BACKEND MODE (only active when API_BASE is set)
   ============================================================
   When API_BASE is empty, the dashboard runs entirely on the
   hardcoded mock data above. When set to a real URL (e.g. your
   Fly.io app), the dashboard:
     1. Prompts for email + password if no JWT is cached
     2. Fetches initial alerts from /api/events
     3. Subscribes to /api/events/stream for live push updates
     4. Reads operator identity from /api/auth/me
*/




/* ---------- Incident API helpers (Sprint 5 backend) ----------
 *
 * Wraps the /api/incidents/* and /api/comms/* endpoints and translates
 * the backend's snake_case payloads into the camelCase shape the
 * frontend STATE.incidents and STATE.crisisLog use. Each helper either
 * returns the mapped result or throws — callers should handle errors
 * with a try/catch + toast or graceful fallback.
 *
 * In bare/mock mode (API_BASE === ''), these helpers short-circuit
 * with a clear error so localStorage paths can take over.
 */

/** Map a backend incidents row into the prototype's STATE.incidents shape. */




// Map backend granular type ('earthquake', 'tornado_warning', etc.) to one of the
// 4 frontend categories the filter UI knows about. Used as a fallback only —
// the authoritative path is the API's `category` field (see mapBackendCategory).

// Authoritative: backend writes `category` at ingest per-adapter. This 1:1 map
// translates the backend's coarse-category enum to the frontend's display
// names. Health entries don't currently have a frontend filter — they live
// in the WHO outbreaks panel rather than the alert feed.

// Source-ID fallback when neither `category` nor `type` resolves cleanly.
// Avoids the old failure mode where SF/ATL police events fell through to
// 'Natural Disaster'.

/** Resolve an event's display category, preferring authoritative sources in
 *  this order: API category → granular type map → source-ID fallback →
 *  conservative default. The old code defaulted unmapped types to
 *  'Natural Disaster' which silently mislabeled SFPD/APD/TfL events. */

// Legacy entry point kept so existing call sites don't break. New code should
// pass the full event object and call mapBackendCategory(evt).

// Detect EONET prescribed-fire entries (controlled government burns, not threats)




/**
 * Sprint 5 phase 5 — auto-migrate localStorage-only incidents to Postgres.
 *
 * Background: incidents created before the backend persistence layer landed
 * (or any time the API persist failed and the user kept working) live in
 * localStorage with a local-shape id (`i_xxx` from uid()). Once the user
 * boots in live mode against a healthy backend, those incidents would be
 * silently overwritten by backfillIncidents — which replaces STATE.incidents
 * with the server's canonical list. So before we backfill, we sweep up any
 * local-only entries and POST them.
 *
 * Strategy: best-effort, sequential. Create the incident on the server,
 * swap STATE.incidents[i].id (and STATE.responses[id], STATE.selectedIncidentId,
 * STATE.linkedIncidentId) to the new server UUID, then post each
 * message / note / response / close in order. Each sub-resource is wrapped
 * in its own try/catch so a single failure doesn't strand the rest of the
 * incident's history.
 *
 * After migration completes, backfillIncidents runs and replaces STATE
 * with the canonical server list — which now includes everything we just
 * migrated, so the swap is invisible to the operator beyond a single toast.
 */




if (API_BASE) {
  if (getStoredToken()) bootLiveMode();
  else showLoginModal();
}

/* =========================================================================
   21b. TRAVELERS LIST MODAL
   Click ✈ Travelers in header → modal with sortable table, search, type
   filter (flight/hotel/office), CSV export, and per-row actions: 📍 zoom
   map to the traveler, ✉ pre-fill Crisis Comms with traveler context.
   ========================================================================= */

function _fmtTravDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}
function _fmtTravTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}










document.getElementById('btn-travelers').onclick = () => showTravelersList();
document.getElementById('btn-risk').onclick = () => showRiskProfileModal();

/* =========================================================================
   21c. BCP DECLARATION — operator-triggered Business Continuity event
   Manual trigger for Q3 (macro-level events the operator already knows
   about: terror, mass-casualty, major quake, hurricane, geopolitical).
   Picks geographic scope by country (or drawn geo-fence), shows live
   exposure (offices + travelers + remote employees in demo mode), creates
   an Incident tagged BCP, pre-fills Crisis Comms with affected scope.
   ========================================================================= */

/* Mock office headcounts — populated onto OFFICES only in demo mode (see
   boot below). Live + bare Pages leave o.headcount undefined and the UI
   shows "pending Workday integration" placeholders. Office identity itself
   (location, address, name) is real and lives in OFFICES at the top of file. */
const OFFICE_HEADCOUNTS_MOCK = {
  SFO: 412, PDX: 188, ATL: 262,
  BCN: 142, DUB: 217, LON: 305,
  TYO: 96,  BLR: 512, HYD: 484,
};

/* Mock travelers — populated only in demo mode (see boot below).
   Live + bare Pages keep TRAVELERS = [] and the Travelers modal /
   BCI exposure readout show "Pending Navan integration" instead of fake names.
   Companion to REMOTE_EMPLOYEES_MOCK below; same pattern. */
const TRAVELERS_MOCK = [
  { id:'t1', name:'A. Patel', home:'BLR', destCity:'Singapore', country:'Singapore',
    type:'hotel', lat:1.3521, lng:103.8198, atOffice:null,
    hotel:{ name:'Marina Bay Sands', address:'10 Bayfront Ave, Singapore 018956', checkIn:'2026-06-01', checkOut:'2026-06-05', confirm:'MBS-7821' },
    lastKnownTs:'2026-06-03T08:12:00Z' },
  { id:'t2', name:'M. Diaz', home:'SFO', destCity:'Mexico City', country:'Mexico',
    type:'hotel', lat:19.4326, lng:-99.1332, atOffice:null,
    hotel:{ name:'Four Seasons Mexico City', address:'Paseo de la Reforma 500, CDMX', checkIn:'2026-06-02', checkOut:'2026-06-06', confirm:'FS-44102' },
    lastKnownTs:'2026-06-03T07:35:00Z' },
  { id:'t3', name:'R. Chen', home:'LON', destCity:'Dubai', country:'UAE',
    type:'hotel', lat:25.2048, lng:55.2708, atOffice:null,
    hotel:{ name:'Jumeirah Emirates Towers', address:'Sheikh Zayed Rd, Dubai', checkIn:'2026-05-30', checkOut:'2026-06-04', confirm:'JET-9930' },
    lastKnownTs:'2026-06-03T06:50:00Z' },
  { id:'t4', name:'L. Okafor', home:'DUB', destCity:'Paris', country:'France',
    type:'hotel', lat:48.8566, lng:2.3522, atOffice:null,
    hotel:{ name:'Le Meurice', address:'228 Rue de Rivoli, 75001 Paris', checkIn:'2026-06-03', checkOut:'2026-06-07', confirm:'LM-3318' },
    lastKnownTs:'2026-06-03T08:40:00Z' },
  { id:'t5', name:'J. Park', home:'TYO', destCity:'Seoul', country:'South Korea',
    type:'hotel', lat:37.5665, lng:126.978, atOffice:null,
    hotel:{ name:'Lotte Hotel Seoul', address:'30 Eulji-ro, Jung-gu, Seoul', checkIn:'2026-06-02', checkOut:'2026-06-05', confirm:'LHS-2207' },
    lastKnownTs:'2026-06-03T08:05:00Z' },
  { id:'t6', name:'S. Nakamura', home:'TYO', destCity:'San Francisco', country:'USA',
    type:'office', lat:OFFICE_BY_ID.SFO.lat, lng:OFFICE_BY_ID.SFO.lng, atOffice:'SFO',
    office:{ id:'SFO', arriveDate:'2026-06-01', departDate:'2026-06-07' },
    lastKnownTs:'2026-06-03T08:30:00Z' },
  { id:'t7', name:'V. Romano', home:'BCN', destCity:'London', country:'UK',
    type:'office', lat:OFFICE_BY_ID.LON.lat, lng:OFFICE_BY_ID.LON.lng, atOffice:'LON',
    office:{ id:'LON', arriveDate:'2026-06-02', departDate:'2026-06-09' },
    lastKnownTs:'2026-06-03T07:55:00Z' },
  { id:'t8', name:'P. Banerjee', home:'BLR', destCity:'Berlin', country:'Germany',
    type:'hotel', lat:52.52, lng:13.405, atOffice:null,
    hotel:{ name:'Hotel Adlon Kempinski', address:'Unter den Linden 77, 10117 Berlin', checkIn:'2026-06-03', checkOut:'2026-06-08', confirm:'HAK-5541' },
    lastKnownTs:'2026-06-03T08:18:00Z' },
  { id:'t9', name:'K. Liu', home:'PDX', destCity:'JFK→LHR', country:'In transit',
    type:'flight', lat:30.0, lng:-40.0, atOffice:null,
    flight:{ airline:'British Airways', number:'BA178', origin:'JFK', dest:'LHR', departure:'2026-06-02T22:00:00Z', arrival:'2026-06-03T10:00:00Z' },
    lastKnownTs:'2026-06-03T03:20:00Z' },
  { id:'t10', name:'O. Adeyemi', home:'LON', destCity:'Dublin', country:'Ireland',
    type:'office', lat:OFFICE_BY_ID.DUB.lat, lng:OFFICE_BY_ID.DUB.lng, atOffice:'DUB',
    office:{ id:'DUB', arriveDate:'2026-06-03', departDate:'2026-06-06' },
    lastKnownTs:'2026-06-03T08:45:00Z' },
  { id:'t11', name:'H. Tanaka', home:'TYO', destCity:'Bengaluru', country:'India',
    type:'office', lat:OFFICE_BY_ID.BLR.lat, lng:OFFICE_BY_ID.BLR.lng, atOffice:'BLR',
    office:{ id:'BLR', arriveDate:'2026-05-30', departDate:'2026-06-10' },
    lastKnownTs:'2026-06-03T07:48:00Z' },
  { id:'t12', name:'N. Walsh', home:'DUB', destCity:'Reykjavik', country:'Iceland',
    type:'hotel', lat:64.1466, lng:-21.9426, atOffice:null,
    hotel:{ name:'Hotel Borg', address:'Pósthússtræti 11, 101 Reykjavík', checkIn:'2026-06-01', checkOut:'2026-06-05', confirm:'HB-1190' },
    lastKnownTs:'2026-06-03T08:02:00Z' },
];

/* Mock remote employees — populated only in demo mode (see boot below).
   Live + bare Pages keep REMOTE_EMPLOYEES = [] and the BCP modal shows
   "Remote employees: pending Workday integration" instead of a count. */
const REMOTE_EMPLOYEES_MOCK = (() => {
  const data = [
    ['USA',     35, ['Austin TX','Denver CO','Charlotte NC','Boston MA','Seattle WA','Chicago IL','Miami FL','Phoenix AZ','Nashville TN','New York NY','Salt Lake City UT','Minneapolis MN','Raleigh NC','Pittsburgh PA','Kansas City MO','Indianapolis IN','Cleveland OH','Sacramento CA','Tampa FL','St. Louis MO']],
    ['UK',       8, ['Manchester','Edinburgh','Bristol','Leeds','Glasgow','Birmingham','Cardiff','Belfast']],
    ['India',    7, ['Mumbai','Delhi','Pune','Chennai','Kolkata','Ahmedabad','Jaipur']],
    ['Spain',    4, ['Madrid','Valencia','Seville','Bilbao']],
    ['Ireland',  4, ['Cork','Galway','Limerick','Waterford']],
    ['Japan',    5, ['Osaka','Kyoto','Yokohama','Fukuoka','Sapporo']],
    ['Germany',  6, ['Munich','Hamburg','Frankfurt','Stuttgart','Cologne','Düsseldorf']],
    ['Mexico',   2, ['Mexico City','Guadalajara']],
    ['France',   2, ['Lyon','Marseille']],
    ['Australia',3, ['Sydney','Melbourne','Brisbane']],
    ['Canada',   4, ['Toronto','Vancouver','Montreal','Calgary']],
  ];
  const homeFor = (country) => country === 'USA' ? rand(['SFO','PDX','ATL']) : country === 'UK' ? 'LON' : country === 'India' ? rand(['BLR','HYD']) : country === 'Spain' ? 'BCN' : country === 'Ireland' ? 'DUB' : country === 'Japan' ? 'TYO' : country === 'Germany' || country === 'France' ? 'BCN' : country === 'Mexico' ? 'SFO' : country === 'Canada' ? 'PDX' : country === 'Australia' ? 'TYO' : 'SFO';
  let id = 0; const list = [];
  data.forEach(([country, n, cities]) => {
    for (let i = 0; i < n; i++) {
      list.push({ id:'r'+(++id), name: randomName(), country, city: cities[i % cities.length], home: homeFor(country) });
    }
  });
  return list;
})();

/* Mock ACLED country risk rollups — last 30 days of vetted civil-unrest /
 * armed-conflict events per country. Populated only in demo mode (see boot
 * below). Live + bare Pages keep ACLED_RISK = {} and the BCI modal shows
 * "pending ACLED license & integration" placeholder.
 *
 * Numbers below are illustrative — they're meant to look plausible for
 * what ACLED would report for each region (Yemen high, Switzerland zero,
 * etc.) but should NOT be cited as factual. Real numbers will land via
 * the ACLED API once licensed; until then this lets the Risk Profile
 * panel render and the demo workflow hang together.
 *
 * Schema per entry:
 *   battles      — Battles event_type
 *   vac          — Violence against civilians
 *   explosions   — Explosions/Remote violence
 *   riots        — Riots
 *   strategicDev — Strategic developments
 *   fatalities   — total across all event types in the window
 */
const ACLED_RISK_MOCK = {
  // Office countries
  USA:         { battles: 0, vac: 3,  explosions: 1,  riots: 38,  strategicDev: 14, fatalities: 6 },
  UK:          { battles: 0, vac: 1,  explosions: 0,  riots: 4,   strategicDev: 6,  fatalities: 0 },
  Ireland:     { battles: 0, vac: 0,  explosions: 0,  riots: 1,   strategicDev: 2,  fatalities: 0 },
  Spain:       { battles: 0, vac: 1,  explosions: 0,  riots: 6,   strategicDev: 4,  fatalities: 0 },
  Japan:       { battles: 0, vac: 0,  explosions: 0,  riots: 0,   strategicDev: 3,  fatalities: 0 },
  India:       { battles: 4, vac: 22, explosions: 8,  riots: 51,  strategicDev: 18, fatalities: 41 },
  // COUNTRY_PRESENCE additions (no office)
  Canada:      { battles: 0, vac: 1,  explosions: 0,  riots: 3,   strategicDev: 2,  fatalities: 0 },
  Mexico:      { battles: 12, vac: 87, explosions: 14, riots: 19,  strategicDev: 9,  fatalities: 142 },
  Brazil:      { battles: 6, vac: 41, explosions: 2,  riots: 12,  strategicDev: 7,  fatalities: 68 },
  Germany:     { battles: 0, vac: 2,  explosions: 0,  riots: 9,   strategicDev: 5,  fatalities: 0 },
  France:      { battles: 0, vac: 3,  explosions: 1,  riots: 14,  strategicDev: 6,  fatalities: 1 },
  Italy:       { battles: 0, vac: 1,  explosions: 0,  riots: 5,   strategicDev: 4,  fatalities: 0 },
  Netherlands: { battles: 0, vac: 0,  explosions: 0,  riots: 2,   strategicDev: 1,  fatalities: 0 },
  Switzerland: { battles: 0, vac: 0,  explosions: 0,  riots: 0,   strategicDev: 1,  fatalities: 0 },
  Israel:      { battles: 31, vac: 12, explosions: 84, riots: 18, strategicDev: 22, fatalities: 96 },
  Australia:   { battles: 0, vac: 1,  explosions: 0,  riots: 2,   strategicDev: 2,  fatalities: 0 },
  Singapore:   { battles: 0, vac: 0,  explosions: 0,  riots: 0,   strategicDev: 1,  fatalities: 0 },
  // High-incident countries operators are likely to check during a BCI
  Ukraine:     { battles: 142, vac: 28, explosions: 218, riots: 4, strategicDev: 47, fatalities: 312 },
  Russia:      { battles: 38, vac: 14, explosions: 91, riots: 7,  strategicDev: 33, fatalities: 84 },
  Yemen:       { battles: 47, vac: 18, explosions: 73, riots: 8,  strategicDev: 12, fatalities: 156 },
  Sudan:       { battles: 64, vac: 38, explosions: 22, riots: 6,  strategicDev: 14, fatalities: 281 },
  // Travel-destination countries that may surface in the picker
  UAE:         { battles: 0, vac: 0,  explosions: 0,  riots: 0,   strategicDev: 2,  fatalities: 0 },
  'South Korea': { battles: 0, vac: 0, explosions: 0, riots: 1,   strategicDev: 4,  fatalities: 0 },
  Iceland:     { battles: 0, vac: 0,  explosions: 0,  riots: 0,   strategicDev: 0,  fatalities: 0 },
};

/* Mock WHO Disease Outbreak News — active disease outbreaks the operator
 * should know about when assessing country risk. Populated only in demo
 * mode (see boot below). Live + bare Pages: WHO_OUTBREAKS = [] (the Live
 * Hazards row is conditionally rendered, so no explicit placeholder needed).
 *
 * Source pattern: the real WHO Disease Outbreak News feed is at
 *   https://www.who.int/emergencies/disease-outbreak-news/
 * and publishes a structured RSS. A future backend adapter (`who_don.ts`)
 * will fetch + parse + persist; this mock matches the schema that adapter
 * will produce so the swap is data-only, not UI work.
 *
 * Schema per entry:
 *   country   — country name (matches COUNTRY_PRESENCE.name)
 *   disease   — outbreak label (Cholera / Marburg / Dengue / etc.)
 *   severity  — 'low' | 'mod' | 'high' | 'ext' (CMT-internal interpretation)
 *   cases     — reported cases as of the latest WHO update (optional)
 *   since     — ISO date the outbreak was first published in WHO DON
 *   link      — direct WHO DON URL for the operator to read full detail
 *   summary   — one-sentence operator-facing summary
 *
 * Numbers are illustrative — not factual. Real numbers swap in once the
 * WHO adapter ships.
 */
const WHO_OUTBREAKS_MOCK = [
  { country:'Yemen',       disease:'Cholera',         severity:'high', cases:14820, since:'2025-11-15', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Active cholera transmission across 8 governorates; treatment centers stretched.' },
  { country:'Sudan',       disease:'Cholera',         severity:'high', cases:8421,  since:'2026-02-08', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Cholera outbreak driven by displacement and damaged water infrastructure.' },
  { country:'Sudan',       disease:'Measles',         severity:'mod',  cases:2104,  since:'2026-03-22', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Measles among under-5 children in IDP camps; vaccination campaigns underway.' },
  { country:'India',       disease:'Nipah virus',     severity:'high', cases:18,    since:'2026-04-30', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Localized Nipah cluster in Kerala; contact tracing active. 6 fatalities.' },
  { country:'Brazil',      disease:'Dengue',          severity:'mod',  cases:412000,since:'2026-01-12', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Major dengue season; SP and RJ states reporting elevated transmission.' },
  { country:'Mexico',      disease:'Dengue',          severity:'mod',  cases:78400, since:'2026-04-08', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Dengue activity above 5-year average; coastal states most affected.' },
  { country:'USA',         disease:'Measles',         severity:'low',  cases:121,   since:'2026-03-04', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Multi-state measles clusters; under-vaccinated communities.' },
  { country:'Australia',   disease:'Japanese encephalitis', severity:'low', cases:14, since:'2026-04-18', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'JE virus expansion in NSW/VIC; rural exposure risk.' },
];




/* Floating chip shown while operator is in the geo-fence-draw round trip.
   Click → cancel and reopen BCI modal with form preserved.
   Auto-clears after 30s if operator forgets. Prevents the "stuck waiting"
   state where any unrelated future fence draw would surprise-reopen BCI. */




/* Country Risk Profile compact summary — shown inside the BCI Declaration
 * modal, just below the Exposure in Scope card. Gives operators a one-line
 * qualitative read on what's happening in the selected countries, with a
 * link to the full standalone Risk Profile modal for deeper exploration.
 *
 * Full standalone modal (header 🌐 Risk Profile button) renders the
 * detailed view; see riskModalHTML(). This keeps the BCI flow uncluttered
 * without losing decision-time context.
 *
 * Three render states:
 *   - live + bare Pages (no ACLED data): pending-integration placeholder
 *   - mock mode + 0 countries selected: empty-state hint
 *   - mock mode + 1+ countries: compact aggregate one-liner + link
 */








document.getElementById('btn-bcp').onclick = () => showBCPModal();

/* =========================================================================
   21d. COUNTRY RISK PROFILE — standalone modal accessed from header
   -------------------------------------------------------------------------
   ACLED-backed view of vetted civil-unrest / armed-conflict counts per
   country over the last 30 days. Designed for browsing, comparison, and
   pre-trip / pre-incident situational awareness — NOT for live alerting
   (ACLED has a typical 5-14 day publication lag).

   Two entry points:
   • Header button 🌐 Risk Profile → opens this modal cold (empty selection)
   • BCI modal "View full Risk Profile →" link → opens this modal pre-
     populated with BCP_FORM.countries

   Live + bare Pages mode: shows pending-integration placeholder.
   Mock mode: full UI populated from ACLED_RISK / ACLED_RISK_MOCK.
   ========================================================================= */


/* Build the country list for the chip grid:
 *   - Union of COUNTRY_PRESENCE (always loaded) + ACLED_RISK (mock-only)
 *   - Filtered by search (substring on name) and region filter
 *   - Sorted by ACLED total event count DESC when available so high-incident
 *     countries surface first; alphabetical when no ACLED data
 *   - Each entry carries totals so chips can render the count inline
 *
 * This works in BOTH live and mock modes. Mock mode: chips show ACLED counts
 * inline. Live mode: chips show no count (or "—"); operator can still pick
 * countries to view Live Hazards from the active alert pipeline.
 */

/* Live Hazards panel for the Risk Profile modal — aggregates the existing
 * alert pipeline (NWS / MeteoAlarm / GDACS / USGS / EMSC / EONET / State Dept)
 * for the selected countries. Renders quietly when no live hazards are
 * detected. Distinct from ACLED (historical context) below it.
 */


/* Debounce handle for the Risk modal search input. Module-level so it
   survives the re-bind cycle that happens on every modal re-render —
   bindRiskModalHandlers() is called both on initial open and after every
   re-render, and we want a single shared timer rather than one per call. */
let _riskSearchDebounce = null;



/* =========================================================================
   22-23. DEMO MODE + SYNTHETIC TEST SCENARIOS — bridged from js/demo.js
   -------------------------------------------------------------------------
   The cycling alert/traveler simulator and the operator-triggered Test
   Scenarios modal both live in `js/demo.js` (cleanup #4, 2026-06-19).
   They previously ran as inline IIFEs gated by `if (!API_BASE && #api=mock)`;
   that gate now lives inside each exported function, so we just call them
   here unconditionally and they no-op outside mock mode.

   Both functions touch a wide surface: ALERTS / TRAVELERS / EMPLOYEES,
   render pipeline (renderAll, enrichEventWithImpact, buildEmployees), modals
   (showModal, showBCPModal, App.closeModal), and toast — all bridged to
   window via main.js, so bare references inside demo.js resolve at call time.
   ========================================================================= */
bootDemoMode();
bootTestScenarios();
