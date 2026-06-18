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
const SEVERITY = ['low','mod','high','ext'];
const SEV_RANK = { low:1, mod:2, high:3, ext:4 };
const SEV_NAME = { low:'Low', mod:'Moderate', high:'High', ext:'Extreme' };
const SEV_COLOR = { low:'#4ade80', mod:'#facc15', high:'#fb923c', ext:'#f87171' };

const ALERT_TYPES = ['Natural Disaster','Civil Unrest','Public Safety','Travel Advisory'];

const SOURCES = [
  { id:'NWS',         name:'National Weather Service',       type:'Natural Disaster', status:'ok',    url:'https://www.weather.gov/' },
  { id:'USGS',        name:'US Geological Survey',           type:'Natural Disaster', status:'ok',    url:'https://earthquake.usgs.gov/earthquakes/map/' },
  { id:'EMSC',        name:'European Med Seismological Ctr', type:'Natural Disaster', status:'ok',    url:'https://www.emsc-csem.org/Earthquake/' },
  { id:'NASA EONET',  name:'Earth Observatory',              type:'Natural Disaster', status:'ok',    url:'https://eonet.gsfc.nasa.gov/' },
  { id:'GDACS',       name:'Global Disaster Alert',          type:'Natural Disaster', status:'ok',    url:'https://www.gdacs.org/' },
  { id:'ACLED',       name:'Armed Conflict Location Data',   type:'Civil Unrest',     status:'stale', url:'https://acleddata.com/dashboard/' },
  { id:'GDELT',       name:'Global Database of Events',      type:'Civil Unrest',     status:'ok',    url:'https://www.gdeltproject.org/' },
  { id:'Flashalert',  name:'PDX/OR Emergency Notifications', type:'Public Safety',    status:'ok',    url:'https://www.flashalert.net/' },
  { id:'Socrata',     name:'SF Open Data — Police',          type:'Public Safety',    status:'ok',    url:'https://data.sfgov.org/Public-Safety/Police-Department-Incident-Reports/wg3w-h783' },
  { id:'ArcGIS APD',  name:'Atlanta Police Department',      type:'Public Safety',    status:'ok',    url:'https://opendata.atlantapd.org/' },
  { id:'FEMA IPAWS',  name:'FEMA Public Alert System',       type:'Public Safety',    status:'error', url:'https://www.fema.gov/emergency-managers/practitioners/integrated-public-alert-warning-system' },
  { id:'State Dept',  name:'US Travel Advisory',             type:'Travel Advisory',  status:'ok',    url:'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html' },
  { id:'MeteoAlarm',  name:'European Weather Warnings',      type:'Natural Disaster', status:'ok',    url:'https://www.meteoalarm.org/' },
  { id:'OpenWeatherMap', name:'Live Weather',                type:'Natural Disaster', status:'ok',    url:'https://openweathermap.org/' },
  { id:'OpenAQ',      name:'Air Quality',                    type:'Natural Disaster', status:'stale', url:'https://openaq.org/' },
];

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
const OFFICES = [
  { id:'SFO', name:'San Francisco', country:'USA',  lat:37.7898, lng:-122.3942,
    address:'188 Spear St, Suite 1000, San Francisco, CA 94105' },
  { id:'PDX', name:'Portland',      country:'USA',  lat:45.5191, lng:-122.6790,
    address:'111 SW 5th Ave, Suite 2200, Portland, OR 97204' },
  { id:'ATL', name:'Atlanta',       country:'USA',  lat:33.7841, lng:-84.3849,
    address:'1100 Peachtree St NE, Suite 2000, Atlanta, GA 30309' },
  { id:'BCN', name:'Barcelona',     country:'Spain',lat:41.4036, lng:2.1894,
    address:'Torre Glòries, Suite 2200, Avinguda Diagonal 211, 08018 Barcelona, Spain' },
  { id:'DUB', name:'Dublin',        country:'Ireland', lat:53.3447, lng:-6.2520,
    address:'42 Pearse St, Dublin, D02 HV59, Ireland' },
  { id:'LON', name:'London',        country:'UK',   lat:51.5125, lng:-0.1167,
    address:'Strand Bridge House, 138-142 The Strand, London WC2R 1HL' },
  { id:'TYO', name:'Tokyo',         country:'Japan',lat:35.6802, lng:139.7714,
    address:'Tokyo Midtown Yaesu, Yaesu Central Tower 7F, 2-2-1 Yaesu, Chuo-ku, Tokyo 104-0028' },
  { id:'BLR', name:'Bengaluru',     country:'India',lat:12.9353, lng:77.6485,
    address:'Embassy Golflinks Business Park, No 15 Challaghatta Village, KNC Valley, Bengaluru, Karnataka 560071' },
  { id:'HYD', name:'Hyderabad',     country:'India',lat:17.4413, lng:78.3826,
    address:'Raheja Mindspace, 15th Floor, Building No 9, TSIIC, Software Units Layout, Madhapur, Telangana 500081, Hyderabad' },
];
const OFFICE_BY_ID = Object.fromEntries(OFFICES.map(o => [o.id, o]));

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
const COUNTRY_PRESENCE = [
  // Office countries (verified)
  { code:'US', name:'USA',         region:'Americas', hasOffice:true,  officeIds:['SFO','PDX','ATL'] },
  { code:'GB', name:'UK',          region:'EMEA',     hasOffice:true,  officeIds:['LON'] },
  { code:'IE', name:'Ireland',     region:'EMEA',     hasOffice:true,  officeIds:['DUB'] },
  { code:'ES', name:'Spain',       region:'EMEA',     hasOffice:true,  officeIds:['BCN'] },
  { code:'JP', name:'Japan',       region:'APAC',     hasOffice:true,  officeIds:['TYO'] },
  { code:'IN', name:'India',       region:'APAC',     hasOffice:true,  officeIds:['BLR','HYD'] },
  // Likely-presence countries (no office; remote employees / regular travel)
  // — placeholder list, verified against Workday once integrated
  { code:'CA', name:'Canada',      region:'Americas', hasOffice:false },
  { code:'MX', name:'Mexico',      region:'Americas', hasOffice:false },
  { code:'BR', name:'Brazil',      region:'Americas', hasOffice:false },
  { code:'DE', name:'Germany',     region:'EMEA',     hasOffice:false },
  { code:'FR', name:'France',      region:'EMEA',     hasOffice:false },
  { code:'IT', name:'Italy',       region:'EMEA',     hasOffice:false },
  { code:'NL', name:'Netherlands', region:'EMEA',     hasOffice:false },
  { code:'CH', name:'Switzerland', region:'EMEA',     hasOffice:false },
  { code:'IL', name:'Israel',      region:'EMEA',     hasOffice:false },
  { code:'AU', name:'Australia',   region:'APAC',     hasOffice:false },
  { code:'SG', name:'Singapore',   region:'APAC',     hasOffice:false },
];

/* Headcount helpers — office.headcount is mock data populated only in
 * #api=mock (see OFFICE_HEADCOUNTS_MOCK + demo IIFE boot). In live + bare
 * Pages headcount is undefined and the UI should show pending-integration
 * placeholders rather than NaN or "undefined". */
/* hasOfficeHeadcounts() moved to helpers.js — bridged via main.js. */
/* fmtHeadcount() moved to helpers.js — bridged via main.js. */
/* sumHeadcount() moved to helpers.js — bridged via main.js. */

/* ACLED risk-rollup helpers — ACLED_RISK is mock data populated only in
 * #api=mock (see ACLED_RISK_MOCK + demo IIFE boot). In live + bare Pages
 * the BCI Country Risk Profile panel shows a "pending ACLED" placeholder. */
/* hasAcledRisk() moved to helpers.js — bridged via main.js. */

/* Sum the per-country rollups across the supplied country names. Returns
 * the same schema each ACLED_RISK_MOCK entry has, with totalEvents added.
 * Countries the operator selected that aren't in ACLED_RISK contribute 0. */
/* aggregateAcledRisk() moved to helpers.js — bridged via main.js. */

/* WHO Disease Outbreak helpers — same gating pattern as ACLED. Empty in
 * live + bare Pages until the WHO adapter ships; populated from
 * WHO_OUTBREAKS_MOCK by the demo bootstrap in #api=mock mode. */

/* WHO uses long-form country names ("Democratic Republic of the Congo")
 * but COUNTRY_PRESENCE / OFFICES use short forms ("DRC", "USA"). Map
 * known long-forms here so per-country lookups match. Add to this list
 * when new WHO entries surface unfamiliar long-forms. */
const WHO_COUNTRY_ALIASES = {
  'Democratic Republic of the Congo':                     'DRC',
  'United Republic of Tanzania':                          'Tanzania',
  'United States of America':                             'USA',
  'United Kingdom of Great Britain and Northern Ireland': 'UK',
  "Lao People's Democratic Republic":                     'Laos',
  'Republic of Korea':                                    'South Korea',
  "Democratic People's Republic of Korea":                'North Korea',
  'Iran (Islamic Republic of)':                           'Iran',
  'Russian Federation':                                   'Russia',
  'Syrian Arab Republic':                                 'Syria',
  'Viet Nam':                                             'Vietnam',
  'Czechia':                                              'Czech Republic',
  'Türkiye':                                              'Turkey',
  'Bolivia (Plurinational State of)':                     'Bolivia',
  'Venezuela (Bolivarian Republic of)':                   'Venezuela',
};
/* normalizeWhoCountry() moved to helpers.js — bridged via main.js. */

/* hasWhoOutbreaks() moved to helpers.js — bridged via main.js. */
/* outbreaksForCountry() moved to helpers.js — bridged via main.js. */
/* outbreaksAggregated() moved to helpers.js — bridged via main.js. */

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
/* alertCountryFor() moved to helpers.js — bridged via main.js. */

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
/* relevanceTierOf() moved to helpers.js — bridged via main.js. */

/** Empty hazard rollup with all keys zeroed and travelAdvisoryLevel null. */
/* _emptyHazardRollup() moved to helpers.js — bridged via main.js. */

/** Aggregate active alerts in the given country into a single hazard rollup.
 *  Looks at ALERTS state — the same array the dashboard renders. */
/* liveHazardsForCountry() moved to helpers.js — bridged via main.js. */

/** Sum live-hazard rollups across multiple countries. Travel Advisory level
 *  takes the MAX across countries (highest sev wins). */
/* liveHazardsAggregated() moved to helpers.js — bridged via main.js. */

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
/* API_BASE() moved to api.js — bridged via main.js. */

/* OPERATOR moved to state.js; default Kevin Cheyne CMT bridged via main.js. The
   /api/auth/me handler in bootLiveMode() reassigns OPERATOR through the setter. */
const ROLE_TAG_STYLE = {
  admin:    { bg: 'var(--green)',  fg: '#062c1f',  label: 'Admin' },
  cmt:      { bg: 'var(--blue)',   fg: '#fff',     label: 'CMT Member' },
  office:   { bg: 'var(--yellow)', fg: '#1f1c00',  label: 'Office Manager' },
  employee: { bg: 'var(--bg3)',    fg: 'var(--muted)', label: 'Employee' },
};

/* ---------- 2. Mock data generators ---------- */
/* nowMinus() moved to helpers.js — bridged via main.js. */
/* rand() moved to helpers.js — bridged via main.js. */
/* randomName() moved to helpers.js — bridged via main.js. */

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
/* TRAVELERS moved to state.js (initial: []); demo bootstrap reassigns via setter. */

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
const TEMPLATE_CATEGORIES = [
  { id: 'shelter',     label: 'Shelter in Place' },
  { id: 'evacuate',    label: 'Evacuation' },
  { id: 'checkin',     label: 'Safety Check-in' },
  { id: 'allclear',    label: 'All Clear' },
  { id: 'bc_announce', label: 'BC Announcement' },
  { id: 'bc_checkin',  label: 'BC Check-in' },
  { id: 'bc_closure',  label: 'Office Closure' },
  { id: 'travel',      label: 'Travel' },
];

const TEMPLATES = {
  // ─────────── Shelter in Place ───────────
  shelter: {
    name: 'Shelter — Generic',
    category: 'shelter', priority: 1,
    body: 'IMMEDIATE: A safety incident has been reported. Shelter in place inside the office. Move away from windows. Do not exit until you receive an all-clear. Reply OK / HELP.',
  },
  shelter_quake: {
    name: 'Shelter — Earthquake',
    category: 'shelter', priority: 2,
    body: 'EARTHQUAKE: Drop, take Cover under sturdy furniture, and Hold On until shaking stops. Stay clear of windows, glass, and exterior walls. After shaking stops, do NOT use elevators; await an all-clear before exiting. Reply OK if you are unhurt, HELP if injured or trapped. Aftershocks are likely.',
  },
  shelter_severe_weather: {
    name: 'Shelter — Severe Weather / Tornado',
    category: 'shelter', priority: 3,
    body: 'SEVERE WEATHER WARNING: Move to the lowest level interior room, away from windows and exterior walls. Stay sheltered until the warning expires or CMT issues an all-clear. Do NOT attempt to leave the building. Reply OK / HELP.',
  },
  shelter_active_threat: {
    name: 'Shelter — Active Threat / Lockdown',
    category: 'shelter', priority: 4,
    body: 'LOCKDOWN: An active threat has been reported in or near the office. RUN if a safe exit is clear. HIDE if not — lock and barricade doors, lights off, silence devices, stay out of sight. FIGHT only as a last resort. Do NOT open the door for anyone but uniformed first responders. Reply OK silently if able. CMT and law enforcement are coordinating response.',
  },
  shelter_civil_unrest: {
    name: 'Shelter — Civil Unrest',
    category: 'shelter', priority: 5,
    body: 'CIVIL UNREST nearby: Remain inside the office. Do NOT engage with crowds or attempt to traverse affected streets. Move away from ground-floor windows and lobbies. CMT is monitoring; expect updates every 30 minutes. Reply OK / HELP. If you are off-site and en route, return to a safe location and contact CMT.',
  },

  // ─────────── Evacuation ───────────
  evac: {
    name: 'Evacuation — Generic',
    category: 'evacuate', priority: 1,
    body: 'IMMEDIATE: Evacuate the office now via the nearest safe exit. Proceed to the muster point. Do not use elevators. Reply OK once you are at muster.',
  },
  evac_fire: {
    name: 'Evacuation — Fire',
    category: 'evacuate', priority: 2,
    body: 'FIRE EVACUATION: Leave immediately via the nearest stairwell. Do NOT use elevators. Do NOT collect belongings. Close doors behind you. If the door is hot, use an alternate route. Proceed to the designated muster point and check in with your floor warden. Reply OK at muster, HELP if you cannot exit safely.',
  },
  evac_bomb: {
    name: 'Evacuation — Bomb / Suspicious Package',
    category: 'evacuate', priority: 3,
    body: 'EVACUATE: A suspicious package or bomb threat has been reported. Walk calmly via the secondary egress route (not the main lobby). Do NOT use radios or mobile devices near the suspect item. Do NOT return for personal items. Gather at the FAR muster point — minimum 300m from the building — and await accountability. Reply OK once clear, HELP if unable to evacuate.',
  },

  // ─────────── Safety Check-in ───────────
  check: {
    name: 'Safety Check — Office',
    category: 'checkin', priority: 1,
    body: 'A safety alert has been issued in your area. Please confirm your status. Reply OK if you are safe, HELP if you need assistance.',
  },
  check_traveler: {
    name: 'Safety Check — Traveler',
    category: 'checkin', priority: 2,
    body: 'You have been flagged within the impact radius of an active safety alert in your current location. Please confirm your status — reply OK if you are safe, HELP if you need assistance. A CMT member will reach out within 15 minutes if you reply HELP or do not respond.',
  },

  // ─────────── All Clear ───────────
  allclear: {
    name: 'All Clear',
    category: 'allclear', priority: 1,
    body: 'All clear. The earlier safety incident has been resolved. You may resume normal activity.',
  },

  // ─────────── BC Announcement ───────────
  bc_announce: {
    name: 'BC Announcement — Generic',
    category: 'bc_announce', priority: 1,
    body: 'New Relic is monitoring a developing situation in your region. We are in contact with regional authorities and will share updates as the picture clarifies. There is no immediate action required from you at this time. If your safety is in question, reply HELP.',
  },
  bc_announce_quake: {
    name: 'BC Announcement — Major Earthquake',
    category: 'bc_announce', priority: 2,
    body: 'A major earthquake has been reported in your region. Do NOT return to or enter damaged buildings. Stay clear of downed power lines, gas leaks, and unstable structures. Aftershocks are expected for hours to days; treat each one as the start of another shelter cycle. CMT is coordinating with local authorities. Reply OK if you are safe, HELP if you need assistance or shelter.',
  },
  bc_announce_terror: {
    name: 'BC Announcement — Terror / Mass-Casualty',
    category: 'bc_announce', priority: 3,
    body: 'A serious security incident has been reported in your region. Avoid landmarks, transit hubs, government buildings, and large gatherings. Stay where you are unless authorities direct otherwise. Do NOT travel toward the affected area. Charge devices, keep them on, and reply HELP if you are near the incident or need assistance. CMT is in active contact with security partners and will share verified guidance only.',
  },

  // ─────────── BC Check-in ───────────
  bc_checkin: {
    name: 'Country-wide Check-in',
    category: 'bc_checkin', priority: 1,
    body: 'In response to events unfolding in your region, we are conducting a wellness check. Please reply OK to confirm you are safe, or HELP if you need assistance. Your manager and CMT will be notified of your status.',
  },

  // ─────────── Office Closure ───────────
  bc_closure: {
    name: 'Office Closure Directive',
    category: 'bc_closure', priority: 1,
    body: 'Due to the ongoing regional situation, the office will be closed effective immediately. Do not travel to the office. Continue work from a safe location if able. CMT will share reopening guidance directly. Reply OK to acknowledge.',
  },

  // ─────────── Travel ───────────
  bc_travel: {
    name: 'Travel — Suspension',
    category: 'travel', priority: 1,
    body: 'All non-essential travel to and within the affected region is suspended until further notice. If you are currently traveling in or near the region, contact CMT at safety@newrelic.com immediately. Existing trips should be reviewed with your manager.',
  },
  travel_advisory: {
    name: 'Travel — Advisory Upgrade',
    category: 'travel', priority: 2,
    body: 'A travel advisory upgrade has been issued for your destination region. If you are currently traveling there, please contact CMT to confirm your itinerary and shelter plan. New non-essential travel to the region should be deferred. Existing trips will be reviewed case-by-case with your manager and CMT.',
  },
};

/* STATE moved to state.js (as state.UI_STATE); bridged via main.js so
   legacy `STATE.feedTab = 'time'` etc. continues to work. The two fields
   below are derived from inline OFFICES + ALERT_TYPES which haven't been
   wired through the module system yet — populate them here at boot. */
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
/* relTime() moved to helpers.js — bridged via main.js. */
/* fmtClock() moved to helpers.js — bridged via main.js. */
/* maxSevForOffice() moved to helpers.js — bridged via main.js. */
/* activeAlertsForOffice() moved to helpers.js — bridged via main.js. */
// Haversine great-circle distance in km. Used to match alerts to travelers/offices.
/* distanceKm() moved to helpers.js — bridged via main.js. */

// Default impact radius (km) when an alert doesn't carry one. Per category — these are
// loose; tighter is better for travel advisories, looser for tropical cyclones.
const IMPACT_RADIUS_DEFAULT_KM = {
  'Natural Disaster': 100,
  'Civil Unrest':     50,
  'Public Safety':    25,
  'Travel Advisory':  300,
};

// Enrich a backend event with client-side impact data (travelers/employees within radius).
// Returns the event object augmented with affectedTravelers, affectedOfficeImpact, isRelevant.
/* enrichEventWithImpact() moved to helpers.js — bridged via main.js. */

/* passesFilter() moved to helpers.js — bridged via main.js. */
/* visibleAlerts() moved to helpers.js — bridged via main.js. */
/* travelersAtOffice() moved to helpers.js — bridged via main.js. */
/* uid() moved to helpers.js — bridged via main.js. */

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
/* alertPriorityScore() moved to helpers.js — bridged via main.js. */
/** Highest priority score among a list of alerts; -Infinity if empty. */
/* topScore() moved to helpers.js — bridged via main.js. */
/** Escape user-provided strings before injecting into HTML. */
/* esc() moved to helpers.js — bridged via main.js. */
/** Check if a modal is currently open. */
function isModalOpen() { return !!document.getElementById('modal-back'); }

/** Auto-linkify http(s) URLs inside escaped text. Pass already-escaped text. */
/* linkify() moved to helpers.js — bridged via main.js. */

/** File-size formatting + icon by MIME type. */
/* fmtSize() moved to helpers.js — bridged via main.js. */
/* fileIcon() moved to helpers.js — bridged via main.js. */
/** Read a File into an attachment object. Embeds as data: URL if small. */
const ATT_EMBED_LIMIT = 2 * 1024 * 1024;   // 2MB
/* fileToAttachment() moved to helpers.js — bridged via main.js. */
/** Render an attachment chip. removable=true when in draft state. */
/* attachmentChipHTML() moved to helpers.js — bridged via main.js. */

/* ---------- 6. Office markers + popups ---------- */
const OFFICE_MARKERS = {};
function renderOffices() {
  layers.offices.clearLayers();
  for (const k in OFFICE_MARKERS) delete OFFICE_MARKERS[k];
  OFFICES.forEach(o => {
    if (!STATE.visibleOffices.includes(o.id)) return;
    const sev = maxSevForOffice(o.id);
    const sevClass = sev ? 's-'+sev : 's-none';
    const visitors = travelersAtOffice(o.id).length;
    // Show headcount only in mock mode; in live mode the bubble is just IATA + visitor badge.
    const hcLabel = o.headcount != null ? ` ${o.headcount}` : '';
    const html = `<div class="office-mk"><span class="sev-dot ${sevClass}"></span>${o.id}${hcLabel}${visitors?`<span class="v-badge">${visitors}✈</span>`:''}</div>`;
    const icon = L.divIcon({ html, className:'', iconSize:[100,22], iconAnchor:[50,11] });
    const m = L.marker([o.lat, o.lng], { icon }).addTo(layers.offices);
    m.bindPopup(officePopup(o));
    OFFICE_MARKERS[o.id] = m;
  });
}
function officePopup(o) {
  const a = activeAlertsForOffice(o.id);
  const visitors = travelersAtOffice(o.id);
  const sevCounts = SEVERITY.map(s => a.filter(x => x.sev===s).length);
  return `
    <h4>${o.name}, ${o.country}</h4>
    <div class="addr">${o.address}</div>
    <div class="pop-row"><span>Employees</span>${o.headcount != null ? `<b>${fmtHeadcount(o.headcount)}</b>` : `<span style="font-size:11px;color:var(--muted);font-style:italic;">pending Workday integration</span>`}</div>
    <div class="pop-row"><span>Active alerts</span><b>${a.length}</b></div>
    <div class="pop-row" style="gap:4px;flex-wrap:wrap">
      ${SEVERITY.map((s,i)=>sevCounts[i]?`<span class="sev-pill ${s}">${SEV_NAME[s]}: ${sevCounts[i]}</span>`:'').join('')}
    </div>
    ${visitors.length?`<div class="pop-row" style="margin-top:6px"><span>Visiting</span><b>${visitors.length} ✈</b></div>`:''}
    <div style="margin-top:6px">
      ${a.slice(0,3).map(al=>`<div style="font-size:11px;border-top:1px solid var(--border);padding-top:4px;margin-top:4px">
        <span class="sev-pill ${al.sev}">${SEV_NAME[al.sev]}</span>
        <span class="src-pill">${esc(al.source)}</span>
        <div style="margin-top:2px">${esc(al.title)}</div>
        <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
          <button class="btn-ghost" style="font-size:10px;padding:2px 6px" onclick="App.showAlertDetails('${esc(al.id)}')">Details</button>
          <button class="btn-ghost" style="font-size:10px;padding:2px 6px;background:rgba(28,231,131,.15);border-color:rgba(28,231,131,.4);color:var(--green)" onclick="App.crisisFromAlert('${esc(al.id)}')">📣 Crisis</button>
        </div>
      </div>`).join('')}
      ${a.length > 3 ? `<div style="font-size:10px;color:var(--muted);margin-top:6px;text-align:center">+${a.length-3} more — open the Alert Feed for full list</div>` : ''}
    </div>
    <div class="pop-actions">
      <button class="btn-ghost" onclick="App.targetOffice('${esc(o.id)}')">📣 Crisis (office-wide)</button>
      <button class="btn-ghost" onclick="App.zoomOffice('${esc(o.id)}')">Zoom</button>
    </div>`;
}

/* ---------- 7. Alert dots ---------- */
function alertPopupHTML(a) {
  const src = SOURCES.find(s => s.id === a.source) || { name: a.source };
  const officeBadges = (a.affectedOfficeIds || []).map(id =>
    `<span class="impact-badge impact-office" title="${esc(OFFICE_BY_ID[id]?.name || id)}">🏢 ${esc(id)}</span>`
  ).join(' ');
  const travCount = (a.affectedTravelers || []).length;
  const empCount  = a.totalEmployeesAffected || 0;
  const travBadge = travCount ? `<span class="impact-badge impact-trav">✈ ${travCount}</span>` : '';
  const empBadge  = empCount  ? `<span class="impact-badge impact-emp">👥 ${empCount}</span>`   : '';
  const impactRow = (officeBadges || travBadge || empBadge)
    ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${officeBadges} ${travBadge} ${empBadge}</div>`
    : '';
  return `
    <div style="min-width:240px;max-width:320px">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span class="sev-pill ${a.sev}">${SEV_NAME[a.sev]}</span>
        <span class="src-pill">${esc(src.name || a.source)}</span>
      </div>
      <h4 style="margin:0 0 4px;line-height:1.25">${esc(a.title)}</h4>
      <div class="addr" style="font-size:11px;color:var(--muted)">${esc(a.location || '')} · ${esc(relTime(a.issued))} · ${esc(a.type)}</div>
      ${impactRow}
      <div class="btn-row" style="margin-top:8px;display:flex;gap:6px">
        <button class="btn-ghost" style="font-size:11px;padding:4px 8px" onclick="App.showAlertDetails('${esc(a.id)}')">Details</button>
        <button class="btn-ghost" style="font-size:11px;padding:4px 8px;background:rgba(28,231,131,.15);border-color:rgba(28,231,131,.4);color:var(--green)" onclick="App.crisisFromAlert('${esc(a.id)}')">📣 Crisis</button>
      </div>
    </div>`;
}

function renderAlertDots() {
  layers.alerts.clearLayers();
  visibleAlerts().forEach(a => {
    const popupOpts = { maxWidth: 340, autoPan: true };
    if (a.radiusKm > 0) {
      L.circle([a.lat, a.lng], { radius: a.radiusKm*1000, color: SEV_COLOR[a.sev], weight: 1, fillOpacity: 0.08 })
        .addTo(layers.alerts)
        .bindPopup(alertPopupHTML(a), popupOpts)
        .on('click', () => selectAlert(a.id));
    }
    L.circleMarker([a.lat, a.lng], { radius:5, color: SEV_COLOR[a.sev], fillColor: SEV_COLOR[a.sev], fillOpacity:.9, weight:2 })
      .addTo(layers.alerts)
      .bindTooltip(`<b>${SEV_NAME[a.sev]}</b> · ${a.title}`,{direction:'top'})
      .bindPopup(alertPopupHTML(a), popupOpts)
      .on('click', () => selectAlert(a.id));
  });
}

/* ---------- 8. Employees & travelers ---------- */
function renderEmployees() {
  layers.emp.clearLayers();
  if (!STATE.showEmployees) return;
  EMPLOYEES.forEach(e => {
    const lat = STATE.empMode === 'zip' ? e.lat : e.officeLat;
    const lng = STATE.empMode === 'zip' ? e.lng : e.officeLng;
    const icon = L.divIcon({ html:'<div class="emp-mk"></div>', className:'', iconSize:[10,10] });
    const m = L.marker([lat, lng], { icon });
    m.bindPopup(`<h4>${esc(e.name)}</h4><div class="addr">${esc(e.role)} · ${esc(OFFICE_BY_ID[e.office]?.name||'')}</div>`);
    layers.emp.addLayer(m);
  });
  document.getElementById('emp-count').textContent = `${EMPLOYEES.length.toLocaleString()} employees loaded`;
}
function renderTravelers() {
  layers.trav.clearLayers();
  if (!STATE.showTravelers) return;
  TRAVELERS.forEach(t => {
    if (t.atOffice) return; // shown as office badge
    const symbol = t.type === 'flight' ? '✈️' : '🏨';
    const icon = L.divIcon({ html:`<div class="trav-mk">${symbol}</div>`, className:'', iconSize:[20,20] });
    const m = L.marker([t.lat, t.lng], { icon });
    m.bindPopup(`<h4>${esc(t.name)}</h4><div class="addr">Home: ${esc(OFFICE_BY_ID[t.home]?.name || t.home)} · ${esc(t.destCity)}</div>
      <div class="pop-row"><span>Booking</span><b>${t.type==='flight'?'✈ air':'🏨 hotel'}</b></div>`);
    layers.trav.addLayer(m);
  });
  // When TRAVELERS is empty (live mode without Navan integration), show an em
  // dash rather than "0" so operators can tell "no integration yet" apart from
  // "the answer is zero". Mock-mode populates TRAVELERS via the demo IIFE.
  const empty = TRAVELERS.length === 0;
  document.getElementById('trav-count').textContent = empty
    ? 'Travelers data unavailable — awaiting Navan connection'
    : `${TRAVELERS.length} travelers loaded`;
  const badge = document.getElementById('trav-count-badge');
  if (badge) badge.textContent = empty ? '—' : TRAVELERS.length;
}

/* ---------- 9. Hazard overlays (mock) ---------- */
const HAZARD_ZONES = {
  fire: {
    label: '🔥 Wildfire Zones',
    color: '#f87171',
    source: 'NASA EONET',
    sourceName: 'Earth Observatory Natural Event Tracker',
    sourceUrl: 'https://eonet.gsfc.nasa.gov/',
    description: 'Active wildfire events tracked by NASA Earth Observatory and partner agencies (NIFC, GeoMAC).',
    zones: [
      { lat: 38.5, lng: -122.5, radiusKm: 280, label: 'Northern California' },
      { lat: 34.0, lng: -118.2, radiusKm: 220, label: 'Southern California' },
      { lat: 45.5, lng: -122.5, radiusKm: 180, label: 'Pacific Northwest' },
      { lat: -33.8, lng: 151.2, radiusKm: 320, label: 'New South Wales' },
      { lat: 38.7, lng: 23.7, radiusKm: 240, label: 'Greece / Aegean' },
    ],
  },
  flood: {
    label: '💧 Flood Risk',
    color: '#1e90ff',
    source: 'GDACS',
    sourceName: 'Global Disaster Alert and Coordination System',
    sourceUrl: 'https://www.gdacs.org/',
    description: 'Flood risk zones from GDACS, NWS forecasts, and historical FEMA flood plain data.',
    zones: [
      { lat: 12.97, lng: 77.6, radiusKm: 60, label: 'Bengaluru low-lying areas' },
      { lat: 41.39, lng: 2.17, radiusKm: 50, label: 'Catalonia coast' },
      { lat: 53.35, lng: -6.26, radiusKm: 40, label: 'Dublin Liffey basin' },
      { lat: 23.8, lng: 90.4, radiusKm: 380, label: 'Bangladesh delta' },
      { lat: 30.0, lng: 31.2, radiusKm: 200, label: 'Nile delta' },
    ],
  },
  quake: {
    label: '🌍 Seismic Risk',
    color: '#fb923c',
    source: 'USGS',
    sourceName: 'US Geological Survey — Earthquake Hazards',
    sourceUrl: 'https://earthquake.usgs.gov/hazards/',
    description: 'Seismic hazard zones based on USGS National Seismic Hazard Model and EMSC fault data.',
    zones: [
      { lat: 35.68, lng: 139.65, radiusKm: 320, label: 'Kanto plain' },
      { lat: 37.78, lng: -122.42, radiusKm: 180, label: 'San Andreas Fault' },
      { lat: 40.18, lng: 28.0, radiusKm: 280, label: 'North Anatolian Fault' },
      { lat: -27.5, lng: -70.0, radiusKm: 380, label: 'Chile subduction' },
      { lat: 19.4, lng: -99.1, radiusKm: 260, label: 'Trans-Mexican volcanic belt' },
    ],
  },
  unrest: {
    label: '⚠ Civil Unrest',
    color: '#facc15',
    source: 'ACLED',
    sourceName: 'Armed Conflict Location & Event Data Project',
    sourceUrl: 'https://acleddata.com/dashboard/',
    description: 'Recent civil unrest hotspots from ACLED, supplemented by GDELT event clustering.',
    zones: [
      { lat: 12.97, lng: 77.6, radiusKm: 12, label: 'Bengaluru Whitefield' },
      { lat: 51.51, lng: -0.12, radiusKm: 6, label: 'Westminster' },
      { lat: 48.85, lng: 2.35, radiusKm: 8, label: 'Paris central' },
      { lat: 6.5, lng: 3.4, radiusKm: 14, label: 'Lagos central' },
    ],
  },
  aqi: {
    label: '🫁 Poor Air Quality',
    color: '#a855f7',
    source: 'OpenAQ',
    sourceName: 'OpenAQ — Open Air Quality Data',
    sourceUrl: 'https://openaq.org/',
    description: 'Locations with current AQI > 100 (Unhealthy for sensitive groups) from OpenAQ stations.',
    zones: [
      { lat: 38.5, lng: -122.5, radiusKm: 220, label: 'NorCal AQI 165' },
      { lat: 28.6, lng: 77.2, radiusKm: 180, label: 'Delhi AQI 240' },
      { lat: 39.9, lng: 116.4, radiusKm: 160, label: 'Beijing AQI 195' },
      { lat: 17.4, lng: 78.5, radiusKm: 80,  label: 'Hyderabad AQI 130' },
    ],
  },
  heat: {
    label: '☀️ Heat Advisory',
    color: '#dc2626',
    source: 'NWS',
    sourceName: 'National Weather Service — Heat Watches & Warnings',
    sourceUrl: 'https://www.weather.gov/safety/heat',
    description: 'Areas under active heat advisories, watches, or warnings. Includes excessive-heat warnings (NWS), regional heatwave advisories (MeteoAlarm), and IMD heat alerts.',
    zones: [
      { lat: 17.4,  lng: 78.5,    radiusKm: 80,  label: 'Hyderabad — heat index 47°C' },
      { lat: 28.6,  lng: 77.2,    radiusKm: 200, label: 'Delhi — IMD heatwave alert' },
      { lat: 33.45, lng: -112.07, radiusKm: 180, label: 'Phoenix — excessive heat warning' },
      { lat: 36.17, lng: -115.14, radiusKm: 140, label: 'Las Vegas — heat advisory' },
      { lat: 30.04, lng: 31.24,   radiusKm: 220, label: 'Cairo region heatwave' },
      { lat: 35.68, lng: 139.65,  radiusKm: 130, label: 'Tokyo summer alert' },
      { lat: 41.39, lng: 2.17,    radiusKm: 110, label: 'Catalonia heatwave' },
    ],
  },
  // precip + temp are real tile overlays — see TILE_OVERLAYS
};

/** Live tile-based overlays — actual real-time data when available. */
const TILE_OVERLAYS = {
  precip: {
    label: '🌧 Live Precipitation Radar',
    source: 'RainViewer',
    sourceName: 'RainViewer global weather radar',
    sourceUrl: 'https://www.rainviewer.com/',
    description: 'Real-time global precipitation radar updated every 10 minutes.',
  },
  temp: {
    label: '🌡 Live Land Surface Temperature',
    source: 'NASA GIBS',
    sourceName: 'NASA Global Imagery Browse Services — MODIS Terra LST Day',
    sourceUrl: 'https://gibs.earthdata.nasa.gov/',
    description: 'MODIS Terra land surface temperature (daytime). Updated daily — colored from cold (blue) to hot (red).',
  },
};

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
function renderHazardZones() {
  layers.hazards.clearLayers();
  const active = [];
  Object.entries(HAZARD_ZONES).forEach(([key, def]) => {
    if (!STATE.hazards[key]) return;
    active.push({ key, def });
    def.zones.forEach(z => {
      const halo = L.circle([z.lat, z.lng], {
        radius: z.radiusKm * 1000,
        color: def.color, weight: 2, opacity: 0.85,
        fillColor: def.color, fillOpacity: 0.18, dashArray: '6 4',
      }).addTo(layers.hazards);
      halo.bindTooltip(`<b>${esc(def.label)}</b> — ${esc(z.label)}`, { direction: 'top', sticky: true });
      halo.bindPopup(hazardPopupHTML(def, z), { maxWidth: 320 });
      // Solid center marker (also clickable)
      const dot = L.circleMarker([z.lat, z.lng], {
        radius: 5, color: def.color, fillColor: def.color, fillOpacity: 0.95, weight: 2,
      }).addTo(layers.hazards);
      dot.bindPopup(hazardPopupHTML(def, z), { maxWidth: 320 });
    });
  });
  return active;
}

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
function updateHazardLegend(active) {
  // update Map Tools header badge with active-overlay count
  const overlayCount = Object.values(STATE.hazards).filter(Boolean).length;
  const badge = document.getElementById('tools-badge');
  if (badge) {
    badge.innerHTML = overlayCount
      ? `<span style="display:inline-block;background:var(--green);color:#000;border-radius:8px;padding:0 5px;font-size:10px;font-weight:700;margin-left:4px">${overlayCount}</span>`
      : '';
  }
  const leg = document.getElementById('hazard-legend');
  if (!leg) return;
  const entries = [...active.map(({def}) => ({ label: def.label, color: def.color, count: def.zones.length, source: def.source, sourceUrl: def.sourceUrl }))];
  if (STATE.hazards.precip) entries.push({ label: TILE_OVERLAYS.precip.label, color: '#3b82f6', count: 'live', source: TILE_OVERLAYS.precip.source, sourceUrl: TILE_OVERLAYS.precip.sourceUrl });
  if (STATE.hazards.temp)   entries.push({ label: TILE_OVERLAYS.temp.label,   color: '#dc2626', count: 'live', source: TILE_OVERLAYS.temp.source,   sourceUrl: TILE_OVERLAYS.temp.sourceUrl });
  if (!entries.length) { leg.style.display = 'none'; leg.innerHTML = ''; return; }
  leg.style.display = '';
  leg.innerHTML = `<div class="leg-title">Map overlays active</div>` +
    entries.map(d => `<div class="leg-row">
      <span class="leg-dot" style="background:${d.color}"></span>
      <span style="flex:1">${esc(d.label)} <span style="color:var(--muted);font-size:10px">(${d.count})</span></span>
      <a href="${d.sourceUrl}" target="_blank" rel="noopener" title="${esc(d.source)} ↗" style="color:var(--blue);font-size:10px">↗</a>
    </div>`).join('');
}

/** Master hazard render — called on every toggle. */
function renderHazards() {
  const active = renderHazardZones();
  applyTileOverlays();
  updateHazardLegend(active);
}

/* ---------- 10. ALERT FEED render ---------- */
function renderRailAlerts() {
  const list = document.getElementById('rail-office-list');
  if (!list) return;
  const data = OFFICES.map(o => {
    const a = activeAlertsForOffice(o.id);
    const counts = SEVERITY.reduce((m,s) => { m[s] = a.filter(x => x.sev===s).length; return m; }, {});
    return { o, counts, total: a.length, score: topScore(a) };
  }).filter(x => x.total > 0)
    // Hottest office first (severity-dominant priority score with recency penalty)
    .sort((a,b) => b.score - a.score || b.total - a.total);
  if (!data.length) { list.innerHTML = '<div style="font-size:9px;color:var(--muted);text-align:center;padding:6px 0">no alerts</div>'; return; }
  list.innerHTML = data.map(({o, counts}) => {
    const segs = ['ext','high','mod','low'].filter(s => counts[s] > 0)
      .map(s => `<span class="rail-sev-count s-${s}" title="${SEV_NAME[s]}">${counts[s]}</span>`).join('');
    return `<div class="rail-office" data-id="${o.id}" title="${o.name}: ${SEVERITY.map(s=>counts[s]?counts[s]+' '+SEV_NAME[s]:'').filter(Boolean).join(', ')}">
      <div class="rail-office-code">${o.id}</div>
      <div class="rail-office-counts">${segs}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('.rail-office').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    App.zoomOffice(el.dataset.id);
    openPanel('alerts');
  }));
}
function renderFeed() {
  const body = document.getElementById('feed-body');
  const alerts = visibleAlerts();
  renderRailAlerts();
  if (!alerts.length) { body.innerHTML = '<div class="empty">No alerts match the current filter.</div>'; return; }
  if (STATE.feedTab === 'office') {
    const groups = {};
    alerts.forEach(a => {
      const key = a.officeId || '—';
      (groups[key] = groups[key] || []).push(a);
    });
    // Sort each group's alerts by priority (highest score first)
    Object.values(groups).forEach(list => list.sort((a,b) => alertPriorityScore(b) - alertPriorityScore(a)));
    // Sort groups by their hottest alert
    const sortedKeys = Object.keys(groups).sort((a,b) => topScore(groups[b]) - topScore(groups[a]));
    body.innerHTML = sortedKeys.map(oid => {
      const list = groups[oid];
      const o = OFFICE_BY_ID[oid];
      const sev = list.reduce((m,a)=>SEV_RANK[a.sev]>m?SEV_RANK[a.sev]:m,0);
      const sevName = SEVERITY[sev-1];
      const expanded = STATE.expandedOffices.has(oid);
      const visible = expanded ? list : list.slice(0,5);
      const more = list.length - visible.length;
      return `<div class="office-group">
        <div class="office-group-head" onclick="App.zoomOffice('${esc(oid)}')">
          <span class="sev-dot" style="background:${SEV_COLOR[sevName]||'var(--muted)'}" aria-hidden="true"></span>
          <span class="name">${esc(o ? o.name : 'Travel / Region')}</span>
          <span class="pill">${list.length}</span>
        </div>
        <div class="alert-cards">
          ${visible.map(a=>alertCardHTML(a)).join('')}
          ${more>0?`<button class="more-btn" data-expand="${esc(oid)}">Show ${more} more ▾</button>`:''}
          ${expanded && list.length>5?`<button class="more-btn" data-collapse="${esc(oid)}">Show less ▴</button>`:''}
        </div>
      </div>`;
    }).join('');
  } else {
    // Recent tab: tier-then-time. Tier descending (Direct → Indirect → Watch
    // → null) so an operator scrolling the feed sees actionable items first;
    // within a tier, newest first. The 🎯 toggle in the status strip already
    // hides Watch + null tiers by default — toggling 🌐 All surfaces them at
    // the bottom of this list.
    const TIER_RANK = { direct: 3, indirect: 2, watch: 1 };
    const sorted = alerts.slice().sort((a, b) => {
      const ta = TIER_RANK[a.relevanceTier] || 0;
      const tb = TIER_RANK[b.relevanceTier] || 0;
      if (ta !== tb) return tb - ta;
      return +new Date(b.issued) - +new Date(a.issued);
    }).slice(0, 20);
    body.innerHTML = `<div style="padding:8px 10px;display:flex;flex-direction:column;gap:5px">${sorted.map(alertCardHTML).join('')}</div>`;
  }
  body.querySelectorAll('.alert-card').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('.crisis-btn')) return;
    selectAlert(el.dataset.id);
  }));
  body.querySelectorAll('.crisis-btn').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    const a = ALERTS.find(x => x.id === el.dataset.id);
    if (a && a.officeId) {
      STATE.selectedOffices = [a.officeId];
      openPanel('crisis'); setCcTab('compose'); renderCC();
      toast(`${a.officeId} pre-loaded in Crisis Comms.`);
    }
  }));
  body.querySelectorAll('.details-btn').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    showAlertDetails(el.dataset.details);
  }));
  body.querySelectorAll('[data-expand]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    STATE.expandedOffices.add(el.dataset.expand); renderFeed();
  }));
  body.querySelectorAll('[data-collapse]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    STATE.expandedOffices.delete(el.dataset.collapse); renderFeed();
  }));
}
function alertCardHTML(a) {
  const sel = STATE.selectedAlertId === a.id ? 'selected' : '';
  const officeBadges = (a.affectedOfficeIds || []).map(id =>
    `<span class="impact-badge impact-office" title="${esc(OFFICE_BY_ID[id]?.name || id)} office in impact radius">🏢 ${esc(id)}</span>`
  ).join('');
  const travCount = (a.affectedTravelers || []).length;
  const travBadge = travCount
    ? `<span class="impact-badge impact-trav" title="${travCount} traveler${travCount>1?'s':''} within radius">✈ ${travCount}</span>`
    : '';
  const empCount = a.totalEmployeesAffected || 0;
  const empBadge = empCount
    ? `<span class="impact-badge impact-emp" title="${empCount} employees in office headcounts within radius">👥 ${empCount}</span>`
    : '';
  // Three-tier relevance — see relevanceTierOf. The chip leads the impact
  // row (left of the existing 🏢/✈/👥 badges) so an operator scanning the
  // feed reads "is this me?" before "what's affected?".
  const tierChip = a.relevanceTier === 'direct'
    ? `<span class="tier-chip direct" title="Direct — an office or current traveler is within this event's impact radius">🎯 Direct</span>`
    : a.relevanceTier === 'indirect'
      ? `<span class="tier-chip indirect" title="Indirect — alert is in a country where NR has presence (office or active traveler)">📍 In-country</span>`
      : a.relevanceTier === 'watch'
        ? `<span class="tier-chip watch" title="Watch — extreme severity globally; informational, not response-trigger">👁 Watch</span>`
        : '';
  const impactRow = (tierChip || officeBadges || travBadge || empBadge)
    ? `<div class="a-impact">${tierChip}${officeBadges}${travBadge}${empBadge}</div>`
    : '';
  return `<div class="alert-card s-${a.sev} ${sel}" data-id="${a.id}">
    <div class="top-row">
      <span class="sev-pill ${a.sev}">${SEV_NAME[a.sev]}</span>
      <span class="src-pill">${a.source}</span>
      <span class="a-title">${a.title}</span>
    </div>
    <div class="a-sub">
      <span>${a.location}</span>·<span>${relTime(a.issued)}</span>·<span>${a.type}</span>
    </div>
    ${impactRow}
    <div style="display:flex;gap:4px;margin-top:6px">
      <button class="details-btn" data-details="${a.id}">Details</button>
      ${a.officeId?`<button class="crisis-btn" data-id="${a.id}">Crisis</button>`:''}
    </div>
  </div>`;
}
function selectAlert(id) {
  STATE.selectedAlertId = id;
  const a = ALERTS.find(x => x.id === id); if (!a) return;
  map.setView([a.lat, a.lng], Math.max(map.getZoom(), 5));
  renderFeed();
  toast(`${SEV_NAME[a.sev]} · ${a.title}`);
}

/* ---------- 11. CRISIS COMMS render ---------- */
function setCcTab(t) { STATE.ccTab = t;
  document.querySelectorAll('[data-cc-tab]').forEach(el => el.classList.toggle('active', el.dataset.ccTab===t));
  renderCC();
}
function renderCC() {
  const body = document.getElementById('cc-body');
  document.getElementById('cc-log-count').textContent = STATE.crisisLog.length;
  if (STATE.ccTab === 'compose') body.innerHTML = renderComposeForm();
  else if (STATE.ccTab === 'log') body.innerHTML = renderCCLog();
  else body.innerHTML = renderRoom();
  bindCCHandlers();
}
/* allTargets() moved to helpers.js — bridged via main.js. */
/* targetById() moved to helpers.js — bridged via main.js. */
/* recipientsForChannel() moved to helpers.js — bridged via main.js. */

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
const TEST_ROUTING = (typeof window !== 'undefined' && window.NRSA_TEST_ROUTING) || {
  slack: '#cmt-test-channel',
  email: 'cmt-test-distro@newrelic.com',
  sms:   null,                             // SMS test routing intentionally absent
};
const TEST_PREFIX_SUBJECT = '[TEST] ';
const TEST_PREFIX_BODY = '🧪 TEST DRILL — DO NOT ACT — this message was sent in drill mode and is logged with isTest=true. Real recipients should disregard.\n\n';

function testRecipientsForChannel(ch) {
  const dest = TEST_ROUTING[ch];
  return dest ? [dest] : [];
}
/* allTemplates() moved to helpers.js — bridged via main.js. */

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
/* suggestTemplate() moved to helpers.js — bridged via main.js. */

/* Render the Compose template <select> with optgroup headers grouped by
   TEMPLATE_CATEGORIES. Custom user templates land in a "Custom" group at
   the end. Returns inner-HTML for the <select>. */
function renderTemplatePickerOptions() {
  const tpls = allTemplates();
  const byCat = new Map();
  for (const t of tpls) {
    const list = byCat.get(t.category) || [];
    list.push(t);
    byCat.set(t.category, list);
  }
  for (const list of byCat.values()) list.sort((a,b) => a.priority - b.priority);
  const optgroups = [];
  for (const cat of TEMPLATE_CATEGORIES) {
    const list = byCat.get(cat.id) || [];
    if (list.length === 0) continue;
    optgroups.push(`<optgroup label="${esc(cat.label)}">${
      list.map(t => `<option value="${esc(t.id)}" ${STATE.template===t.id?'selected':''}>${esc(t.name)}</option>`).join('')
    }</optgroup>`);
  }
  // Custom templates last
  const custom = byCat.get('custom') || [];
  if (custom.length > 0) {
    optgroups.push(`<optgroup label="Custom">${
      custom.map(t => `<option value="${esc(t.id)}" ${STATE.template===t.id?'selected':''}>${esc(t.name)}</option>`).join('')
    }</optgroup>`);
  }
  return `<option value="">— select —</option>${optgroups.join('')}`;
}
function hasDraftContent() {
  return STATE.selectedOffices.length > 0 || STATE.customMessage || STATE.subject || STATE.template;
}
function renderComposeForm() {
  const reachOffices = STATE.selectedOffices.length;
  const reachEmps = STATE.selectedOffices.reduce((s,id)=>{
    const t = targetById(id); return s + (t?.headcount || 0);
  },0);
  const reachTrav = TRAVELERS.filter(t => STATE.selectedOffices.includes(t.atOffice)).length;
  const activeChannels = Object.entries(STATE.channels).filter(([k,v])=>v).map(([k])=>k);
  const message = STATE.customMessage ||
    (STATE.template ? (allTemplates().find(t=>t.id===STATE.template)?.body || '') : '');

  // toggle "Clear ✕" button visibility
  const clearBtn = document.getElementById('btn-clear-draft');
  if (clearBtn) clearBtn.style.display = hasDraftContent() ? '' : 'none';

  const linked = STATE.linkedIncidentId ? STATE.incidents.find(x => x.id === STATE.linkedIncidentId) : null;
  // Defensive: test mode is unavailable inside an existing incident's compose
  // flow (operator clarification 2026-06-18, Q3). Force-clear here so the flag
  // can never leak through unnoticed if the operator linked an incident after
  // toggling test on. The toggle UI is also hidden when `linked`, but this is
  // belt-and-suspenders: dispatchSend reads STATE.isTest, not the DOM.
  if (linked && STATE.isTest) STATE.isTest = false;
  const linkedBanner = linked ? `
    <div class="linked-banner">
      <span class="linked-icon" aria-hidden="true">🔗</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Linked to incident</div>
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(linked.title)}</div>
      </div>
      <a href="#" id="cc-unlink" class="field-action muted" title="Unlink — next message will create a new incident">Unlink</a>
    </div>` : '';

  return `<div class="compose-form">
    ${linkedBanner}
    <div class="field">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <label style="margin-bottom:0">Offices</label>
        <div style="font-size:10px">
          <a href="#" id="cc-add-all" style="color:var(--green);margin-right:8px">Add all</a>
          <a href="#" id="cc-clear-offices" style="color:var(--muted)">Clear</a>
        </div>
      </div>
      <select id="cc-office-pick" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:7px 8px;font-size:12px;margin-bottom:6px">
        <option value="">Select an office...</option>
        ${OFFICES.filter(o=>!STATE.selectedOffices.includes(o.id)).map(o=>`<option value="${o.id}">${o.id} · ${o.name}${o.headcount!=null?` · ${o.headcount.toLocaleString()}`:''}</option>`).join('')}
        ${STATE.customLocations.filter(c=>!STATE.selectedOffices.includes(c.id)).map(c=>`<option value="${esc(c.id)}">${esc(c.id)} · ${esc(c.name)} (custom)</option>`).join('')}
      </select>
      <div style="display:flex;gap:4px;margin-bottom:6px">
        <input type="text" id="cc-new-loc" placeholder="Add new location..." style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:12px"/>
        <button class="btn-ghost" id="cc-add-loc">Add</button>
      </div>
      <div class="chip-list" id="chip-list" style="border:0;background:transparent;padding:0">
        ${STATE.selectedOffices.map(id=>{
          const t = targetById(id);
          return `<span class="chip" data-id="${esc(id)}">${esc(t?t.name:id)}<x onclick="App.removeOffice('${esc(id)}')">×</x></span>`;
        }).join('')}
      </div>
    </div>

    <div class="field">
      <label>Channels</label>
      <div class="channel-row">
        <div class="channel-pill ${STATE.channels.slack?'on':''}" data-ch="slack">💬 slack</div>
        <div class="channel-pill ${STATE.channels.email?'on':''}" data-ch="email">✉️ email</div>
        <div class="channel-pill disabled" data-ch="sms">📱 sms</div>
      </div>
    </div>

    ${activeChannels.length && reachOffices ? `<div class="field">
      <label>Recipients</label>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:6px 10px;font-size:11px;display:flex;flex-direction:column;gap:4px">
        ${activeChannels.map(ch => {
          const recs = recipientsForChannel(ch, STATE.selectedOffices);
          const icon = ch==='slack'?'💬':ch==='email'?'✉️':'📱';
          return `<div style="display:flex;gap:6px;align-items:flex-start"><span>${icon}</span><span style="color:var(--text)">${recs.join(', ')}</span></div>`;
        }).join('')}
      </div>
    </div>` : ''}

    <div class="field">
      <label>Template</label>
      <div style="display:flex;gap:4px">
        <select id="cc-tpl-pick" style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:7px 8px;font-size:12px">
          ${renderTemplatePickerOptions()}
        </select>
        <button class="btn-ghost" id="cc-tpl-add" title="Add custom template">+</button>
      </div>
    </div>

    <div class="field">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <label style="margin-bottom:0">Message</label>
        <a href="#" id="cc-clear-msg" style="font-size:10px;color:var(--muted)">Clear</a>
      </div>
      <textarea id="msg-body" placeholder="Compose the safety message... URLs you paste will be clickable when received.">${esc(message)}</textarea>
    </div>

    ${(() => {
      // Advanced disclosure — keeps secondary fields out of the way for the 80% case
      const adv = [];
      if (STATE.subject) adv.push('Subject set');
      if (STATE.attachments.length) adv.push(`${STATE.attachments.length} attachment${STATE.attachments.length===1?'':'s'}`);
      if (!STATE.responseRequired) adv.push('Response off');
      if (STATE.reminderInterval !== '15m') adv.push('Reminder ' + STATE.reminderInterval);
      const hint = adv.length ? `<span class="cc-advanced-hint"> · ${adv.join(' · ')}</span>` : '';
      const open = STATE.composeAdvanced;
      return `<button class="cc-advanced-toggle" type="button" id="cc-advanced-toggle" aria-expanded="${open}">
        <span class="cc-advanced-caret">${open ? '▾' : '▸'}</span>
        Advanced${hint}
      </button>
      ${open ? `<div class="cc-advanced-body">
        <div class="field">
          <label>Subject</label>
          <input type="text" id="cc-subject" value="${esc(STATE.subject)}" placeholder="[Severity] Safety Alert — ..."/>
        </div>
        <div class="field">
          <label>Attachments & Links</label>
          <div class="att-zone" id="att-zone-cc">
            Drop files here, paste, or
            <button type="button" class="att-pick-btn" id="att-pick-cc">Choose files</button>
            <input type="file" id="att-input-cc" multiple style="display:none"/>
            <div style="font-size:10px;margin-top:4px">URLs in your message auto-link. Files ≤ ${fmtSize(ATT_EMBED_LIMIT)} are embedded.</div>
          </div>
          ${STATE.attachments.length ? `<div class="att-list">${STATE.attachments.map(a => attachmentChipHTML(a, true)).join('')}</div>` : ''}
        </div>
        <div class="field" style="margin-bottom:6px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:12px;color:var(--text);font-weight:400">
            <input type="checkbox" id="resp-required" ${STATE.responseRequired?'checked':''} style="width:auto"/>
            Response required (track per-employee status in incident)
          </label>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:8px">
          <label style="margin-bottom:0;text-transform:none;letter-spacing:0;font-size:11px;color:var(--muted);font-weight:400">Remind after</label>
          <select id="reminder" style="flex:1">
            <option value="15m" ${STATE.reminderInterval==='15m'?'selected':''}>15 minutes</option>
            <option value="30m" ${STATE.reminderInterval==='30m'?'selected':''}>30 minutes</option>
            <option value="1h"  ${STATE.reminderInterval==='1h' ?'selected':''}>1 hour</option>
            <option value="4h"  ${STATE.reminderInterval==='4h' ?'selected':''}>4 hours</option>
            <option value="1d"  ${STATE.reminderInterval==='1d' ?'selected':''}>1 day</option>
          </select>
        </div>
      </div>` : ''}`;
    })()}

    ${linked ? '' : `
    <div class="test-mode-row ${STATE.isTest ? 'on' : ''}" title="Send a test (drill) message instead of a real one. The message lands in a real incident with an is_test flag so the audit trail stays clear.">
      <label>
        <input type="checkbox" id="cc-test-mode" ${STATE.isTest?'checked':''} style="width:auto;margin:0;flex-shrink:0;"/>
        <span class="tm-title">🧪 Send as Test</span>
        <span class="tm-hint">Drill mode — message logs with TEST badge, routes to ${esc(TEST_ROUTING.slack)} only, [TEST] prefix prepended.</span>
      </label>
    </div>`}

    <button class="btn-primary cc-send" id="btn-send" ${reachOffices&&activeChannels.length?'':'disabled'}
      style="${STATE.isTest && !linked ? 'background:#22d3ee;color:#053041;border-color:#0891b2;' : ''}">
      ${STATE.isTest && !linked
        ? `🧪 Send as Test to ${esc(TEST_ROUTING.slack)} ▶`
        : linked
          ? `Send & log to incident ▶`
          : `Send to ${reachOffices} office${reachOffices===1?'':'s'} ▶`}
    </button>
  </div>`;
}
function renderCCLog() {
  if (!STATE.crisisLog.length) return '<div class="empty">No messages sent yet.</div>';
  return STATE.crisisLog.slice().reverse().map(e => `
    <div class="crisis-log-entry${e.isTest?' is-test':''}">
      <div>
        <span class="when">${new Date(e.when).toLocaleString()}</span> · <span class="who">${esc(e.by)}</span>
        ${e.isTest?' <span class="test-badge" title="Drill — sent in test mode, routed to test channel only">🧪 Test</span>':''}
      </div>
      ${e.subject?`<div style="font-weight:600;font-size:12px;margin-top:2px">${esc(e.subject)}</div>`:''}
      <div class="body" style="white-space:pre-wrap">${linkify(esc(e.body))}</div>
      ${e.attachments?.length?`<div class="att-list">${e.attachments.map(a => attachmentChipHTML(a, false)).join('')}</div>`:''}
      <div class="meta">
        ${e.offices.map(o=>`<span class="src-pill">${esc(o)}</span>`).join('')}
        ${e.channels.map(c=>`<span class="src-pill">${esc(c)}</span>`).join('')}
        <span class="src-pill">${(e.recipients ?? e.recipientsCount ?? 0)} recipients</span>
        ${e.responseRequired?'<span class="src-pill" style="color:var(--green);border-color:var(--green)">tracked</span>':''}
        ${e.attachments?.length?`<span class="src-pill">📎 ${e.attachments.length}</span>`:''}
      </div>
    </div>`).join('');
}
function renderRoom() {
  return `<div class="room-thread" id="room-thread">
    ${STATE.roomMessages.map(m=>`<div class="room-msg"><span class="from">${esc(m.from)}</span><span class="when">${relTime(m.when)} ago</span><div style="white-space:pre-wrap">${linkify(esc(m.body))}</div></div>`).join('')}
  </div>
  <div class="room-input">
    <input id="room-input" placeholder="Post to CMT situation room..." />
    <button class="btn-ghost" id="room-send">Post</button>
  </div>`;
}
/** Wire a drag/drop + click + paste attachments zone.
 *  zoneEl + inputEl + pickBtnEl + onAdd(att[]) + onRemove(id) callbacks. */
function wireAttZone({ zoneId, inputId, pickId, getList, setList, onChange }) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const pick = document.getElementById(pickId);
  if (!zone || !input || !pick) return;
  pick.onclick = (e) => { e.preventDefault(); input.click(); };
  zone.onclick = (e) => { if (e.target === zone) input.click(); };
  input.onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    const atts = await Promise.all(files.map(fileToAttachment));
    setList([...getList(), ...atts]);
    e.target.value = ''; onChange();
    atts.forEach(a => { if (a.oversized) toast(`"${a.name}" is over ${fmtSize(ATT_EMBED_LIMIT)} — kept as a reference but not embedded.`); });
  };
  ['dragenter','dragover'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add('dragging');
  }));
  ['dragleave','drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('dragging');
  }));
  zone.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const atts = await Promise.all(files.map(fileToAttachment));
    setList([...getList(), ...atts]);
    onChange();
    atts.forEach(a => { if (a.oversized) toast(`"${a.name}" is over ${fmtSize(ATT_EMBED_LIMIT)} — kept as a reference but not embedded.`); });
  });
  // Bind remove handlers on existing chips
  document.querySelectorAll(`#${zoneId} ~ .att-list [data-att-remove], #${zoneId.replace('-zone-','-list-')} [data-att-remove]`).forEach(b => {
    b.onclick = () => {
      const id = b.dataset.attRemove;
      setList(getList().filter(a => a.id !== id));
      onChange();
    };
  });
}

function bindCCHandlers() {
  // Compose attachments zone
  wireAttZone({
    zoneId: 'att-zone-cc',
    inputId: 'att-input-cc',
    pickId: 'att-pick-cc',
    getList: () => STATE.attachments,
    setList: (list) => { STATE.attachments = list; },
    onChange: () => renderCC(),
  });
  // Bind remove buttons (att-list is sibling-ish; cover all in compose form)
  document.querySelectorAll('.compose-form [data-att-remove]').forEach(b => b.onclick = () => {
    STATE.attachments = STATE.attachments.filter(a => a.id !== b.dataset.attRemove);
    renderCC();
  });

  // Template dropdown
  document.getElementById('cc-tpl-pick')?.addEventListener('change', e => {
    STATE.template = e.target.value;
    const t = allTemplates().find(x => x.id === STATE.template);
    if (t) {
      STATE.customMessage = t.body;
      // auto-fill subject if empty
      if (!STATE.subject) STATE.subject = `[Safety] ${t.name}${STATE.selectedOffices.length===1?` — ${targetById(STATE.selectedOffices[0])?.name||''} Office`:''}`;
    }
    renderCC();
  });
  document.getElementById('cc-tpl-add')?.addEventListener('click', () => {
    showModal(`<h3>New custom template</h3>
      <div class="field"><label>Name</label><input id="utpl-name" placeholder="e.g. Severe Weather Hold"/></div>
      <div class="field"><label>Body</label><textarea id="utpl-body" placeholder="Message body..."></textarea></div>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="App.closeModal()">Cancel</button>
        <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px" id="utpl-save">Save Template</button>
      </div>`);
    document.getElementById('utpl-save').onclick = () => {
      const name = document.getElementById('utpl-name').value.trim();
      const body = document.getElementById('utpl-body').value.trim();
      if (!name || !body) { toast('Name and body required.'); return; }
      const id = 'u_'+Math.random().toString(36).slice(2,7);
      STATE.userTemplates.push({ id, name, body });
      STATE.template = id;
      STATE.customMessage = body;
      closeModal();
      renderCC();
      toast('Template saved.');
    };
  });

  // Channels
  document.querySelectorAll('[data-ch]').forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.ch;
    if (k === 'sms') return;
    STATE.channels[k] = !STATE.channels[k];
    renderCC();
  }));

  // Office single-select dropdown
  document.getElementById('cc-office-pick')?.addEventListener('change', e => {
    const id = e.target.value;
    if (!id) return;
    if (!STATE.selectedOffices.includes(id)) STATE.selectedOffices.push(id);
    renderCC();
  });
  // Add custom location
  document.getElementById('cc-add-loc')?.addEventListener('click', () => {
    const inp = document.getElementById('cc-new-loc');
    const name = inp.value.trim();
    if (!name) return;
    const id = 'CL_'+Math.random().toString(36).slice(2,5).toUpperCase();
    STATE.customLocations.push({ id, name });
    STATE.selectedOffices.push(id);
    inp.value = '';
    renderCC();
    toast(`Custom location "${name}" added.`);
  });
  document.getElementById('cc-new-loc')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('cc-add-loc').click(); }
  });
  document.getElementById('cc-add-all')?.addEventListener('click', e => {
    e.preventDefault();
    STATE.selectedOffices = OFFICES.map(o => o.id);
    renderCC();
  });
  document.getElementById('cc-clear-offices')?.addEventListener('click', e => {
    e.preventDefault();
    STATE.selectedOffices = [];
    renderCC();
  });

  // Subject + message + response + reminder
  document.getElementById('cc-subject')?.addEventListener('input', e => { STATE.subject = e.target.value; saveState(); });
  document.getElementById('msg-body')?.addEventListener('input', e => { STATE.customMessage = e.target.value; saveState(); });
  document.getElementById('cc-clear-msg')?.addEventListener('click', e => {
    e.preventDefault();
    STATE.customMessage = ''; STATE.template = ''; STATE.subject = '';
    renderCC();
  });
  document.getElementById('cc-advanced-toggle')?.addEventListener('click', () => {
    STATE.composeAdvanced = !STATE.composeAdvanced;
    renderCC();
  });
  document.getElementById('cc-unlink')?.addEventListener('click', e => {
    e.preventDefault();
    STATE.linkedIncidentId = null;
    toast('Unlinked. Next message will create a new incident.');
    renderCC();
  });
  document.getElementById('resp-required')?.addEventListener('change', e => STATE.responseRequired = e.target.checked);
  // Test-mode toggle: re-render the form so the Send button + recipient hint
  // pick up the new state. (Cheap — Compose re-render is sub-ms.)
  document.getElementById('cc-test-mode')?.addEventListener('change', e => {
    STATE.isTest = !!e.target.checked;
    saveState();
    renderCC();
  });
  document.getElementById('reminder')?.addEventListener('change', e => STATE.reminderInterval = e.target.value);

  // Send
  document.getElementById('btn-send')?.addEventListener('click', confirmSend);

  // Room
  document.getElementById('room-send')?.addEventListener('click', () => {
    const inp = document.getElementById('room-input');
    if (!inp.value.trim()) return;
    STATE.roomMessages.push({ from:'cowork-3p', when:new Date().toISOString(), body:inp.value });
    inp.value=''; renderCC();
  });

  // Panel-level Clear ✕ (binds once but harmless to rebind)
  const clearBtn = document.getElementById('btn-clear-draft');
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = '1';
    clearBtn.onclick = () => {
      showModal(`<h3>Clear draft?</h3>
        <p style="font-size:12px;color:var(--muted);line-height:1.5">
          This will reset selected offices, subject, message, template, and channels back to defaults.
          The Crisis Log and any sent messages are not affected.
        </p>
        <div class="modal-actions">
          <button class="btn-ghost" id="modal-cancel">Cancel</button>
          <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px;background:var(--red);color:#fff" id="modal-confirm">Clear draft</button>
        </div>`);
      document.getElementById('modal-cancel').onclick = closeModal;
      document.getElementById('modal-confirm').onclick = () => {
        STATE.selectedOffices = [];
        STATE.template = ''; STATE.customMessage = ''; STATE.subject = '';
        STATE.attachments = [];
        STATE.channels = { slack:true, email:false, sms:false };
        closeModal();
        renderCC();
        toast('Draft cleared.');
      };
    };
  }
}
function confirmSend() {
  const channels = Object.entries(STATE.channels).filter(([k,v])=>v && k!=='sms').map(([k])=>k);
  if (!channels.length || !STATE.selectedOffices.length) return;
  const body = STATE.customMessage || (allTemplates().find(t=>t.id===STATE.template)?.body || '');
  if (!body.trim()) { toast('Pick a template or write a message.'); return; }
  const reach = STATE.selectedOffices.reduce((s,id)=>s+(targetById(id)?.headcount||0),0);
  const tplName = allTemplates().find(t=>t.id===STATE.template)?.name || 'Custom';
  showModal(`
    <h3>Confirm send</h3>
    <p style="font-size:12px;color:var(--muted)">Review before dispatching.</p>
    <div class="reach-preview" style="margin-top:8px">
      <div><b>Offices:</b> ${esc(STATE.selectedOffices.map(id=>targetById(id)?.name||id).join(', '))}</div>
      <div><b>Channels:</b> ${channels.map(c=>c.toUpperCase()).join(' + ')}</div>
      <div><b>Recipients:</b> ~${reach.toLocaleString()}</div>
      <div><b>Template:</b> ${esc(tplName)}</div>
      ${STATE.subject?`<div><b>Subject:</b> ${esc(STATE.subject)}</div>`:''}
      ${STATE.responseRequired?'<div><b>Response tracking:</b> on (creates new incident)</div>':''}
    </div>
    <div style="font-size:11px;background:var(--bg3);border-radius:5px;padding:6px;margin-top:8px;line-height:1.4">${esc(body)}</div>
    <div class="modal-actions">
      <button class="btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px" id="modal-confirm">Confirm Send</button>
    </div>`);
  document.getElementById('modal-cancel').onclick = closeModal;
  document.getElementById('modal-confirm').onclick = () => {
    closeModal();
    dispatchSend(body, channels, reach);
  };
}
function dispatchSend(body, channels, reach) {
  const tpl = allTemplates().find(t => t.id === STATE.template);
  const tplName = tpl?.name || 'Custom message';

  // 2026-06-18: drill-mode dispatch.
  //
  // When STATE.isTest is on (and we are NOT linked to an existing incident,
  // because test mode is locked off in that flow), apply three transforms
  // ONLY to the artifact actually delivered to a recipient:
  //   1) Subject prepended with "[TEST] " so a recipient sees TEST first.
  //   2) Body prepended with the drill-warning preamble.
  //   3) Channels filtered to those that have a TEST_ROUTING entry (SMS
  //      drops out by design — no test SMS distro).
  //
  // EVERYTHING ELSE is left at the operator's actual selection so the drill
  // exercises the full normal workflow (per the 2026-06-18 spec: "all of the
  // normal features but recorded as test messages"):
  //   - msg.offices keeps STATE.selectedOffices so the incident scope and
  //     response-tracking shells reflect the drill scenario.
  //   - msg.responseRequired keeps STATE.responseRequired so the operator
  //     can rehearse the response-tracking UI inside the drill incident.
  //   - The auto-incident-create branch fires unchanged when the operator
  //     had Response Required on. The resulting incident is REAL (per Q1
  //     of the design Q&A) — its drill nature is signaled by the 🧪 TEST
  //     badge on the message inside + the "incl. test" hint on the card.
  //
  // The is_test flag persists everywhere downstream: msg.isTest in local
  // state, isTest in the API payload, is_test=true in Postgres, 🧪 TEST
  // badge in every render surface (Comms tab, standalone log, incident Log,
  // Export Report).
  const linkedAtSendTime = STATE.linkedIncidentId
    ? STATE.incidents.find(x => x.id === STATE.linkedIncidentId)
    : null;
  const isTest = !!STATE.isTest && !linkedAtSendTime;
  const testChannels = isTest
    ? channels.filter(c => TEST_ROUTING[c])           // drop SMS (no test routing)
    : channels;
  const sendChannels = isTest && testChannels.length ? testChannels : channels;
  const finalSubject = isTest
    ? TEST_PREFIX_SUBJECT + (STATE.subject || `[${tplName}]`)
    : STATE.subject;
  const finalBody = isTest ? TEST_PREFIX_BODY + body : body;

  const msg = {
    id: uid(), when: new Date().toISOString(), by:'cowork-3p',
    offices: STATE.selectedOffices.slice(), channels: sendChannels.slice(),
    subject: finalSubject,
    body: finalBody, recipients: reach, responseRequired: STATE.responseRequired,
    template: STATE.template, templateName: tplName,
    reminder: STATE.reminderInterval,
    attachments: STATE.attachments.slice(),
    incidentId: null,    // filled below
    isTest,              // persisted client-side and propagated through API
  };

  let inc = linkedAtSendTime;

  if (inc) {
    // Append to existing incident
    msg.incidentId = inc.id;
    inc.messages.push(msg);
    // top up response shells in case offices were added since open
    buildResponseShells(inc.id, STATE.selectedOffices);
    addIncidentLog(inc.id, 'comm', `Sent <b>${esc(tplName)}</b> via ${channels.join(', ')} to ${reach.toLocaleString()} recipients.`);
  } else if (STATE.responseRequired) {
    // Create new incident on first response-required send.
    // Auto-link the highest-severity active alert in the affected offices, if any.
    const candidateAlerts = ALERTS
      .filter(a => a.officeId && STATE.selectedOffices.includes(a.officeId) && passesFilter(a))
      .sort((a,b) => SEV_RANK[b.sev] - SEV_RANK[a.sev] || new Date(b.issued) - new Date(a.issued));
    const linkedAlert = candidateAlerts[0] || null;
    const officeNames = STATE.selectedOffices.map(id => targetById(id)?.name || id).join(', ');
    inc = createIncident({
      title: `${tplName} — ${STATE.selectedOffices.join(', ')}`,
      offices: STATE.selectedOffices.slice(),
      severity: STATE.template==='evac' || STATE.template==='shelter' ? 'high' : 'mod',
      description: `Incident auto-created when "${tplName}" was dispatched with Response Required enabled. Initial reach: ~${reach.toLocaleString()} recipients across ${officeNames}. Channels: ${channels.map(c=>c.toUpperCase()).join(', ')}. Reminder interval: ${STATE.reminderInterval}.${linkedAlert?` Linked to active alert ${linkedAlert.id}: ${linkedAlert.title}.`:''}`,
      messageId: msg.id,
      alertId: linkedAlert ? linkedAlert.id : null,
    });
    msg.incidentId = inc.id;
    inc.messages.push(msg);
    addIncidentLog(inc.id, 'comm', `Sent <b>${esc(tplName)}</b> via ${channels.join(', ')} to ${reach.toLocaleString()} recipients.`);
  }

  STATE.crisisLog.push(msg);
  if (isTest) {
    // Drill-mode toast: clearly signal that nothing went to real recipients,
    // and that the message is logged with the test flag for audit.
    const routingHint = sendChannels.map(c => `${c.toUpperCase()} → ${TEST_ROUTING[c]}`).join(' · ');
    toast(`🧪 TEST logged · ${routingHint || 'logged only (no test routing for selected channels)'}`);
  } else {
    toast(`✓ Dispatched to ~${reach.toLocaleString()} via ${channels.map(c=>c.toUpperCase()).join('+')}${msg.attachments.length?` · ${msg.attachments.length} attachment${msg.attachments.length===1?'':'s'}`:''}`);
  }
  STATE.customMessage = ''; STATE.subject = ''; STATE.template = '';
  STATE.attachments = [];
  // Reset the test toggle after a send. Operators should opt-in deliberately
  // each time — leaving it sticky risks a real send accidentally going to
  // the test channel, which would be a worse failure mode than the reverse
  // (forgetting to toggle on a drill is recoverable; sending real comms to
  // #cmt-test-channel during an actual incident is not).
  STATE.isTest = false;
  STATE.linkedIncidentId = inc ? inc.id : null;   // keep linked for subsequent messages in the flow
  setCcTab('log');
  renderIncidents();
  if (inc) selectIncident(inc.id);

  // Live mode: persist the message. Three cases:
  //   - Linked to a server-persisted incident → POST /api/incidents/:id/messages
  //   - Linked to a still-being-created incident → skip server (would 404);
  //     log warning so we don't silently drop in production
  //   - Standalone (no incident at all) → POST /api/comms
  if (API_BASE) {
    const apiPayload = {
      template:         msg.template ?? undefined,
      templateName:     msg.templateName,
      subject:          msg.subject || undefined,
      body:             msg.body,
      channels:         msg.channels,
      offices:          msg.offices,
      recipientsCount:  msg.recipients,
      responseRequired: msg.responseRequired,
      reminderInterval: msg.reminder ?? undefined,
      attachments:      msg.attachments,
      isTest:           msg.isTest,
    };
    if (inc && !inc._persistPending) {
      incidentsApi.sendMessage(inc.id, apiPayload).then((serverMsgId) => {
        if (serverMsgId) msg.id = serverMsgId;
      }).catch(err => {
        console.warn('incident-linked message persist failed:', err);
        toast('⚠ Message logged locally — backend persist failed.');
      });
    } else if (inc && inc._persistPending) {
      // Race fix (2026-06-18): the incident's create() round-trip is still
      // in flight, so its server UUID isn't known yet. Park this message
      // on a queue; createIncident's .then() handler will flush it after
      // the UUID swap. Without this branch, the first Response-Required
      // send silently skipped backend persist — the smoke harness caught
      // this on its first run.
      inc._pendingMessages = inc._pendingMessages || [];
      inc._pendingMessages.push({ msg, apiPayload });
    } else {
      commsApi.send(apiPayload).then((serverMsgId) => {
        if (serverMsgId) msg.id = serverMsgId;
      }).catch(err => {
        console.warn('standalone comms persist failed:', err);
        toast('⚠ Message logged locally — backend persist failed.');
      });
    }
  }
}

/* ---------- 12. INCIDENTS render ---------- */
function createIncident({ title, offices, severity, description, messageId, alertId }) {
  const inc = {
    id: uid(), title, offices, severity, description, messageId, alertId: alertId || null,
    opened: new Date().toISOString(), status:'open', closedNote:null, closedAt:null,
    notes: [], log: [], messages: [],
    reopens: [],   // [{ when, by }] each time the incident is reopened
    _persistPending: !!API_BASE,   // true while the backend round-trip is in flight
  };
  STATE.incidents.unshift(inc);
  STATE.responses[inc.id] = {};
  buildResponseShells(inc.id, offices);
  addIncidentLog(inc.id, 'create', `Incident <b>${esc(title)}</b> opened.`);

  // Live mode: fire-and-forget persist to backend. We use the local client
  // ID until the server returns; on success we swap to the server-issued
  // UUID and update STATE.responses to match. On failure we log + toast
  // but do NOT block the user's flow — better to keep the dashboard usable
  // and have a partial-persist scenario than to lose the incident entirely.
  if (API_BASE) {
    incidentsApi.create({ title, description, severity, offices, alertId: alertId || undefined })
      .then((serverInc) => {
        // Swap local id → server UUID across STATE so subsequent
        // mutations (close/reopen/notes/responses) target the right row.
        const oldId = inc.id;
        const newId = serverInc.id;
        if (oldId === newId) return;       // shouldn't happen, but safe
        inc.id = newId;
        inc.opened = serverInc.opened;
        inc._persistPending = false;
        STATE.responses[newId] = STATE.responses[oldId] || {};
        delete STATE.responses[oldId];
        if (STATE.selectedIncidentId === oldId) STATE.selectedIncidentId = newId;
        if (STATE.linkedIncidentId === oldId) STATE.linkedIncidentId = newId;

        // Flush any messages that were queued while this create was in
        // flight (see dispatchSend's _pendingMessages branch). Sequential
        // sends are fine — the queue is typically 1-2 entries — and serial
        // ordering preserves the operator's intended message order in the
        // incident's audit trail.
        const queued = inc._pendingMessages || [];
        inc._pendingMessages = [];
        for (const q of queued) {
          incidentsApi.sendMessage(newId, q.apiPayload).then((serverMsgId) => {
            if (serverMsgId) q.msg.id = serverMsgId;
          }).catch((e) => {
            console.warn('queued message persist failed:', e);
            toast('⚠ A queued message failed to persist to backend.');
          });
        }

        renderIncidents();
      })
      .catch((err) => {
        console.warn('incident create persist failed (kept local):', err);
        inc._persistPending = false;
        const stranded = (inc._pendingMessages || []).length;
        inc._pendingMessages = [];
        toast(stranded
          ? `⚠ Incident + ${stranded} message(s) saved locally — backend persist failed.`
          : '⚠ Incident saved locally — backend persist failed. See console.');
      });
  }

  return inc;
}
function buildResponseShells(incidentId, offices) {
  offices.forEach(oid => {
    EMPLOYEES.filter(e => e.office === oid).forEach(e => {
      if (!STATE.responses[incidentId][e.id]) {
        STATE.responses[incidentId][e.id] = { status:'no', when:null, by:null };
      }
    });
    travelersAtOffice(oid).forEach(t => {
      const key = 'T-'+t.id;
      if (!STATE.responses[incidentId][key]) {
        STATE.responses[incidentId][key] = { status:'no', when:null, by:null, traveler:true };
      }
    });
  });
}
function reopenIncident(incidentId) {
  const inc = STATE.incidents.find(x => x.id === incidentId); if (!inc) return;
  const wasClosedAt = inc.closedAt;
  const wasLogLength = inc.log.length;
  inc.status = 'open';
  inc.closedAt = null;
  inc.reopens.push({ when: new Date().toISOString(), by:'cowork-3p' });
  addIncidentLog(inc.id, 'create', `Incident <b>reopened</b>.`);
  toast('Incident reopened.');
  renderIncidents();
  // Live mode: persist (fire-and-forget). Revert if backend rejects —
  // including the audit-log entry, so the timeline stays honest.
  if (API_BASE && !inc._persistPending) {
    incidentsApi.reopen(inc.id).catch(err => {
      console.warn('incident reopen persist failed:', err);
      inc.status = 'closed';
      inc.closedAt = wasClosedAt;
      inc.reopens.pop();
      inc.log.length = wasLogLength;     // truncate log to pre-reopen state
      toast('⚠ Reopen failed on backend — reverted locally.');
      renderIncidents();
    });
  }
}
function addIncidentLog(id, kind, body) {
  const inc = STATE.incidents.find(x=>x.id===id); if (!inc) return;
  inc.log.push({ when: new Date().toISOString(), by:'cowork-3p', kind, body });
}
function setIncidentTab(t) { STATE.incidentTab = t; renderIncidentDetail(); }
function selectIncident(id) {
  STATE.selectedIncidentId = id;
  STATE.incidentTab = 'details';
  renderIncidents();
}
function renderIncidents() {
  const body = document.getElementById('incident-body');
  const open = STATE.incidents.filter(i => i.status === 'open');
  // Quiet-state: when no incidents are open, drop the badge's pulse + red
  // tint so the rail doesn't shout for attention during a calm shift.
  // .quiet is an additive class — .live stays so the layout (sizing,
  // border-radius) is consistent across states.
  const incBadge = document.getElementById('incident-active-badge');
  incBadge.textContent = open.length;
  incBadge.classList.toggle('quiet', open.length === 0);
  if (!STATE.incidents.length) { body.innerHTML = '<div class="empty">No incidents. Click <b>+ New</b> to create one, or send a Crisis message with Response Required.</div>'; return; }
  if (!STATE.selectedIncidentId || !STATE.incidents.find(x => x.id === STATE.selectedIncidentId)) {
    body.innerHTML = renderIncidentFilter() + renderIncidentList(); bindIncidentListHandlers(); return;
  }
  body.innerHTML = renderIncidentFilter() + renderIncidentList() + renderIncidentDetailHTML();
  bindIncidentListHandlers(); bindIncidentDetailHandlers();
}
function renderIncidentFilter() {
  const open   = STATE.incidents.filter(i => i.status === 'open').length;
  const closed = STATE.incidents.filter(i => i.status === 'closed').length;
  const total  = STATE.incidents.length;
  const f = STATE.incidentListFilter;
  return `<div class="msg-filter" role="tablist" aria-label="Filter incidents">
    <button class="${f==='open'?'active':''}" data-i-filter="open"  role="tab" aria-selected="${f==='open'}">Open ${open}</button>
    <button class="${f==='closed'?'active':''}" data-i-filter="closed" role="tab" aria-selected="${f==='closed'}">Closed ${closed}</button>
    <button class="${f==='all'?'active':''}" data-i-filter="all" role="tab" aria-selected="${f==='all'}">All ${total}</button>
  </div>`;
}
function visibleIncidents() {
  const f = STATE.incidentListFilter;
  if (f === 'all') return STATE.incidents;
  return STATE.incidents.filter(i => i.status === f);
}
function renderIncidentList() {
  const list = visibleIncidents();
  if (!list.length) return '<div class="empty">No incidents in this filter.</div>';
  return `<div class="incident-list">${list.map(i => {
    const msgs = (i.messages||[]).length;
    // Surface drill messages on the card so an operator scanning the list
    // never mistakes a drill incident for a real one without opening it.
    // Computed from the message rows so it stays accurate as messages are
    // added or removed; no separate flag on the incident itself.
    const testCount = (i.messages||[]).filter(m => m.isTest).length;
    const allTest = testCount > 0 && testCount === msgs;
    const testBadge = testCount === 0 ? ''
      : allTest
        ? `<span class="test-badge" title="Every message in this incident was sent in test mode">🧪 Drill</span>`
        : `<span class="test-badge" title="${testCount} of ${msgs} messages were sent in test mode">🧪 incl. test</span>`;
    return `
    <div class="incident-row ${STATE.selectedIncidentId===i.id?'selected':''} ${i.status==='closed'?'closed':''}" data-id="${esc(i.id)}">
      <div class="i-title">${esc(i.title)}</div>
      <div class="i-meta">
        <span class="sev-pill ${i.severity}">${SEV_NAME[i.severity]}</span>
        <span>${relTime(i.opened)} ago</span>
        <span>${esc(i.offices.join(', '))}</span>
        ${msgs?`<span title="messages sent">📨 ${msgs}</span>`:''}
        ${testBadge}
        <span style="margin-left:auto;color:${i.status==='open'?'var(--red)':'var(--muted)'}">${i.status}</span>
      </div>
    </div>`;
  }).join('')}</div>`;
}
function renderIncidentDetail() {
  document.getElementById('incident-body').innerHTML = renderIncidentList() + renderIncidentDetailHTML();
  bindIncidentListHandlers(); bindIncidentDetailHandlers();
}
function renderIncidentDetailHTML() {
  const inc = STATE.incidents.find(x => x.id === STATE.selectedIncidentId); if (!inc) return '';
  const resp = STATE.responses[inc.id] || {};
  const rs = Object.values(resp);
  const ok = rs.filter(r=>r.status==='ok').length;
  const help = rs.filter(r=>r.status==='help').length;
  const no = rs.filter(r=>r.status==='no').length;
  const total = rs.length;
  const pct = total ? Math.round(((ok+help)/total)*100) : 0;
  return `<div class="incident-detail" style="border-top:2px solid var(--border)">
    <div class="incident-meta">
      <h3>${esc(inc.title)}</h3>
      <div class="meta-row">
        <span class="sev-pill ${inc.severity}">${SEV_NAME[inc.severity]}</span>
        <span>${esc(inc.offices.join(', '))}</span>
        <span>${new Date(inc.opened).toLocaleString()}</span>
        <span>${inc.status}</span>
      </div>
    </div>
    <div class="tabs">
      ${[
        ['details','Details'],
        ['comms','Comms', (inc.messages||[]).length],
        ['responses','Responses', total],
        ['notes','Notes', inc.notes.length],
        ['log','Log'],
      ].map(([t,label,count])=>`<div class="tab ${STATE.incidentTab===t?'active':''}" data-i-tab="${t}">${label}${count!==undefined?` <span class="count">${count}</span>`:''}</div>`).join('')}
    </div>
    <div style="flex:1; overflow-y:auto">${renderIncidentTab(inc, ok, help, no, total, pct)}</div>
  </div>`;
}
function renderIncidentTab(inc, ok, help, no, total, pct) {
  const isOpen = inc.status === 'open';
  if (STATE.incidentTab === 'details') {
    return `<div style="padding:12px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">${esc(inc.description)}</div>
      ${inc.closedNote?`<div style="font-size:11px;background:var(--bg3);border-left:3px solid var(--red);padding:6px 10px;margin-bottom:10px;border-radius:0 4px 4px 0"><b>Closure note:</b> ${esc(inc.closedNote)}<div style="color:var(--muted);font-size:10px;margin-top:2px">${inc.closedAt?new Date(inc.closedAt).toLocaleString():''}</div></div>`:''}
      ${inc.reopens?.length?`<div style="font-size:10px;color:var(--muted);margin-bottom:8px">Reopened ${inc.reopens.length}× · last ${relTime(inc.reopens[inc.reopens.length-1].when)} ago</div>`:''}
      <div class="tally">
        <div class="tally-cell ok"><div class="n">${ok}</div><div class="l">OK</div></div>
        <div class="tally-cell help"><div class="n">${help}</div><div class="l">Needs Help</div></div>
        <div class="tally-cell no"><div class="n">${no}</div><div class="l">No Response</div></div>
      </div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <div style="font-size:10px;color:var(--muted);margin-top:4px">${pct}% responded · ${total} total recipients</div>
      <div style="display:flex;gap:6px;margin-top:14px;flex-wrap:wrap">
        ${isOpen?'<button class="btn-ghost" id="btn-send-msg">📣 Send Message</button>':''}
        ${isOpen?'<button class="btn-ghost" id="btn-simulate">Simulate Replies</button>':''}
        <button class="btn-ghost" id="btn-export-inc">📄 Export Report</button>
        ${isOpen
          ? '<button class="btn-ghost danger" id="btn-close-inc">End Incident</button>'
          : '<button class="btn-ghost" id="btn-reopen-inc" style="color:var(--green);border-color:var(--green)">↻ Reopen</button>'}
      </div>
    </div>`;
  }
  if (STATE.incidentTab === 'comms') {
    const msgs = (inc.messages||[]).slice().sort((a,b) => new Date(a.when) - new Date(b.when));
    return `<div style="padding:8px 0">
      ${isOpen?`<div style="padding:8px 12px;border-bottom:1px solid var(--border)">
        <button class="btn-primary cc-send" id="btn-send-msg" style="margin:0;padding:9px;font-size:13px">📣 Send Another Message</button>
      </div>`:''}
      ${!msgs.length?'<div class="empty">No messages sent for this incident yet.</div>':''}
      ${msgs.map((m,i)=>{
        const tplName = m.templateName || allTemplates().find(t=>t.id===m.template)?.name || 'Custom';
        const sevColor = (m.template==='evac'||m.template==='shelter')?SEV_COLOR.high:m.template==='allclear'?SEV_COLOR.low:SEV_COLOR.mod;
        return `<div class="comm-card${m.isTest?' is-test':''}" style="border-left-color:${m.isTest?'#22d3ee':sevColor}">
          <div class="row-between">
            <div class="comm-step">${i+1}. ${esc(tplName)}${m.isTest?' <span class="test-badge" title="Drill — sent in test mode, routed to test channel only">🧪 Test</span>':''}</div>
            <div class="muted-xs">${new Date(m.when).toLocaleString()}</div>
          </div>
          ${m.subject?`<div style="font-size:12px;font-weight:600;margin-top:4px">${esc(m.subject)}</div>`:''}
          <div style="font-size:11px;line-height:1.4;color:var(--text);margin-top:4px;white-space:pre-wrap">${linkify(esc(m.body))}</div>
          ${m.attachments?.length?`<div class="att-list">${m.attachments.map(a => attachmentChipHTML(a, false)).join('')}</div>`:''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            ${m.channels.map(c=>`<span class="src-pill">${c.toUpperCase()}</span>`).join('')}
            <span class="src-pill">${(m.recipients ?? m.recipientsCount ?? 0).toLocaleString()} recipients</span>
            <span class="src-pill">${esc(m.offices.join(', '))}</span>
            ${m.responseRequired?'<span class="src-pill" style="color:var(--green);border-color:var(--green)">tracked</span>':''}
            ${m.attachments?.length?`<span class="src-pill">📎 ${m.attachments.length}</span>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }
  if (STATE.incidentTab === 'responses') {
    const resp = STATE.responses[inc.id] || {};
    const empRows = []; const travRows = []; const remoteRows = [];
    Object.entries(resp).forEach(([eid, r]) => {
      if (r.traveler) {
        const t = TRAVELERS.find(x => 'T-'+x.id === eid);
        if (t) travRows.push({ eid, name: t.name, who: `${OFFICE_BY_ID[t.home]?.name||t.home} · ${t.destCity}`, status: r.status });
      } else if (r.remote) {
        const re = REMOTE_EMPLOYEES.find(x => 'R-'+x.id === eid);
        if (re) remoteRows.push({ eid, name: re.name, who: `${re.city} · ${re.country} (remote)`, status: r.status });
      } else {
        const e = EMPLOYEES.find(x => x.id === eid);
        if (e) empRows.push({ eid, name: e.name, who: e.role, status: r.status });
      }
    });
    const filt = STATE.msgFilter;
    const f = (rows) => filt==='all' ? rows : rows.filter(r => (filt==='no'?r.status==='no': r.status===filt));
    const allRows = [...empRows, ...travRows, ...remoteRows];
    return `<div class="msg-filter">
      ${['all','no','ok','help'].map(k=>{
        const n = k==='all' ? allRows.length : allRows.filter(r => k==='no'?r.status==='no':r.status===k).length;
        return `<button class="${filt===k?'active':''}" data-mfilter="${k}">${k==='no'?'No response':k.toUpperCase()} ${n}</button>`;
      }).join('')}
    </div>
    <div class="section-h">Employees (${empRows.length})</div>
    ${f(empRows).map(r => msgRowHTML(r,inc)).join('') || '<div class="empty">None</div>'}
    ${travRows.length ? `<div class="section-h">✈ Travelers (${travRows.length})</div>${f(travRows).map(r=>msgRowHTML(r,inc)).join('')}` : ''}
    ${remoteRows.length ? `<div class="section-h">🏠 Remote Employees (${remoteRows.length})</div>${f(remoteRows).map(r=>msgRowHTML(r,inc)).join('')}` : ''}`;
  }
  if (STATE.incidentTab === 'notes') {
    return `<div style="padding:8px 12px;border-bottom:1px solid var(--border)">
      <textarea id="note-input" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:6px 8px;font-size:12px;min-height:48px;resize:vertical" placeholder="Add a note... (paste URLs to make them clickable)"></textarea>
      <div class="att-zone" id="att-zone-note" style="margin-top:6px">
        Drop files here or
        <button type="button" class="att-pick-btn" id="att-pick-note">Choose files</button>
        <input type="file" id="att-input-note" multiple style="display:none"/>
      </div>
      ${STATE.noteAttachments.length ? `<div class="att-list">${STATE.noteAttachments.map(a => attachmentChipHTML(a, true)).join('')}</div>` : ''}
      <div style="display:flex;justify-content:flex-end;margin-top:6px">
        <button class="btn-ghost" id="note-add">Add Note</button>
      </div>
    </div>
    ${inc.notes.length ? inc.notes.slice().reverse().map(n=>`<div class="note-entry">
      <div class="meta">${new Date(n.when).toLocaleString()} · ${esc(n.by)}</div>
      <div style="white-space:pre-wrap">${linkify(esc(n.body))}</div>
      ${n.attachments?.length?`<div class="att-list">${n.attachments.map(a => attachmentChipHTML(a, false)).join('')}</div>`:''}
    </div>`).join('') : '<div class="empty">No notes yet.</div>'}`;
  }
  if (STATE.incidentTab === 'log') {
    return `${inc.log.length ? inc.log.slice().reverse().map(l=>`<div class="log-entry-i kind-${l.kind}"><span class="when">${new Date(l.when).toLocaleString()} · ${l.by}</span><div>${l.body}</div></div>`).join('') : '<div class="empty">No activity logged.</div>'}`;
  }
}
function msgRowHTML(r, inc) {
  return `<div class="msg-row">
    <div><div class="name">${esc(r.name)}</div><div class="who">${esc(r.who)}</div></div>
    <button class="act ok" data-eid="${esc(r.eid)}" data-st="ok">✓ OK</button>
    <button class="act help" data-eid="${esc(r.eid)}" data-st="help">⚠ Help</button>
    <span class="status-pill ${r.status==='no'?'no':r.status}" style="grid-column:1/-1">${r.status==='no'?'no response':r.status==='ok'?'ok':'needs help'}</span>
  </div>`;
}
function bindIncidentListHandlers() {
  document.querySelectorAll('.incident-row').forEach(el => el.addEventListener('click', () => selectIncident(el.dataset.id)));
  document.querySelectorAll('[data-i-filter]').forEach(el => el.addEventListener('click', () => {
    STATE.incidentListFilter = el.dataset.iFilter; renderIncidents();
  }));
}
function bindIncidentDetailHandlers() {
  document.querySelectorAll('[data-i-tab]').forEach(el => el.addEventListener('click', () => setIncidentTab(el.dataset.iTab)));
  document.querySelectorAll('[data-mfilter]').forEach(el => el.addEventListener('click', () => { STATE.msgFilter = el.dataset.mfilter; renderIncidentDetail(); }));
  document.querySelectorAll('[data-eid]').forEach(b => b.addEventListener('click', () => {
    const inc = STATE.incidents.find(x => x.id === STATE.selectedIncidentId); if (!inc) return;
    const eid = b.dataset.eid; const st = b.dataset.st;
    STATE.responses[inc.id][eid] = { ...STATE.responses[inc.id][eid], status: st, when: new Date().toISOString(), by: 'Admin' };
    addIncidentLog(inc.id, 'msg', `Status logged for <b>${esc(eid)}</b>: ${esc(st)}`);
    renderIncidentDetail();
    // Live mode: persist response to backend. Strip the "T-" traveler prefix
    // from the storage key when sending — backend stores plain employee_id
    // with a separate is_traveler bool.
    if (API_BASE && !inc._persistPending) {
      const isTraveler = eid.startsWith('T-');
      const subjectId  = isTraveler ? eid.slice(2) : eid;
      // Pull employee/traveler context for nicer audit trail server-side
      const emp        = isTraveler ? null : EMPLOYEES.find(e => e.id === subjectId);
      const trav       = isTraveler ? TRAVELERS.find(t => t.id === subjectId) : null;
      const subject    = emp || trav;
      incidentsApi.updateResponse(inc.id, subjectId, {
        status:       st,
        employeeName: subject?.name,
        officeId:     emp?.office ?? trav?.atOffice ?? null,
        isTraveler,
      }).catch(err => {
        console.warn('response update persist failed:', err);
        // Don't revert — stale-on-server is less disruptive than blinking UI.
      });
    }
  }));
  // Note attachments zone
  wireAttZone({
    zoneId: 'att-zone-note',
    inputId: 'att-input-note',
    pickId: 'att-pick-note',
    getList: () => STATE.noteAttachments,
    setList: (list) => { STATE.noteAttachments = list; },
    onChange: () => renderIncidentDetail(),
  });
  document.querySelectorAll('.note-entry [data-att-remove]').forEach(b => {
    // shouldn't be removable in saved notes; no-op
  });
  document.querySelectorAll('#att-zone-note ~ .att-list [data-att-remove]').forEach(b => b.onclick = () => {
    STATE.noteAttachments = STATE.noteAttachments.filter(a => a.id !== b.dataset.attRemove);
    renderIncidentDetail();
  });
  document.getElementById('note-add')?.addEventListener('click', () => {
    const inc = STATE.incidents.find(x => x.id === STATE.selectedIncidentId); if (!inc) return;
    const inp = document.getElementById('note-input');
    if (!inp.value.trim() && !STATE.noteAttachments.length) return;
    const noteBody = inp.value;
    const noteAtts = STATE.noteAttachments.slice();
    const noteObj = {
      id: null,           // server-assigned on success; stays null if persist fails
      when: new Date().toISOString(), by:'cowork-3p',
      body: noteBody,
      attachments: noteAtts,
    };
    inc.notes.push(noteObj);
    const attCount = noteAtts.length;
    addIncidentLog(inc.id, 'note', `Note added: ${esc(noteBody.slice(0,80))}${noteBody.length>80?'…':''}${attCount?` <span class="src-pill">📎 ${attCount}</span>`:''}`);
    inp.value = '';
    STATE.noteAttachments = [];
    renderIncidentDetail();
    // Live mode: persist note. Don't revert local on failure — note is too
    // valuable to vanish if the network blips. Toast the warning instead.
    if (API_BASE && !inc._persistPending) {
      incidentsApi.addNote(inc.id, { body: noteBody, attachments: noteAtts })
        .then(noteId => { if (noteId) noteObj.id = noteId; })
        .catch(err => {
          console.warn('note add persist failed:', err);
          toast('⚠ Note saved locally — backend persist failed.');
        });
    }
  });
  document.getElementById('btn-simulate')?.addEventListener('click', () => {
    const inc = STATE.incidents.find(x => x.id === STATE.selectedIncidentId); if (!inc) return;
    let n=0;
    Object.entries(STATE.responses[inc.id]).forEach(([k,r]) => {
      if (r.status==='no' && Math.random() < 0.55) {
        STATE.responses[inc.id][k] = { ...r, status: Math.random()<.92?'ok':'help', when:new Date().toISOString(), by:'auto' };
        n++;
      }
    });
    addIncidentLog(inc.id, 'msg', `${n} replies received via Slack/Email.`);
    toast(`${n} replies received.`);
    renderIncidentDetail();
  });
  document.getElementById('btn-send-msg')?.addEventListener('click', () => {
    const inc = STATE.incidents.find(x => x.id === STATE.selectedIncidentId); if (!inc) return;
    STATE.linkedIncidentId = inc.id;
    STATE.selectedOffices = inc.offices.slice();
    openPanel('crisis');
    setCcTab('compose');
    renderCC();
    toast(`Linked to "${inc.title}". Compose your next message.`);
  });
  document.getElementById('btn-reopen-inc')?.addEventListener('click', () => reopenIncident(STATE.selectedIncidentId));
  document.getElementById('btn-export-inc')?.addEventListener('click', () => exportIncidentReport(STATE.selectedIncidentId));
  document.getElementById('btn-close-inc')?.addEventListener('click', () => {
    const inc = STATE.incidents.find(x => x.id === STATE.selectedIncidentId); if (!inc) return;
    showModal(`<h3>Close Incident</h3>
      <p style="font-size:12px;color:var(--muted)">Add a closure note for the permanent record.</p>
      <textarea id="close-note" style="width:100%;min-height:80px;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:7px;font-size:12px;margin-top:6px"
        placeholder="e.g. All-clear confirmed by building security at 14:30. No injuries."></textarea>
      <div class="modal-actions"><button class="btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn-primary" style="width:auto;margin:0;padding:7px 14px" id="modal-confirm">Confirm</button></div>`);
    document.getElementById('modal-cancel').onclick = closeModal;
    document.getElementById('modal-confirm').onclick = () => {
      inc.status='closed';
      inc.closedNote = document.getElementById('close-note').value || 'No closure note.';
      inc.closedAt = new Date().toISOString();
      addIncidentLog(inc.id, 'close', `Incident closed. ${esc(inc.closedNote)}`);
      closeModal();
      toast('Incident closed and sealed.');
      renderIncidents();
      // Live mode: persist to backend (fire-and-forget). Local close already
      // applied; if API fails, re-open the incident locally so UI matches DB.
      if (API_BASE && !inc._persistPending) {
        const noteForRevert = inc.closedNote;
        incidentsApi.close(inc.id, inc.closedNote).catch(err => {
          console.warn('incident close persist failed:', err);
          inc.status = 'open';
          inc.closedAt = null;
          inc.closedNote = null;     // also clear closure note — UI keys "closed view" off it
          toast(`⚠ Close failed on backend — reverted locally. (Note "${(noteForRevert||'').slice(0,40)}" not persisted.)`);
          renderIncidents();
        });
      }
    };
  });
}

/* ---------- 13. Layers panel + filters ---------- */
function buildLayerControls() {
  document.getElementById('office-toggle-list').innerHTML = OFFICES.map(o => `
    <div class="toggle-row"><label><span style="color:var(--muted);font-size:11px">${o.id}</span> ${o.name}</label>
      <input type="checkbox" data-vis-office="${o.id}" checked /></div>`).join('');
  document.getElementById('alert-type-list').innerHTML = ALERT_TYPES.map(t => `
    <div class="toggle-row"><label>${t}</label><input type="checkbox" data-vis-type="${t}" checked/></div>`).join('');
  document.querySelectorAll('[data-vis-office]').forEach(c => c.addEventListener('change', e => {
    const id = e.target.dataset.visOffice;
    STATE.visibleOffices = e.target.checked
      ? [...new Set([...STATE.visibleOffices, id])]
      : STATE.visibleOffices.filter(x => x !== id);
    renderAll();
  }));
  document.querySelectorAll('[data-vis-type]').forEach(c => c.addEventListener('change', e => {
    const t = e.target.dataset.visType;
    STATE.visibleAlertTypes = e.target.checked
      ? [...new Set([...STATE.visibleAlertTypes, t])]
      : STATE.visibleAlertTypes.filter(x => x !== t);
    renderAll();
  }));
  document.querySelectorAll('[data-overlay]').forEach(c => c.addEventListener('change', e => {
    const key = e.target.dataset.overlay;
    STATE.hazards[key] = e.target.checked;
    renderHazards();
    if (e.target.checked) {
      const def = HAZARD_ZONES[key] || TILE_OVERLAYS[key];
      if (def) {
        const detail = def.zones ? `${def.zones.length} zone${def.zones.length===1?'':'s'}` : 'live data';
        toast(`${def.label} enabled · ${detail}.`);
      }
    } else {
      const def = HAZARD_ZONES[key] || TILE_OVERLAYS[key];
      if (def) toast(`${def.label} disabled.`);
    }
  }));
  document.querySelectorAll('.sev-seg').forEach(s => s.addEventListener('click', () => {
    document.querySelectorAll('.sev-seg').forEach(x => x.classList.remove('active'));
    s.classList.add('active');
    STATE.filterMinSev = s.dataset.sev;
    renderAll();
  }));
  document.getElementById('toggle-employees').addEventListener('change', e => { STATE.showEmployees = e.target.checked; renderEmployees(); });
  document.getElementById('toggle-travelers').addEventListener('change', e => { STATE.showTravelers = e.target.checked; renderTravelers(); });
  document.querySelectorAll('input[name="emp-mode"]').forEach(r => r.addEventListener('change', e => { STATE.empMode = e.target.value; renderEmployees(); }));
  document.getElementById('btn-load-emp').addEventListener('click', () => document.getElementById('emp-file').click());
  document.getElementById('btn-clear-emp').addEventListener('click', () => { EMPLOYEES = []; renderEmployees(); toast('Employees cleared.'); });
  document.getElementById('emp-file').addEventListener('change', e => loadEmpCSV(e.target.files[0]));
  document.getElementById('btn-load-trav').addEventListener('click', () => document.getElementById('trav-file').click());
  document.getElementById('btn-clear-trav').addEventListener('click', () => { TRAVELERS = []; renderTravelers(); renderOffices(); toast('Travelers cleared.'); });
  document.getElementById('trav-file').addEventListener('change', e => loadTravCSV(e.target.files[0]));
}
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
      const safe = (i) => i >= 0 ? c[i] : '';
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
function openPanel(p) {
  STATE.panels[p] = true;
  document.getElementById('panel-'+p).classList.remove('collapsed');
  document.getElementById('rail-'+p)?.setAttribute('aria-expanded', 'true');
}
function closePanel(p) {
  STATE.panels[p] = false;
  document.getElementById('panel-'+p).classList.add('collapsed');
  document.getElementById('rail-'+p)?.setAttribute('aria-expanded', 'false');
}
function togglePanel(p) { STATE.panels[p] ? closePanel(p) : openPanel(p); }
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
function positionToolsDropdown() {
  const dd = document.getElementById('tools-dropdown');
  const btn = document.getElementById('btn-tools');
  if (!dd || !btn) return;
  const r = btn.getBoundingClientRect();
  // Right-anchor to the button's right edge — same visual alignment as the
  // CSS default, but recomputed live so window resizes / panel toggles
  // don't push the dropdown off-position.
  dd.style.top   = (r.bottom + 6) + 'px';
  dd.style.right = (Math.max(8, window.innerWidth - r.right)) + 'px';
  dd.style.left  = '';
  // When the map's effective width is too narrow for a 360px dropdown to
  // sit clear of marker clusters, slim the dropdown so it overlays less
  // of the map and the operator can still see what they're targeting.
  const map = document.getElementById('map');
  const mapWidth = map ? map.getBoundingClientRect().width : window.innerWidth;
  if (mapWidth < 720) {
    dd.style.width = Math.max(280, Math.min(320, mapWidth - 40)) + 'px';
  } else {
    dd.style.width = '';   // fall back to the 360px CSS default
  }
}

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

function applyTheme(theme) {
  STATE.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('btn-style').textContent = theme === 'dark' ? '🌙' : '☀️';
  TILES.dark.remove(); TILES.light.remove();
  TILES[theme].addTo(map);
  try { localStorage.setItem('nrsa-theme', theme); } catch(_) {}
}
document.getElementById('btn-style').onclick = () => applyTheme(STATE.theme === 'dark' ? 'light' : 'dark');
// restore saved theme on boot
try {
  const saved = localStorage.getItem('nrsa-theme');
  if (saved === 'light' || saved === 'dark') applyTheme(saved);
} catch(_) {}

function showFreshness() {
  showModal(`<h3>Data Sources Freshness</h3>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">${SOURCES.filter(s=>s.status==='ok').length}/${SOURCES.length} sources healthy. 15-min refresh cycle, 24-hour TTL.</p>
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr><th align="left">Source</th><th align="left">Type</th><th>Status</th></tr></thead>
      <tbody>${SOURCES.map(s=>`<tr style="border-top:1px solid var(--border)"><td><b>${esc(s.id)}</b><div style="font-size:10px;color:var(--muted)">${esc(s.name)}</div></td><td>${esc(s.type)}</td><td align="center">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.status==='ok'?'var(--green)':s.status==='stale'?'var(--yellow)':'var(--red)'}"></span>
        <span style="font-size:10px;margin-left:4px">${s.status}</span>
      </td></tr>`).join('')}</tbody>
    </table>
    <div class="modal-actions"><button class="btn-ghost" onclick="App.closeModal()">Close</button></div>`);
}

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
function showModal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back'; back.id='modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener('click', e => { if (e.target===back) closeModal(); });
  document.body.appendChild(back);
  // focus the first focusable element for keyboard users
  setTimeout(() => {
    const focusable = back.querySelector('input, textarea, button, select');
    focusable?.focus();
  }, 0);
}
function closeModal() { document.getElementById('modal-back')?.remove(); }
function toast(msg) {
  const wrap = document.getElementById('toast-wrap');
  const t = document.createElement('div'); t.className='toast'; t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(()=>t.classList.add('fade'), 2400);
  setTimeout(()=>t.remove(), 3000);
}

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
/* showAlertDetails() moved to persistence.js — bridged via main.js. */

/* ---------- 17c. Incident Report — opens in a new tab ---------- */
/* exportIncidentReport() moved to persistence.js — bridged via main.js. */

/* ---------- 17d. Persistence (localStorage) ---------- */
/* PERSIST_KEY moved to constants.js (already exported there) — bridged via main.js. */
/* PERSIST_DEBOUNCE_MS moved to constants.js (already exported there) — bridged via main.js. */
/* _saveTimer() moved to persistence.js — bridged via main.js. */
/* lastSavedAt moved to state.js. */

/** Strip the (potentially huge) data: URL from an attachment, keep metadata. */
/* stripAtt() moved to helpers.js — bridged via main.js. */
/* stripMessageAtts() moved to helpers.js — bridged via main.js. */
/* stripIncident() moved to helpers.js — bridged via main.js. */
/* buildPersistPayload() moved to persistence.js — bridged via main.js. */
/* saveState() moved to persistence.js — bridged via main.js. */
/* loadState() moved to persistence.js — bridged via main.js. */
/* exportData() moved to persistence.js — bridged via main.js. */
/* resetData() moved to persistence.js — bridged via main.js. */

/* ---------- 17e. Status Strip ---------- */
/* lastRefreshAt moved to state.js. The "Last fetch" chip uses it to age out
   the backend connection — null until the first success, then ISO timestamp. */

function renderStatusStrip() {
  const el = document.getElementById('status-strip');
  if (!el) return;

  // 1. Compute the at-a-glance state.
  const openIncidents = STATE.incidents.filter(i => i.status === 'open');
  const visAlerts = visibleAlerts();
  const sevByRank = visAlerts.slice().sort((a,b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
  const highest = sevByRank[0] || null;
  const helpCount = openIncidents.reduce((sum, inc) => {
    const r = STATE.responses[inc.id] || {};
    return sum + Object.values(r).filter(x => x.status === 'help').length;
  }, 0);
  const okSources    = SOURCES.filter(s => s.status === 'ok').length;
  const staleSources = SOURCES.filter(s => s.status === 'stale').length;
  const errSources   = SOURCES.filter(s => s.status === 'error').length;
  const sourcesState = errSources ? 'crit' : staleSources ? 'warn' : 'ok';

  // 2. Severity-based whole-strip styling.
  const isCritical = highest && highest.sev === 'ext';
  el.classList.toggle('crit', !!isCritical);

  // 3. Build chips.
  const role = ROLE_TAG_STYLE[OPERATOR.role] || ROLE_TAG_STYLE.employee;
  const incClass = openIncidents.some(i => i.severity === 'ext') ? 'crit'
                 : openIncidents.some(i => i.severity === 'high') ? 'high'
                 : openIncidents.length ? 'warn' : 'ok';
  const helpClass = helpCount === 0 ? '' : helpCount > 3 ? 'crit' : 'warn';
  const sevWord  = highest ? SEV_NAME[highest.sev] : 'All clear';
  const sevClass = !highest ? 'ok' : highest.sev === 'ext' ? 'crit' : highest.sev === 'high' ? 'high' : highest.sev === 'mod' ? 'warn' : 'ok';

  el.innerHTML = `
    <div class="ss-chip identity" title="Logged-in operator (will come from Okta when integrated)">
      <span class="ss-icon" aria-hidden="true">👤</span>
      <div>
        <div class="ss-label">Logged in as</div>
        <div><span class="ss-value">${esc(OPERATOR.name)}</span><span class="ss-role-tag" style="background:${role.bg};color:${role.fg}">${esc(role.label)}</span></div>
      </div>
    </div>
    <button class="ss-chip clickable ${incClass}" data-ss-action="incidents" title="Open incidents — click to view">
      <span class="ss-icon" aria-hidden="true">${openIncidents.length ? '🚨' : '✓'}</span>
      <div style="text-align:left">
        <div class="ss-label">Open Incidents</div>
        <div class="ss-value">${openIncidents.length}</div>
      </div>
    </button>
    <button class="ss-chip clickable ${sevClass}" data-ss-action="highest" ${highest?'':'disabled'} title="${highest ? 'Click to zoom to this alert' : 'No active alerts'}">
      <span class="ss-icon" aria-hidden="true">${!highest ? '🛡' : highest.sev==='ext' ? '⚠' : highest.sev==='high' ? '⚠' : '⚠'}</span>
      <div style="text-align:left">
        <div class="ss-label">Highest Active</div>
        <div class="ss-value">${esc(sevWord)}${highest ? `<span class="ss-sub">· ${esc(highest.title)}</span>` : ''}</div>
      </div>
    </button>
    <button class="ss-chip clickable ${helpClass}" data-ss-action="help" title="Employees marked Need Help">
      <span class="ss-icon" aria-hidden="true">${helpCount ? '🆘' : '🤝'}</span>
      <div style="text-align:left">
        <div class="ss-label">Need Help</div>
        <div class="ss-value">${helpCount}</div>
      </div>
    </button>
    <button class="ss-chip clickable ${sourcesState}" data-ss-action="sources" title="Data sources health — click for detail">
      <span class="ss-icon" aria-hidden="true">📡</span>
      <div style="text-align:left">
        <div class="ss-label">Sources</div>
        <div class="ss-value">${okSources}/${SOURCES.length}</div>
      </div>
    </button>
    ${(function lastFetchChip() {
      // Live-mode-only — bare Pages and #api=mock don't have a backend to
      // age out, and an empty chip would be more confusing than absent.
      if (!API_BASE) return '';
      if (!lastRefreshAt) {
        // First fetch hasn't completed yet (page just loaded, or login pending).
        return `
          <div class="ss-chip warn" title="No successful event fetch yet. If this persists, the backend may be unreachable — check the server is running and the JWT is valid.">
            <span class="ss-icon" aria-hidden="true">⏳</span>
            <div style="text-align:left">
              <div class="ss-label">Last fetch</div>
              <div class="ss-value">—</div>
            </div>
          </div>`;
      }
      const ageSec = Math.max(0, Math.floor((Date.now() - lastRefreshAt.getTime()) / 1000));
      const ageMin = Math.floor(ageSec / 60);
      // Threshold rationale: backend polls fastest (USGS) at 60s. Up to ~2min
      // is normal, 2-5min is worth flagging, >5min strongly suggests backend
      // is down or SSE has dropped without auto-recovery.
      const klass = ageMin >= 5 ? 'crit' : ageMin >= 2 ? 'warn' : 'ok';
      const label = ageSec < 60 ? `${ageSec}s ago`
                  : ageMin < 60 ? `${ageMin}m ago`
                  : `${Math.floor(ageMin/60)}h ago`;
      const tip = klass === 'crit'
        ? `Last successful fetch was ${label}. Backend may be down — check 'npm run dev' is running and try a hard refresh.`
        : klass === 'warn'
          ? `Last successful fetch was ${label}. Slightly older than expected — watch for further drift.`
          : `Live data is current. Last successful fetch ${label}.`;
      return `
        <div class="ss-chip ${klass}" title="${esc(tip)}">
          <span class="ss-icon" aria-hidden="true">${klass === 'crit' ? '⚠' : klass === 'warn' ? '⏱' : '✓'}</span>
          <div style="text-align:left">
            <div class="ss-label">Last fetch</div>
            <div class="ss-value">${label}</div>
          </div>
        </div>`;
    })()}
    <div class="ss-chip ss-spacer"></div>
    <button class="ss-chip clickable" data-ss-action="toggle-relevance" title="${STATE.officeRelevantOnly ? 'Showing only events affecting an office or traveler. Click to show all global events.' : 'Showing all global events. Click to limit to office/traveler-relevant.'}">
      <span class="ss-icon" aria-hidden="true">${STATE.officeRelevantOnly ? '🎯' : '🌐'}</span>
      <div style="text-align:left">
        <div class="ss-label">View</div>
        <div class="ss-value" style="font-size:0.78rem">${STATE.officeRelevantOnly ? `Office-relevant (${visAlerts.length}/${ALERTS.length})` : `All global (${ALERTS.length})`}</div>
      </div>
    </button>
    <div class="ss-chip timestamp" title="Last save · last data refresh">
      <span class="ss-saved-dot" aria-hidden="true" style="${lastSavedAt ? '' : 'background:var(--muted);box-shadow:none'}"></span>
      <span>${lastSavedAt ? `💾 saved ${relTime(lastSavedAt.toISOString())} ago` : 'No saves yet'}</span>
    </div>
  `;

  // 4. Wire chip clicks.
  el.querySelectorAll('[data-ss-action]').forEach(b => b.addEventListener('click', () => {
    const action = b.dataset.ssAction;
    if (action === 'incidents') {
      STATE.incidentListFilter = 'open';
      openPanel('incident');
      renderIncidents();
    } else if (action === 'highest' && highest) {
      selectAlert(highest.id);
      // Also open the office popup if there is one
      if (highest.officeId && OFFICE_MARKERS[highest.officeId]) {
        map.once('moveend', () => OFFICE_MARKERS[highest.officeId].openPopup());
      }
    } else if (action === 'help') {
      // Find the incident with the most help responses, open it in Responses tab.
      let target = null, max = -1;
      STATE.incidents.filter(i => i.status === 'open').forEach(inc => {
        const cnt = Object.values(STATE.responses[inc.id]||{}).filter(r => r.status === 'help').length;
        if (cnt > max) { max = cnt; target = inc; }
      });
      if (target) {
        STATE.msgFilter = 'help';
        STATE.incidentTab = 'responses';
        openPanel('incident');
        selectIncident(target.id);
      } else {
        toast('No employees flagged Need Help.');
      }
    } else if (action === 'sources') {
      document.getElementById('btn-help')?.blur();
      // Trigger the existing freshness modal directly
      App.showFreshness?.();
    } else if (action === 'toggle-relevance') {
      STATE.officeRelevantOnly = !STATE.officeRelevantOnly;
      toast(STATE.officeRelevantOnly
        ? '🎯 Showing office-relevant only.'
        : '🌐 Showing all global events.');
      renderAll();
    }
  }));
}

/* ---------- 18. Master render ---------- */
function renderAll() {
  renderOffices(); renderAlertDots(); renderEmployees(); renderTravelers(); renderHazards();
  renderFeed(); renderCC(); renderIncidents();
  renderStatusStrip();
  saveState();   // debounced
}

/* Tick the status strip once a minute so the "Last fetch" chip ages without
   needing another event to trigger a re-render. Cheap (renderStatusStrip is
   <1ms), and only does meaningful work in live mode where the chip exists.
   The 60s cadence is intentional — finer would over-render; coarser would
   leave operators staring at a stale label during a real backend outage. */
let _statusStripTicker = null;
function startStatusStripTicker() {
  if (_statusStripTicker) return;
  _statusStripTicker = setInterval(() => {
    if (document.getElementById('status-strip')) renderStatusStrip();
  }, 60000);
}
// Kick off on next tick so DOM has been built.
setTimeout(startStatusStripTicker, 0);

/* ---------- 18b. Panel resize ---------- */
const PANEL_MIN_W = 280;
const PANEL_MAX_W = 600;
function applyPanelWidths() {
  ['alerts','crisis','incident'].forEach(p => {
    const el = document.getElementById('panel-'+p);
    if (el) el.style.width = (STATE.panelWidths?.[p] || 340) + 'px';
  });
}
function setupPanelResize() {
  document.querySelectorAll('[data-resize-panel]').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const panelId = handle.dataset.resizePanel;
      const panel = document.getElementById('panel-' + panelId);
      if (!panel) return;
      const startX = e.clientX;
      const startW = panel.offsetWidth;
      const isLeftZone = panel.closest('.left-zone') !== null;
      handle.classList.add('dragging');
      document.body.classList.add('resizing-panel');

      function onMove(ev) {
        const dx = ev.clientX - startX;
        // Left-zone handle on right edge: drag right grows. Right-zone handle on left edge: drag left grows.
        const newW = isLeftZone ? startW + dx : startW - dx;
        const clamped = Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, newW));
        panel.style.width = clamped + 'px';
        if (typeof map !== 'undefined' && map) map.invalidateSize();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-panel');
        STATE.panelWidths[panelId] = parseInt(panel.style.width, 10) || PANEL_MIN_W;
        saveState();
        if (typeof map !== 'undefined' && map) map.invalidateSize();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // Double-click handle resets to default
    handle.addEventListener('dblclick', () => {
      const panelId = handle.dataset.resizePanel;
      const defaults = { alerts: 340, crisis: 360, incident: 360 };
      STATE.panelWidths[panelId] = defaults[panelId];
      applyPanelWidths();
      if (typeof map !== 'undefined' && map) map.invalidateSize();
      saveState();
      toast('Panel reset to default width.');
    });
  });
}

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

/* TOKEN_KEY moved to constants.js (already exported there) — bridged via main.js. */

/* getStoredToken() moved to api.js — bridged via main.js. */
/* storeToken() moved to api.js — bridged via main.js. */
/* clearStoredToken() moved to api.js — bridged via main.js. */

/* apiFetch() moved to api.js — bridged via main.js. */

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
/* mapIncidentRowToState() moved to api.js — bridged via main.js. */
/* mapNoteRow() moved to api.js — bridged via main.js. */
/* mapLogRow() moved to api.js — bridged via main.js. */
/* mapMessageRow() moved to api.js — bridged via main.js. */

/* incidentsApi() moved to api.js — bridged via main.js. */

/* commsApi() moved to api.js — bridged via main.js. */

/* showLoginModal() moved to api.js — bridged via main.js. */

// Map backend granular type ('earthquake', 'tornado_warning', etc.) to one of the
// 4 frontend categories the filter UI knows about. Used as a fallback only —
// the authoritative path is the API's `category` field (see mapBackendCategory).
/* BACKEND_TYPE_TO_CATEGORY moved to constants.js (already exported there) — bridged via main.js. */

// Authoritative: backend writes `category` at ingest per-adapter. This 1:1 map
// translates the backend's coarse-category enum to the frontend's display
// names. Health entries don't currently have a frontend filter — they live
// in the WHO outbreaks panel rather than the alert feed.
/* BACKEND_CATEGORY_TO_LABEL moved to constants.js (already exported there) — bridged via main.js. */

// Source-ID fallback when neither `category` nor `type` resolves cleanly.
// Avoids the old failure mode where SF/ATL police events fell through to
// 'Natural Disaster'.
/* SOURCE_ID_TO_CATEGORY moved to constants.js (already exported there) — bridged via main.js. */

/** Resolve an event's display category, preferring authoritative sources in
 *  this order: API category → granular type map → source-ID fallback →
 *  conservative default. The old code defaulted unmapped types to
 *  'Natural Disaster' which silently mislabeled SFPD/APD/TfL events. */
/* mapBackendCategory() moved to api.js — bridged via main.js. */

// Legacy entry point kept so existing call sites don't break. New code should
// pass the full event object and call mapBackendCategory(evt).
/* mapBackendType() moved to api.js — bridged via main.js. */

// Detect EONET prescribed-fire entries (controlled government burns, not threats)
/* isPrescribedFire() moved to api.js — bridged via main.js. */

/* backfillAlerts() moved to api.js — bridged via main.js. */

/* _sseConnection() moved to api.js — bridged via main.js. */
/* subscribeLiveStream() moved to api.js — bridged via main.js. */

/* backfillWhoOutbreaks() moved to api.js — bridged via main.js. */

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
/* isLocalIncidentId() moved to api.js — bridged via main.js. */

/* migrateLocalIncidents() moved to api.js — bridged via main.js. */

/* backfillIncidents() moved to api.js — bridged via main.js. */

/* bootLiveMode() moved to api.js — bridged via main.js. */

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
/* TRAV_VIEW moved to state.js. */

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

function showTravelersList() {
  showModal(travListBodyHTML());
  bindTravListHandlers();
}

function travListBodyHTML() {
  const filt = (t, label) => `<button data-trav-filter="${t}" class="trav-filt" style="padding:6px 12px;background:${t===TRAV_VIEW.typeFilter?'var(--green)':'var(--bg3)'};color:${t===TRAV_VIEW.typeFilter?'#062c1f':'var(--text)'};border:0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;cursor:pointer;font-weight:${t===TRAV_VIEW.typeFilter?'700':'400'};">${label}</button>`;
  // In live + bare Pages mode TRAVELERS is empty (no Navan integration yet).
  // Show a placeholder header subtitle and hide the search/filter/CSV toolbar
  // since there's nothing to search, filter, or export.
  const isMock   = TRAVELERS.length > 0;
  const subtitle = isMock
    ? 'Mock data — Navan integration pending. Displayed values are illustrative.'
    : 'Pending Navan integration. Traveler itineraries will populate once Navan is connected.';
  const headerLabel = isMock ? `✈ Travelers (${TRAVELERS.length})` : '✈ Travelers';
  return `<div style="width:min(960px,92vw);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:16px;font-weight:700;">${headerLabel}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${subtitle}</div>
      </div>
      <button class="btn-ghost" onclick="App.closeModal()" aria-label="Close">✕</button>
    </div>
    ${isMock ? `<div style="display:flex;gap:10px;padding:10px 18px;border-bottom:1px solid var(--border);align-items:center;flex-wrap:wrap;">
      <input id="trav-search" type="text" placeholder="Search name, city, country, hotel, airline..." value="${esc(TRAV_VIEW.search)}"
        style="flex:1;min-width:220px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);" />
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:4px;overflow:hidden;">
        ${filt('all','All')}${filt('flight','✈ Flight')}${filt('hotel','🏨 Hotel')}${filt('office','🏢 Office')}
      </div>
      <button class="btn-ghost" id="trav-export-csv">⬇ CSV</button>
    </div>` : ''}
    <div id="trav-list-body" style="flex:1;overflow-y:auto;"></div>
  </div>`;
}

function travSortValue(t, key) {
  switch (key) {
    case 'name': return t.name.toLowerCase();
    case 'home': return t.home;
    case 'country': return (t.country||'').toLowerCase();
    case 'type': return t.type;
    case 'details': return (t.flight?.number || t.hotel?.name || t.office?.id || '').toLowerCase();
    case 'lastKnown': return t.lastKnownTs || '';
    default: return '';
  }
}

function travListRowsHTML() {
  // Distinguish "no data at all" (Navan not integrated yet — live + bare Pages)
  // from "user filtered the list to nothing" (mock mode with no matches).
  if (TRAVELERS.length === 0) {
    return `<div style="padding:60px 40px;text-align:center;color:var(--muted);">
      <div style="font-size:36px;margin-bottom:12px;opacity:0.5;">✈</div>
      <div style="font-size:14px;margin-bottom:6px;color:var(--text);">Traveler data unavailable</div>
      <div style="font-size:12px;line-height:1.5;max-width:420px;margin:0 auto;">Awaiting Navan connection. Traveler itineraries (flights, hotels, office visits) will populate here once Navan is connected to the dashboard.</div>
    </div>`;
  }
  const { sortKey, sortDir, search, typeFilter } = TRAV_VIEW;
  let rows = TRAVELERS.slice();
  if (typeFilter !== 'all') rows = rows.filter(t => t.type === typeFilter);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(t =>
      (t.name+' '+t.destCity+' '+t.country+' '+(t.hotel?.name||'')+' '+(t.flight?.airline||'')+' '+(t.flight?.number||''))
        .toLowerCase().includes(s)
    );
  }
  rows.sort((a, b) => {
    const av = travSortValue(a, sortKey), bv = travSortValue(b, sortKey);
    if (av === bv) return 0;
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  if (!rows.length) return `<div style="padding:40px;text-align:center;color:var(--muted);">No travelers match the filter.</div>`;

  const arrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const th = (key, label) => `<th data-trav-sort="${key}" style="cursor:pointer;padding:10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--border);user-select:none;background:var(--bg2);">${label}${arrow(key)}</th>`;

  return `<table style="width:100%;border-collapse:collapse;">
    <thead style="position:sticky;top:0;z-index:1;">
      <tr>${th('name','Name')}${th('home','Home')}${th('country','Country / City')}${th('type','Type')}${th('details','Itinerary')}${th('lastKnown','Last seen')}<th style="padding:10px;border-bottom:1px solid var(--border);background:var(--bg2);"></th></tr>
    </thead>
    <tbody>${rows.map(travRowHTML).join('')}</tbody>
  </table>`;
}

function travRowHTML(t) {
  const homeOff = OFFICE_BY_ID[t.home];
  let detail = '<span style="color:var(--muted);">—</span>';
  if (t.type === 'flight' && t.flight) {
    detail = `<b>${esc(t.flight.airline)} ${esc(t.flight.number)}</b><br><span style="color:var(--muted);font-size:11px;">${esc(t.flight.origin)} → ${esc(t.flight.dest)} · arr ${_fmtTravTime(t.flight.arrival)}</span>`;
  } else if (t.type === 'hotel' && t.hotel) {
    detail = `<b>${esc(t.hotel.name)}</b><br><span style="color:var(--muted);font-size:11px;">${_fmtTravDate(t.hotel.checkIn)} – ${_fmtTravDate(t.hotel.checkOut)} · ${esc(t.hotel.confirm||'')}</span>`;
  } else if (t.type === 'office' && t.office) {
    const o = OFFICE_BY_ID[t.office.id];
    detail = `<b>${esc(o?.name||t.office.id)} office</b><br><span style="color:var(--muted);font-size:11px;">${_fmtTravDate(t.office.arriveDate)} – ${_fmtTravDate(t.office.departDate)}</span>`;
  }
  const typeIcon = t.type === 'flight' ? '✈' : t.type === 'hotel' ? '🏨' : '🏢';
  const typeColor = t.type === 'flight' ? 'var(--blue)' : t.type === 'hotel' ? 'var(--yellow)' : 'var(--green)';
  return `<tr style="border-bottom:1px solid var(--border);">
    <td style="padding:10px;"><b>${esc(t.name)}</b></td>
    <td style="padding:10px;color:var(--muted);">${esc(homeOff?.name || t.home)}</td>
    <td style="padding:10px;"><b>${esc(t.country)}</b><br><span style="color:var(--muted);font-size:11px;">${esc(t.destCity)}</span></td>
    <td style="padding:10px;"><span style="display:inline-flex;align-items:center;gap:4px;color:${typeColor};font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">${typeIcon} ${esc(t.type)}</span></td>
    <td style="padding:10px;font-size:12px;line-height:1.4;">${detail}</td>
    <td style="padding:10px;color:var(--muted);font-size:11px;white-space:nowrap;">${relTime(t.lastKnownTs)}</td>
    <td style="padding:10px;text-align:right;white-space:nowrap;">
      <button class="btn-ghost trav-zoom" data-trav-id="${esc(t.id)}" title="Zoom map" style="font-size:11px;padding:4px 8px;margin-right:4px;">📍</button>
      <button class="btn-ghost trav-msg" data-trav-id="${esc(t.id)}" title="Pre-fill Crisis Comms" style="font-size:11px;padding:4px 8px;">✉</button>
    </td>
  </tr>`;
}

function refreshTravList() {
  const body = document.getElementById('trav-list-body');
  if (body) body.innerHTML = travListRowsHTML();
  bindTravListRowHandlers();
}

function bindTravListHandlers() {
  // Toolbar controls only exist when TRAVELERS has data — guard the lookups
  // so an empty list (live mode without Navan) doesn't throw.
  const searchEl = document.getElementById('trav-search');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      TRAV_VIEW.search = e.target.value;
      refreshTravList();
    });
  }
  document.querySelectorAll('[data-trav-filter]').forEach(b => b.addEventListener('click', () => {
    TRAV_VIEW.typeFilter = b.dataset.travFilter;
    // Re-render the whole modal so chip styling refreshes
    const back = document.getElementById('modal-back');
    if (back) back.querySelector('.modal').innerHTML = travListBodyHTML();
    bindTravListHandlers();
  }));
  const csvBtn = document.getElementById('trav-export-csv');
  if (csvBtn) csvBtn.addEventListener('click', exportTravelersCSV);
  refreshTravList();
}

function bindTravListRowHandlers() {
  document.querySelectorAll('[data-trav-sort]').forEach(h => h.addEventListener('click', () => {
    const key = h.dataset.travSort;
    if (TRAV_VIEW.sortKey === key) TRAV_VIEW.sortDir = TRAV_VIEW.sortDir === 'asc' ? 'desc' : 'asc';
    else { TRAV_VIEW.sortKey = key; TRAV_VIEW.sortDir = 'asc'; }
    refreshTravList();
  }));
  document.querySelectorAll('.trav-zoom').forEach(b => b.addEventListener('click', () => {
    const t = TRAVELERS.find(x => x.id === b.dataset.travId);
    if (!t) return;
    closeModal();
    map.flyTo([t.lat, t.lng], 7, { duration: 0.8 });
    toast(`Zoomed to ${t.name} · ${t.destCity}`);
  }));
  document.querySelectorAll('.trav-msg').forEach(b => b.addEventListener('click', () => {
    const t = TRAVELERS.find(x => x.id === b.dataset.travId);
    if (!t) return;
    closeModal();
    const locLabel = `${t.name} · ${t.destCity}`;
    if (!STATE.customLocations.includes(locLabel)) STATE.customLocations.push(locLabel);
    if (!STATE.subject) STATE.subject = `Safety check — ${t.name} (${t.destCity})`;
    STATE.template = 'check';
    openPanel('crisis');
    setCcTab('compose');
    renderCC();
    toast(`Pre-loaded Crisis Comms for ${t.name}.`);
  }));
}

function exportTravelersCSV() {
  const headers = ['id','name','home','destCity','country','type','airline','flightNumber','origin','dest','departure','arrival','hotelName','hotelAddress','checkIn','checkOut','confirmation','officeId','officeArrive','officeDepart','lastKnownTs','lat','lng'];
  const rows = TRAVELERS.map(t => [
    t.id, t.name, t.home, t.destCity, t.country||'', t.type,
    t.flight?.airline||'', t.flight?.number||'', t.flight?.origin||'', t.flight?.dest||'',
    t.flight?.departure||'', t.flight?.arrival||'',
    t.hotel?.name||'', t.hotel?.address||'', t.hotel?.checkIn||'', t.hotel?.checkOut||'', t.hotel?.confirm||'',
    t.office?.id||'', t.office?.arriveDate||'', t.office?.departDate||'',
    t.lastKnownTs||'', t.lat, t.lng,
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => {
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `travelers-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${TRAVELERS.length} travelers to CSV.`);
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
/* REMOTE_EMPLOYEES moved to state.js. */

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
/* ACLED_RISK moved to state.js. */

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
/* WHO_OUTBREAKS moved to state.js. */

const BCP_EVENT_TYPES = [
  { id:'terror',    label:'Terrorist incident',          titleHint:'Terror incident — ' },
  { id:'masscas',   label:'Mass-casualty event',         titleHint:'Mass-casualty event — ' },
  { id:'quake',     label:'Major earthquake',            titleHint:'Major earthquake — ' },
  { id:'hurricane', label:'Hurricane / Typhoon',         titleHint:'Hurricane — ' },
  { id:'civil',     label:'Civil collapse / unrest',     titleHint:'Civil unrest — ' },
  { id:'transit',   label:'Mass transit failure',        titleHint:'Transit disruption — ' },
  { id:'geopol',    label:'Geopolitical escalation',     titleHint:'Geopolitical event — ' },
  { id:'other',     label:'Other / Custom',              titleHint:'' },
];

/* BCP_FORM moved to state.js; bridged via main.js so legacy mutations propagate. */

function showBCPModal(preserve = false) {
  if (!preserve) {
    Object.assign(BCP_FORM, { title:'', countries:[], useFence:false, customMessage:'', acknowledged:false, _waitingForFence:false });
  } else {
    BCP_FORM._waitingForFence = false; // returning from fence-draw round trip
  }
  showModal(bcpModalHTML());
  bindBCPHandlers();
}

/* Floating chip shown while operator is in the geo-fence-draw round trip.
   Click → cancel and reopen BCI modal with form preserved.
   Auto-clears after 30s if operator forgets. Prevents the "stuck waiting"
   state where any unrelated future fence draw would surprise-reopen BCI. */
function showBCIWaitingChip() {
  clearBCIWaitingChip(); // idempotent
  const chip = document.createElement('div');
  chip.id = 'bci-waiting-chip';
  chip.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:9999;background:#fca5a5;color:#0a0a0a;padding:6px 14px;border-radius:14px;font:11px/1.4 system-ui,-apple-system,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.35);user-select:none;font-weight:700;';
  chip.textContent = '✕ Cancel — return to BCI';
  chip.title = 'Cancel fence draw and reopen the BCI form (state preserved)';
  chip.addEventListener('click', () => {
    clearBCIWaitingChip();
    BCP_FORM._waitingForFence = false;
    document.getElementById('tools-dropdown')?.classList.remove('open');
    showBCPModal(true);
  });
  document.body.appendChild(chip);
  BCP_FORM._waitingTimeoutId = setTimeout(() => {
    if (BCP_FORM._waitingForFence) {
      clearBCIWaitingChip();
      BCP_FORM._waitingForFence = false;
      toast('Fence draw timed out. Click Declare BCI again to retry.');
    }
  }, 30000);
}
function clearBCIWaitingChip() {
  const c = document.getElementById('bci-waiting-chip');
  if (c) c.remove();
  if (BCP_FORM._waitingTimeoutId) {
    clearTimeout(BCP_FORM._waitingTimeoutId);
    BCP_FORM._waitingTimeoutId = null;
  }
}

function bcpModalHTML() {
  return `<div style="width:min(900px,92vw);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);background:rgba(248,113,113,.08);">
      <div>
        <div style="font-size:16px;font-weight:700;color:#fca5a5;">🚨 Declare Business Continuity Incident</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Use this when a macro-level event has occurred and you need to coordinate response across an affected region.</div>
      </div>
      <button class="btn-ghost" onclick="App.closeModal()" aria-label="Close">✕</button>
    </div>
    <div id="bcp-form-body" style="flex:1;overflow-y:auto;padding:14px 18px;"></div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn-ghost" onclick="App.closeModal()">Cancel</button>
      <button id="bcp-declare-btn" class="btn-ghost" disabled style="background:rgba(248,113,113,.18);border-color:rgba(248,113,113,.5);color:#fca5a5;font-weight:700;">🚨 Declare</button>
    </div>
  </div>`;
}

function bcpAvailableCountries() {
  // Union of:
  //   - COUNTRY_PRESENCE editorial seed (always-loaded; covers countries with
  //     no current data points — Brazil, Singapore, etc. — so operators can
  //     still declare BCI for them)
  //   - Live data sources (offices, travelers, remote employees) — these may
  //     surface countries the seed missed (e.g. a traveler in Iceland)
  // Filter out 'In transit' (a traveler value, not a real country).
  const set = new Set();
  COUNTRY_PRESENCE.forEach(c => set.add(c.name));
  OFFICES.forEach(o => set.add(o.country));
  TRAVELERS.forEach(t => t.country && set.add(t.country));
  REMOTE_EMPLOYEES.forEach(r => set.add(r.country));
  return Array.from(set).filter(c => c !== 'In transit').sort();
}

function bcpExposureInScope() {
  const useFence = BCP_FORM.useFence && STATE.fence;
  let offices, travelers, remote;
  if (useFence) {
    offices = OFFICES.filter(o => pointInFence(o.lat, o.lng));
    travelers = TRAVELERS.filter(t => pointInFence(t.lat, t.lng));
    // Remote employees have no lat/lng; geo-fence cannot include them.
    remote = [];
  } else {
    offices = OFFICES.filter(o => BCP_FORM.countries.includes(o.country));
    travelers = TRAVELERS.filter(t => BCP_FORM.countries.includes(t.country));
    remote = REMOTE_EMPLOYEES.filter(r => BCP_FORM.countries.includes(r.country));
  }
  const officeHeadcount = sumHeadcount(offices);   // safe with undefined headcounts
  return { offices, travelers, remote, officeHeadcount,
    travelerCount: travelers.length, remoteCount: remote.length,
    totalExposed: officeHeadcount + travelers.length + remote.length };
}

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
function bcpAcledRiskHTML() {
  const header = `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Country Risk Profile <span style="text-transform:none;letter-spacing:0;">· ACLED · last 30 days</span></div>`;

  // Live + bare Pages: pending-integration placeholder
  if (!hasAcledRisk()) {
    return `${header}<div style="font-size:11px;color:var(--muted);font-style:italic;">Pending ACLED license &amp; integration. Vetted civil-unrest and conflict counts will populate here once ACLED is connected.</div>`;
  }

  // Mock mode + no country selected: empty-state hint with link to full modal
  if (BCP_FORM.countries.length === 0) {
    return `${header}<div style="font-size:11px;color:var(--muted);">Pick one or more countries above for a quick read, or <a href="#" id="bcp-open-risk" style="color:var(--green);">browse the full Risk Profile →</a></div>`;
  }

  const total = aggregateAcledRisk(BCP_FORM.countries);
  return `${header}
    <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:13px;gap:14px;flex-wrap:wrap;">
      <span style="color:var(--text);">
        <b style="color:var(--text);font-size:16px;">${total.totalEvents.toLocaleString()}</b> violent events · <b style="color:#ef4444;font-size:16px;">${total.fatalities.toLocaleString()}</b> fatalities
        <span style="color:var(--muted);font-size:11px;">(across ${BCP_FORM.countries.length} ${BCP_FORM.countries.length===1?'country':'countries'})</span>
      </span>
      <a href="#" id="bcp-open-risk" style="color:var(--green);font-size:12px;white-space:nowrap;">View full Risk Profile →</a>
    </div>`;
}

function bcpExposureSummaryHTML(exp) {
  const officeIds = exp.offices.length ? exp.offices.map(o => o.id).join(', ') : 'none';
  // Three independent integrations gate the people-impact math:
  //   office headcounts ← Workday  (per-office headcount field)
  //   travelers          ← Navan
  //   remote employees   ← Workday  (per-individual records)
  // When any of these is empty (live mode), show a "pending" placeholder
  // rather than a fake-zero count, so operators can tell "no integration"
  // from "the answer is zero".
  const hasHeadcounts = hasOfficeHeadcounts();
  const hasTravelers  = TRAVELERS.length > 0;
  const hasRemote     = REMOTE_EMPLOYEES.length > 0;
  return `
    <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Exposure in Scope</div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px;">
      <div><b style="color:var(--blue);font-size:18px;">${exp.offices.length}</b> office${exp.offices.length===1?'':'s'} <span style="color:var(--muted);font-size:11px;">(${esc(officeIds)})</span></div>
      ${hasHeadcounts
        ? `<div><b style="color:var(--green);font-size:18px;">${exp.officeHeadcount.toLocaleString()}</b> office headcount</div>`
        : `<div style="color:var(--muted);font-size:11px;font-style:italic;align-self:center;">Office headcount: awaiting Workday connection</div>`}
      ${hasTravelers
        ? `<div><b style="color:var(--yellow);font-size:18px;">${exp.travelerCount}</b> traveler${exp.travelerCount===1?'':'s'}</div>`
        : `<div style="color:var(--muted);font-size:11px;font-style:italic;align-self:center;">Travelers: awaiting Navan connection</div>`}
      ${hasRemote
        ? `<div><b style="color:#a855f7;font-size:18px;">${exp.remoteCount}</b> remote employee${exp.remoteCount===1?'':'s'}</div>`
        : `<div style="color:var(--muted);font-size:11px;font-style:italic;align-self:center;">Remote employees: awaiting Workday connection</div>`}
    </div>
    ${(hasHeadcounts || hasTravelers || hasRemote)
      ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:13px;">
          <b style="color:var(--text);font-size:16px;">${exp.totalExposed.toLocaleString()}</b> total exposed${(!hasHeadcounts || !hasTravelers || !hasRemote) ? ` <span style="color:var(--muted);font-size:11px;font-style:italic;">(partial — pending integrations above)</span>` : ''}
        </div>`
      : `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);font-style:italic;">
          Total exposure unavailable — Workday + Navan integrations pending.
        </div>`}`;
}

function bcpFormBodyHTML() {
  const countries = bcpAvailableCountries();
  const exp = bcpExposureInScope();
  const fenceAvailable = !!STATE.fence;
  const useFenceNow = BCP_FORM.useFence && fenceAvailable;
  return `
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Event Type</label>
      <select id="bcp-event-type" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);">
        ${BCP_EVENT_TYPES.map(t => `<option value="${esc(t.id)}" ${t.id===BCP_FORM.eventTypeId?'selected':''}>${esc(t.label)}</option>`).join('')}
      </select>
    </div>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Event Title</label>
      <input id="bcp-title" type="text" placeholder="Concise headline operators will see" value="${esc(BCP_FORM.title)}"
        style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);" />
    </div>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Geographic Scope</label>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
        ${fenceAvailable ? `<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;color:var(--text);">
          <input id="bcp-use-fence" type="checkbox" ${BCP_FORM.useFence?'checked':''} />
          Use the currently drawn geo-fence (overrides country picks)
        </label>` : ''}
        <button id="bcp-draw-fence" class="btn-ghost" style="font-size:11px;padding:4px 10px;border:1px dashed var(--border);">✏ ${fenceAvailable?'Redraw fence':'Draw fence on map'}</button>
        ${fenceAvailable ? `<button id="bcp-clear-fence" class="btn-ghost" style="font-size:11px;padding:4px 8px;color:var(--muted);">✕ Clear fence</button>` : ''}
      </div>
      <div id="bcp-country-list" style="display:flex;flex-wrap:wrap;gap:5px;${useFenceNow?'opacity:0.4;pointer-events:none;':''}">
        ${countries.map(c => `<button class="bcp-country-chip" data-country="${esc(c)}"
          style="padding:4px 10px;border:1px solid var(--border);border-radius:14px;background:${BCP_FORM.countries.includes(c)?'var(--green)':'var(--bg3)'};color:${BCP_FORM.countries.includes(c)?'#062c1f':'var(--text)'};font-size:11px;cursor:pointer;font-weight:${BCP_FORM.countries.includes(c)?'700':'400'};">${esc(c)}</button>`).join('')}
      </div>
    </div>
    <div style="margin-bottom:14px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
      ${bcpExposureSummaryHTML(exp)}
    </div>
    <div style="margin-bottom:14px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
      ${bcpAcledRiskHTML()}
    </div>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Recommended Template</label>
      <select id="bcp-template" style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);">
        ${
          // Pull all built-in templates from the BC + travel + check-in categories
          // so the new event-class BC variants (bc_announce_quake, _terror,
          // travel_advisory, etc.) show up here too. Grouped via optgroups.
          (() => {
            const bcCats = ['bc_announce','bc_checkin','bc_closure','travel','checkin'];
            const groups = bcCats.map(catId => {
              const cat = TEMPLATE_CATEGORIES.find(c => c.id === catId);
              const list = Object.entries(TEMPLATES)
                .filter(([_, t]) => t.category === catId)
                .map(([k, t]) => ({ id: k, name: t.name, priority: t.priority||99 }))
                .sort((a,b) => a.priority - b.priority);
              if (!list.length) return '';
              return `<optgroup label="${esc(cat.label)}">${
                list.map(t => `<option value="${esc(t.id)}" ${t.id===BCP_FORM.templateId?'selected':''}>${esc(t.name)}</option>`).join('')
              }</optgroup>`;
            }).join('');
            return groups;
          })()
        }
      </select>
    </div>
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Additional Context (Optional)</label>
      <textarea id="bcp-message" rows="3" placeholder="Anything the templated message doesn't cover. Will be appended to the message body when sent."
        style="width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);font-family:inherit;resize:vertical;">${esc(BCP_FORM.customMessage)}</textarea>
    </div>
    <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;cursor:pointer;padding:10px 12px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.3);border-radius:4px;color:var(--text);">
      <input id="bcp-ack" type="checkbox" style="margin-top:2px;" ${BCP_FORM.acknowledged?'checked':''} />
      <span><b>I confirm this event meets BCI escalation threshold.</b> Declaring will create a Business Continuity Incident and pre-load Crisis Comms with the affected scope. No messages are sent until you click Send in the Crisis panel.</span>
    </label>`;
}

function refreshBCPExposure() {
  const body = document.getElementById('bcp-form-body');
  if (body) body.innerHTML = bcpFormBodyHTML();
  bindBCPFormHandlers();
  updateBCPDeclareButton();
}

function updateBCPDeclareButton() {
  const btn = document.getElementById('bcp-declare-btn'); if (!btn) return;
  const ok = BCP_FORM.acknowledged && BCP_FORM.title.trim().length > 0 &&
    (BCP_FORM.useFence ? !!STATE.fence : BCP_FORM.countries.length > 0);
  btn.disabled = !ok;
  btn.style.opacity = ok ? '1' : '0.5';
  btn.style.cursor = ok ? 'pointer' : 'not-allowed';
}

function bindBCPHandlers() {
  document.getElementById('bcp-declare-btn').addEventListener('click', declareBCP);
  refreshBCPExposure();
}

function bindBCPFormHandlers() {
  document.getElementById('bcp-event-type').addEventListener('change', e => {
    BCP_FORM.eventTypeId = e.target.value;
    const t = BCP_EVENT_TYPES.find(x => x.id === BCP_FORM.eventTypeId);
    const titleInput = document.getElementById('bcp-title');
    if (t && t.titleHint && (!BCP_FORM.title || BCP_FORM.title.trim() === '' || BCP_EVENT_TYPES.some(x => x.titleHint && BCP_FORM.title === x.titleHint))) {
      titleInput.value = t.titleHint;
      BCP_FORM.title = t.titleHint;
    }
    updateBCPDeclareButton();
  });
  document.getElementById('bcp-title').addEventListener('input', e => {
    BCP_FORM.title = e.target.value;
    updateBCPDeclareButton();
  });
  const fenceChk = document.getElementById('bcp-use-fence');
  if (fenceChk) fenceChk.addEventListener('change', e => {
    BCP_FORM.useFence = e.target.checked;
    refreshBCPExposure();
  });
  const drawBtn = document.getElementById('bcp-draw-fence');
  if (drawBtn) drawBtn.addEventListener('click', () => {
    // Mark that we're waiting for a fence so the draw handler can reopen us.
    BCP_FORM._waitingForFence = true;
    closeModal();
    // Open Map Tools dropdown directly to the Geo-fence tab. Don't auto-pick
    // a shape — operator may want Circle, Rectangle, or Polygon.
    document.getElementById('tools-dropdown').classList.add('open');
    setMapToolsTab('fence');
    // Show floating cancel chip + auto-timeout so we don't get stuck waiting.
    showBCIWaitingChip();
    toast('Pick a shape and draw on the map. Click the chip top-center to cancel.');
  });
  const clearBtn = document.getElementById('bcp-clear-fence');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    clearFence();
    BCP_FORM.useFence = false;
    refreshBCPExposure();
  });
  document.querySelectorAll('.bcp-country-chip').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.country;
    if (BCP_FORM.countries.includes(c)) BCP_FORM.countries = BCP_FORM.countries.filter(x => x !== c);
    else BCP_FORM.countries.push(c);
    refreshBCPExposure();
  }));
  document.getElementById('bcp-template').addEventListener('change', e => { BCP_FORM.templateId = e.target.value; });
  document.getElementById('bcp-message').addEventListener('input', e => { BCP_FORM.customMessage = e.target.value; });
  document.getElementById('bcp-ack').addEventListener('change', e => {
    BCP_FORM.acknowledged = e.target.checked;
    updateBCPDeclareButton();
  });
  // "View full Risk Profile →" link in the compact BCI risk panel — opens
  // the standalone modal pre-populated with whatever countries are currently
  // selected. The modal is layered on top via showModal() (single-modal
  // architecture means closing the Risk modal will dismiss the BCI; that's
  // a known limitation we can revisit if it becomes annoying).
  const openRisk = document.getElementById('bcp-open-risk');
  if (openRisk) {
    openRisk.addEventListener('click', e => {
      e.preventDefault();
      showRiskProfileModal(BCP_FORM.countries);
    });
  }
}

function declareBCP() {
  const exp = bcpExposureInScope();
  const evt = BCP_EVENT_TYPES.find(x => x.id === BCP_FORM.eventTypeId);
  const officeIds = exp.offices.map(o => o.id);
  const linkAlert = ALERTS.find(a =>
    SEV_RANK[a.sev] >= SEV_RANK.high && a.officeId && officeIds.includes(a.officeId));
  const description = `Business Continuity Incident declared by operator. Type: ${evt.label}. ` +
    `Scope: ${BCP_FORM.useFence ? 'drawn geo-fence' : BCP_FORM.countries.join(', ')}. ` +
    `Exposure at declaration: ${exp.officeHeadcount + exp.remoteCount} employees, ` +
    `${exp.travelerCount} travelers across ${exp.offices.length} office(s).`;
  const inc = createIncident({
    title: BCP_FORM.title, offices: officeIds, severity: 'ext',
    description, alertId: linkAlert?.id || null,
  });
  inc.bcp = true;
  inc.bcpEventType = evt.id;
  inc.bcpScope = BCP_FORM.useFence ? { type:'fence' } : { type:'countries', countries: BCP_FORM.countries.slice() };
  inc.bcpExposureSnapshot = {
    offices: exp.offices.length, officeHeadcount: exp.officeHeadcount,
    travelers: exp.travelerCount, remote: exp.remoteCount,
  };
  // Extend response tracking to include in-scope travelers (even those NOT
  // at any office) and remote employees. createIncident's buildResponseShells
  // only covers office-resident employees + travelers atOffice — for a BCI
  // we need the full in-scope population.
  if (!STATE.responses[inc.id]) STATE.responses[inc.id] = {};
  exp.travelers.forEach(t => {
    const key = 'T-' + t.id;
    if (!STATE.responses[inc.id][key]) {
      STATE.responses[inc.id][key] = { status:'no', when:null, by:null, traveler:true };
    }
  });
  exp.remote.forEach(r => {
    const key = 'R-' + r.id;
    if (!STATE.responses[inc.id][key]) {
      STATE.responses[inc.id][key] = { status:'no', when:null, by:null, remote:true };
    }
  });
  addIncidentLog(inc.id, 'create',
    `🚨 <b>BCI</b> declared: ${esc(evt.label)}. Exposure: ${exp.officeHeadcount + exp.remoteCount} employees · ${exp.travelerCount} travelers · ${exp.offices.length} office(s).`);
  STATE.selectedOffices = officeIds.slice();
  STATE.template = BCP_FORM.templateId;
  STATE.subject = `[EXTREME · BCI] ${BCP_FORM.title}`;
  // Only overwrite the Crisis Comm draft if the BCI form contributed context.
  // If BCI message is empty, preserve whatever the operator was already drafting.
  if (BCP_FORM.customMessage && BCP_FORM.customMessage.trim()) {
    STATE.customMessage = BCP_FORM.customMessage;
  }
  STATE.linkedIncidentId = inc.id;
  closeModal();
  openPanel('crisis');
  setCcTab('compose');
  renderCC();
  renderIncidents();
  toast(`🚨 BCI declared: ${BCP_FORM.title}. ${exp.totalExposed.toLocaleString()} recipients staged.`);
}

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
/* RISK_VIEW moved to state.js. */

function showRiskProfileModal(prefilledCountries) {
  RISK_VIEW.selected = Array.isArray(prefilledCountries) ? prefilledCountries.slice() : [];
  RISK_VIEW.search = '';
  RISK_VIEW.regionFilter = 'all';
  showModal(riskModalHTML());
  bindRiskModalHandlers();
}

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
function riskCountryList() {
  // Build a name → entry map starting from COUNTRY_PRESENCE
  const byName = new Map();
  for (const cp of COUNTRY_PRESENCE) {
    byName.set(cp.name, { name: cp.name, region: cp.region, total: 0, fatalities: 0, hasAcled: false });
  }
  // Overlay ACLED data when available
  for (const [name, r] of Object.entries(ACLED_RISK)) {
    const total = (r.battles||0) + (r.vac||0) + (r.explosions||0) + (r.riots||0) + (r.strategicDev||0);
    const existing = byName.get(name);
    if (existing) {
      existing.total = total;
      existing.fatalities = r.fatalities || 0;
      existing.hasAcled = true;
    } else {
      // ACLED has data for a country not in COUNTRY_PRESENCE — surface it anyway
      // (e.g. Ukraine, Yemen — not necessarily NR-presence countries but
      // operationally relevant for traveler safety / BCI scope).
      byName.set(name, { name, region: '—', total, fatalities: r.fatalities || 0, hasAcled: true });
    }
  }
  const all = Array.from(byName.values());
  const filtered = all.filter(c => {
    if (RISK_VIEW.regionFilter !== 'all' && c.region !== RISK_VIEW.regionFilter) return false;
    if (RISK_VIEW.search && !c.name.toLowerCase().includes(RISK_VIEW.search.toLowerCase())) return false;
    return true;
  });
  filtered.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return filtered;
}

/* Live Hazards panel for the Risk Profile modal — aggregates the existing
 * alert pipeline (NWS / MeteoAlarm / GDACS / USGS / EMSC / EONET / State Dept)
 * for the selected countries. Renders quietly when no live hazards are
 * detected. Distinct from ACLED (historical context) below it.
 */
function riskLiveHazardsHTML() {
  if (RISK_VIEW.selected.length === 0) return '';
  const h = liveHazardsAggregated(RISK_VIEW.selected);
  const outbreaks = outbreaksAggregated(RISK_VIEW.selected);
  const header = `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Live Hazards <span style="text-transform:none;letter-spacing:0;">· current · from active alert pipeline + WHO</span></div>`;

  // Quiet state — nothing active in the selected scope
  if (h.total === 0 && !h.travelAdvisoryLevel && outbreaks.length === 0) {
    return `<div style="margin:14px 18px 0 18px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
      ${header}
      <div style="font-size:12px;color:var(--muted);font-style:italic;">No active hazards detected in the selected ${RISK_VIEW.selected.length===1?'country':'countries'}. The alert pipeline will refresh as new events come in.</div>
    </div>`;
  }

  // Build the visible rows — only show categories with non-zero counts,
  // plus the advisory level if elevated above L1.
  const rows = [];
  if (h.travelAdvisoryLevel) {
    const ADVISORY_TEXT = { L1: 'Exercise Normal Precautions', L2: 'Exercise Increased Caution', L3: 'Reconsider Travel', L4: 'Do Not Travel' };
    const ADVISORY_COLOR = { L1: 'var(--muted)', L2: '#facc15', L3: '#fb923c', L4: '#ef4444' };
    rows.push(`<div style="font-size:13px;display:flex;align-items:center;gap:8px;">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ADVISORY_COLOR[h.travelAdvisoryLevel]};"></span>
      <span style="color:var(--text);"><b>Travel Advisory: ${h.travelAdvisoryLevel}</b> · ${ADVISORY_TEXT[h.travelAdvisoryLevel]}</span>
      <span style="color:var(--muted);font-size:11px;">State Dept</span>
    </div>`);
  }
  if (h.earthquakes)   rows.push(`<div style="font-size:13px;">🌍 <b>${h.earthquakes}</b> recent earthquake${h.earthquakes===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· USGS / EMSC</span></div>`);
  if (h.severeWeather) rows.push(`<div style="font-size:13px;">🌪 <b>${h.severeWeather}</b> severe weather warning${h.severeWeather===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· NWS / MeteoAlarm</span></div>`);
  if (h.gdacsActive)   rows.push(`<div style="font-size:13px;">🚨 <b>${h.gdacsActive}</b> GDACS Orange/Red event${h.gdacsActive===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· global disaster coordination</span></div>`);
  if (h.wildfires)     rows.push(`<div style="font-size:13px;">🔥 <b>${h.wildfires}</b> wildfire${h.wildfires===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· EONET / NWS</span></div>`);
  if (h.volcanoes)     rows.push(`<div style="font-size:13px;">🌋 <b>${h.volcanoes}</b> volcanic event${h.volcanoes===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· EONET</span></div>`);
  if (h.civilUnrest)   rows.push(`<div style="font-size:13px;">⚠️ <b>${h.civilUnrest}</b> civil unrest event${h.civilUnrest===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· live feed</span></div>`);
  if (h.publicSafety)  rows.push(`<div style="font-size:13px;">🚓 <b>${h.publicSafety}</b> public safety incident${h.publicSafety===1?'':'s'}</div>`);
  // WHO Disease Outbreak News — show one row summarizing diseases. The
  // detail (per-country, with cases / since dates) is below the rollup
  // for operators who want to read the WHO source. Rendered only when
  // outbreaks exist for the selected countries.
  if (outbreaks.length > 0) {
    const diseases = [...new Set(outbreaks.map(o => o.disease))];
    const SEV_RANK_LOCAL = { low: 1, mod: 2, high: 3, ext: 4 };
    const maxSev = outbreaks.reduce((max, o) => SEV_RANK_LOCAL[o.severity] > SEV_RANK_LOCAL[max] ? o.severity : max, 'low');
    const maxColor = maxSev === 'ext' ? '#ef4444' : maxSev === 'high' ? '#fb923c' : maxSev === 'mod' ? '#facc15' : 'var(--muted)';
    rows.push(`<div style="font-size:13px;">🦠 <b style="color:${maxColor};">${outbreaks.length}</b> active disease outbreak${outbreaks.length===1?'':'s'} <span style="color:var(--muted);font-size:11px;">· ${esc(diseases.join(', '))} · WHO</span></div>`);
  }

  // Optional WHO outbreak detail block — only shown if outbreaks exist;
  // gives the operator the per-country, per-disease breakdown with WHO
  // source links. Compact list, scrollable if it grows.
  const outbreakDetail = outbreaks.length === 0 ? '' : `
    <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border);">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">WHO Outbreak Detail</div>
      ${outbreaks.map(o => {
        const sevDot = o.severity === 'ext' ? '#ef4444' : o.severity === 'high' ? '#fb923c' : o.severity === 'mod' ? '#facc15' : 'var(--muted)';
        const cases = o.cases ? ` · ${o.cases.toLocaleString()} cases` : '';
        return `<div style="font-size:12px;padding:3px 0;display:flex;align-items:center;gap:8px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${sevDot};flex-shrink:0;"></span>
          <span style="color:var(--text);"><b>${esc(o.country)}</b> · ${esc(o.disease)}</span>
          <span style="color:var(--muted);font-size:11px;">since ${esc(o.since)}${cases}</span>
          <a href="${esc(o.link)}" target="_blank" rel="noopener" style="color:var(--green);font-size:11px;margin-left:auto;">WHO ↗</a>
        </div>`;
      }).join('')}
    </div>`;

  return `<div style="margin:14px 18px 0 18px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
    ${header}
    <div style="display:flex;flex-direction:column;gap:6px;">${rows.join('')}</div>
    ${outbreakDetail}
  </div>`;
}

function riskModalHTML() {
  const countries = riskCountryList();
  const totalAvailable = countries.length;   // total countries in the picker (presence ∪ ACLED)
  const selectedCount = RISK_VIEW.selected.length;
  const aclLoaded = hasAcledRisk();
  const aggregated = (selectedCount > 0 && aclLoaded) ? aggregateAcledRisk(RISK_VIEW.selected) : null;

  const regionChip = (id, label) => `<button data-risk-region="${id}" style="padding:5px 11px;background:${id===RISK_VIEW.regionFilter?'var(--green)':'var(--bg3)'};color:${id===RISK_VIEW.regionFilter?'#062c1f':'var(--text)'};border:0;border-radius:14px;font-size:11px;cursor:pointer;font-weight:${id===RISK_VIEW.regionFilter?'700':'400'};">${esc(label)}</button>`;

  // ACLED aggregated panel — three states:
  //   1. ACLED data present + countries selected: full counts + breakdown
  //   2. ACLED data present + nothing selected: empty hint
  //   3. ACLED not loaded (live + bare Pages): pending placeholder with note
  //      that Live Hazards above still works
  const aclHeader = `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">ACLED Historical Context <span style="text-transform:none;letter-spacing:0;">· last 30 days</span></div>`;
  let aggregatedPanel;
  if (!aclLoaded) {
    aggregatedPanel = `<div style="margin:14px 18px 0 18px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
      ${aclHeader}
      <div style="font-size:12px;color:var(--muted);font-style:italic;">Pending ACLED license &amp; integration. Vetted civil-unrest and conflict counts (battles, violence-against-civilians, explosions, riots, strategic developments) will populate here once ACLED is connected. Live Hazards above pulls from the active alert pipeline regardless.</div>
    </div>`;
  } else if (aggregated) {
    aggregatedPanel = `<div style="margin:14px 18px 0 18px;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;">
      ${aclHeader}
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;">
        <div><b style="color:#ef4444;font-size:18px;">${aggregated.battles}</b> battles</div>
        <div><b style="color:#f87171;font-size:18px;">${aggregated.vac}</b> VAC</div>
        <div><b style="color:#fb923c;font-size:18px;">${aggregated.explosions}</b> explosions</div>
        <div><b style="color:#facc15;font-size:18px;">${aggregated.riots}</b> riots</div>
        <div><b style="color:#a3a3a3;font-size:18px;">${aggregated.strategicDev}</b> strategic dev</div>
      </div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:13px;display:flex;justify-content:space-between;align-items:baseline;">
        <span><b style="color:var(--text);font-size:16px;">${aggregated.totalEvents.toLocaleString()}</b> violent events</span>
        <span><b style="color:#ef4444;font-size:16px;">${aggregated.fatalities.toLocaleString()}</b> fatalities reported</span>
      </div>
      ${selectedCount > 1 ? `<div style="margin-top:8px;">${
        RISK_VIEW.selected.map(c => {
          const r = ACLED_RISK[c] || { battles:0, vac:0, explosions:0, riots:0, strategicDev:0, fatalities:0 };
          const events = r.battles + r.vac + r.explosions + r.riots + r.strategicDev;
          return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-top:1px solid var(--border);">
            <span style="color:var(--text);">${esc(c)}</span>
            <span style="color:var(--muted);">${events} events · ${r.fatalities} fatalities</span>
          </div>`;
        }).join('')
      }</div>` : ''}
    </div>`;
  } else {
    aggregatedPanel = `<div style="margin:14px 18px 0 18px;padding:14px 18px;color:var(--muted);font-size:12px;font-style:italic;text-align:center;background:var(--bg3);border:1px dashed var(--border);border-radius:4px;">
      Click one or more country chips below to see aggregated ACLED counts.
    </div>`;
  }

  const chipGrid = countries.length === 0
    ? `<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px;font-style:italic;">No countries match the filter.</div>`
    : `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 18px;">${
        countries.map(c => {
          const isSel = RISK_VIEW.selected.includes(c.name);
          const heat = c.total >= 100 ? '#ef4444' : c.total >= 30 ? '#f59e0b' : c.total >= 5 ? '#a3a3a3' : '#525252';
          // Show ACLED count badge only when data is available — in live mode
          // c.hasAcled is false and a "0" badge would mislead the operator into
          // thinking the country had zero events instead of "no ACLED data yet".
          const badge = c.hasAcled
            ? `<span style="background:${isSel?'rgba(0,0,0,0.18)':heat};color:${isSel?'#062c1f':'#fff'};border-radius:9px;padding:1px 7px;font-size:10px;font-weight:700;">${c.total}</span>`
            : '';
          return `<button class="risk-country-chip" data-country="${esc(c.name)}"
            style="padding:5px 10px;border:1px solid ${isSel?'var(--green)':'var(--border)'};border-radius:14px;background:${isSel?'var(--green)':'var(--bg3)'};color:${isSel?'#062c1f':'var(--text)'};font-size:11px;cursor:pointer;font-weight:${isSel?'700':'500'};display:inline-flex;align-items:center;gap:6px;">
            <span>${esc(c.name)}</span>${badge}
          </button>`;
        }).join('')
      }</div>`;

  return `<div style="width:min(720px,92vw);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:16px;font-weight:700;">🌐 Country Risk Profile <span style="font-weight:400;color:var(--muted);font-size:13px;">· last 30 days · ACLED</span></div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Vetted civil-unrest and conflict counts. Note: ACLED has a typical 5-14 day publication lag — this is contextual baseline, not real-time detection.</div>
      </div>
      <button class="btn-ghost" onclick="App.closeModal()" aria-label="Close">✕</button>
    </div>
    <div style="display:flex;gap:10px;padding:10px 18px;border-bottom:1px solid var(--border);align-items:center;flex-wrap:wrap;">
      <input id="risk-search" type="text" placeholder="Search country..." value="${esc(RISK_VIEW.search)}"
        style="flex:1;min-width:180px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);font-size:12px;" />
      <div style="display:flex;gap:4px;">
        ${regionChip('all','All')}${regionChip('Americas','Americas')}${regionChip('EMEA','EMEA')}${regionChip('APAC','APAC')}
      </div>
      <div style="font-size:11px;color:var(--muted);">${countries.length} of ${totalAvailable} countries</div>
    </div>
    ${riskLiveHazardsHTML()}
    ${aggregatedPanel}
    <div style="padding:12px 0 0 0;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding-left:18px;">
      Countries by event count · click to add/remove
    </div>
    <div id="risk-chip-body" style="flex:1;overflow-y:auto;padding:10px 0 16px 0;">
      ${chipGrid}
    </div>
  </div>`;
}

/* Debounce handle for the Risk modal search input. Module-level so it
   survives the re-bind cycle that happens on every modal re-render —
   bindRiskModalHandlers() is called both on initial open and after every
   re-render, and we want a single shared timer rather than one per call. */
let _riskSearchDebounce = null;

function bindRiskModalHandlers() {
  const search = document.getElementById('risk-search');
  if (search) {
    search.addEventListener('input', e => {
      RISK_VIEW.search = e.target.value;
      // Debounce the re-render — typing fast shouldn't rebuild the modal
      // on every keystroke. 150ms after the last keystroke avoids 3-4
      // unnecessary HTML regenerations while typing a normal word.
      if (_riskSearchDebounce) clearTimeout(_riskSearchDebounce);
      _riskSearchDebounce = setTimeout(() => {
        _riskSearchDebounce = null;
        const back = document.getElementById('modal-back');
        if (back) back.querySelector('.modal').innerHTML = riskModalHTML();
        bindRiskModalHandlers();
        // Restore focus + caret position after the re-render replaces the input
        const s = document.getElementById('risk-search');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }, 150);
    });
  }
  document.querySelectorAll('[data-risk-region]').forEach(b => b.addEventListener('click', () => {
    RISK_VIEW.regionFilter = b.dataset.riskRegion;
    const back = document.getElementById('modal-back');
    if (back) back.querySelector('.modal').innerHTML = riskModalHTML();
    bindRiskModalHandlers();
  }));
  document.querySelectorAll('.risk-country-chip').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.country;
    if (RISK_VIEW.selected.includes(c)) RISK_VIEW.selected = RISK_VIEW.selected.filter(x => x !== c);
    else RISK_VIEW.selected.push(c);
    const back = document.getElementById('modal-back');
    if (back) back.querySelector('.modal').innerHTML = riskModalHTML();
    bindRiskModalHandlers();
  }));
}


/* =========================================================================
   22. DEMO MODE — cycling alert + traveler simulator
   -------------------------------------------------------------------------
   Activates ONLY when the URL explicitly carries `#api=mock`.
   • The bare GitHub Pages URL (auto-detected mock mode) does NOT run the
     demo — Pages stays clean for stakeholder viewing.
   • Use file://...index.html#api=mock or any URL with that hash to opt in.
   • Enriches initial seed ALERTS so they pass the officeRelevantOnly filter.
   • Adds new alerts on a 25–70s cycle, with 4–9 min lifetime each.
   • Shifts a random traveler to their next leg every 45s, with toast.
   • Occasional Extreme injection so the status-strip wash + Crisis Comm
     fast-path get exercised on the demo URL.
   • Subtle DEMO MODE badge pinned top-right with click-to-pause.
   Localhost / file:// without hash (live mode) is unaffected.
   ========================================================================= */
if (!API_BASE && /[#&]api=mock/.test(location.hash)) {
  (function bootDemoMode() {
    const DEMO = {
      paused: false,
      newAlertEverySec: { min: 25, max: 70 },
      alertLifetimeSec: { min: 240, max: 540 },   // 4–9 minutes
      maxActiveDemo: 18,
      travelerMoveEverySec: 45,                   // every 45s — demo-speed so movement is visible
      extremeChance: 0.08,                        // 8% of injections are Extreme
      timers: {},
      demoIds: new Set(),
    };

    /* Pool of alert templates. Mix of severities, types, geos.
       Weighted toward office-proximity events so 🎯 view feels populated. */
    const POOL = [
      // ── San Francisco ──
      { sev:'high', type:'Public Safety', source:'Socrata',  officeId:'SFO',
        title:'Suspicious package — Embarcadero Plaza, cordon active',
        location:'San Francisco', lat:37.795, lng:-122.394, radiusKm:1,
        summary:'SFPD investigating; perimeter cordon active. Office on lockdown advisory.' },
      { sev:'mod',  type:'Civil Unrest', source:'ACLED',     officeId:'SFO',
        title:'Demonstration forming — Market & 5th',
        location:'San Francisco', lat:37.783, lng:-122.408, radiusKm:2,
        summary:'~300 participants. Estimated peak 16:00 local. Avoid Market between 4th–7th.' },
      { sev:'mod',  type:'Natural Disaster', source:'NASA EONET', officeId:'SFO',
        title:'Wildfire smoke advisory — AQI 168',
        location:'Bay Area', lat:38.0, lng:-122.4, radiusKm:120,
        summary:'PurpleAir reading 168 (Unhealthy). N95s recommended outdoors.' },
      { sev:'ext',  type:'Natural Disaster', source:'USGS',   officeId:'SFO',
        title:'M5.4 earthquake — 14km W of San Francisco',
        location:'San Francisco', lat:37.78, lng:-122.55, radiusKm:80,
        summary:'Strong shaking near Hayward fault. Initial reports of facade damage downtown.' },

      // ── Portland ──
      { sev:'mod',  type:'Public Safety', source:'PDX FlashAlert', officeId:'PDX',
        title:'Multi-vehicle accident — I-5 SB at Burnside',
        location:'Portland', lat:45.523, lng:-122.677, radiusKm:3,
        summary:'Two right lanes blocked. Expect 30+ min commute delay.' },
      { sev:'low',  type:'Travel Advisory', source:'NWS',     officeId:'PDX',
        title:'Winter weather advisory — freezing rain overnight',
        location:'Portland', lat:45.519, lng:-122.679, radiusKm:50,
        summary:'Light freezing rain 02:00–08:00. Surfaces may be slick.' },

      // ── Atlanta ──
      { sev:'high', type:'Natural Disaster', source:'NWS',    officeId:'ATL',
        title:'Tornado warning — Fulton & DeKalb counties',
        location:'Atlanta', lat:33.749, lng:-84.388, radiusKm:35,
        summary:'NWS Doppler-confirmed rotation. Take shelter in interior room. Active until 18:45 local.' },
      { sev:'mod',  type:'Natural Disaster', source:'NWS',    officeId:'ATL',
        title:'Severe thunderstorm — line of cells moving E at 35kt',
        location:'Atlanta metro', lat:33.78, lng:-84.39, radiusKm:80,
        summary:'Hail to 1.5", winds to 60 mph. Shelter recommended.' },

      // ── Barcelona ──
      { sev:'mod',  type:'Natural Disaster', source:'MeteoAlarm', officeId:'BCN',
        title:'Heavy rain & flood watch — Catalonia',
        location:'Barcelona', lat:41.385, lng:2.17, radiusKm:80,
        summary:'Orange-level alert for heavy precipitation through 22:00 local.' },
      { sev:'high', type:'Civil Unrest', source:'ACLED',     officeId:'BCN',
        title:'General strike call — Plaça de Catalunya gathering',
        location:'Barcelona', lat:41.387, lng:2.170, radiusKm:2,
        summary:'Estimated 8k participants. Metro lines L1/L3 partial closures.' },

      // ── Dublin ──
      { sev:'high', type:'Public Safety', source:'GDELT',    officeId:'DUB',
        title:'Suspicious package — Liffey Quay (cordon active)',
        location:'Dublin', lat:53.347, lng:-6.247, radiusKm:1,
        summary:'AGS bomb squad on scene. Roads closed Eden Quay to O\'Connell Bridge.' },
      { sev:'low',  type:'Public Safety', source:'GDELT',    officeId:'DUB',
        title:'Dublin Bus & Luas service reductions — industrial action',
        location:'Dublin', lat:53.349, lng:-6.260, radiusKm:8,
        summary:'Reduced service Tue–Thu. Recommend remote-first.' },

      // ── London ──
      { sev:'mod',  type:'Civil Unrest', source:'ACLED',     officeId:'LON',
        title:'Planned protest — Westminster, possible road closures',
        location:'London', lat:51.501, lng:-0.124, radiusKm:3,
        summary:'Multiple groups gathering at Parliament Square 14:00 local. MPS advising avoidance of Whitehall.' },
      { sev:'mod',  type:'Natural Disaster', source:'MeteoAlarm', officeId:'LON',
        title:'Severe winds — gusts to 95 km/h forecast',
        location:'Greater London', lat:51.510, lng:-0.130, radiusKm:50,
        summary:'Yellow wind warning. Possible transit disruption on overground.' },
      { sev:'high', type:'Public Safety', source:'TfL',      officeId:'LON',
        title:'Major Tube disruption — Jubilee & Bakerloo suspended',
        location:'London', lat:51.513, lng:-0.116, radiusKm:5,
        summary:'Power-supply incident at Baker Street. No service expected before 19:00.' },

      // ── Tokyo ──
      { sev:'ext',  type:'Natural Disaster', source:'USGS',  officeId:'TYO',
        title:'M6.1 earthquake — 18km E of Tokyo, depth 32km',
        location:'Tokyo', lat:35.69, lng:140.0, radiusKm:200,
        summary:'Strong shaking reported across Kanto region. Tsunami advisory NOT issued. Structural integrity check recommended.' },
      { sev:'high', type:'Natural Disaster', source:'EMSC',  officeId:'TYO',
        title:'Aftershock M4.8 near Tokyo Bay',
        location:'Tokyo Bay', lat:35.6, lng:140.05, radiusKm:80,
        summary:'Aftershock following earlier M6.1. No new damage reported.' },
      { sev:'mod',  type:'Natural Disaster', source:'GDACS', officeId:'TYO',
        title:'Tropical storm watch — distant approach to Honshu',
        location:'Tokyo', lat:35.68, lng:139.65, radiusKm:300,
        summary:'72h monitoring. Possible service disruption Sun–Mon.' },

      // ── Bengaluru ──
      { sev:'high', type:'Natural Disaster', source:'MeteoAlarm', officeId:'BLR',
        title:'Heavy monsoon flooding — multiple zones',
        location:'Bengaluru', lat:12.97, lng:77.59, radiusKm:30,
        summary:'IMD red alert. Outer Ring Road impassable in stretches. Avoid travel.' },
      { sev:'ext',  type:'Civil Unrest', source:'ACLED',    officeId:'BLR',
        title:'Civil unrest — Whitefield, escalation reported',
        location:'Bengaluru', lat:12.972, lng:77.595, radiusKm:5,
        summary:'Demonstrations turned confrontational. Multiple injuries reported. Avoid Whitefield corridor.' },
      { sev:'mod',  type:'Public Safety', source:'GDELT',   officeId:'BLR',
        title:'Power grid advisory — rolling outages 14:00–18:00',
        location:'Bengaluru', lat:12.95, lng:77.60, radiusKm:25,
        summary:'BESCOM scheduled load-shedding. UPS/generator verification recommended.' },

      // ── Hyderabad ──
      { sev:'mod',  type:'Natural Disaster', source:'NWS',  officeId:'HYD',
        title:'Heat advisory — humidity index 47°C',
        location:'Hyderabad', lat:17.385, lng:78.486, radiusKm:50,
        summary:'Heat index above 47°C through Thursday. Hydration breaks recommended.' },
      { sev:'high', type:'Public Safety', source:'GDELT',   officeId:'HYD',
        title:'Power grid failure — Madhapur sector affected',
        location:'Hyderabad', lat:17.441, lng:78.382, radiusKm:8,
        summary:'Substation fault. Estimated restoration 4–6 hours. UPS verification urgent.' },
      { sev:'low',  type:'Civil Unrest', source:'ACLED',    officeId:'HYD',
        title:'Permitted demonstration — IT Corridor, low activity',
        location:'Hyderabad', lat:17.45, lng:78.38, radiusKm:3,
        summary:'~150 participants, peaceful assembly. No traffic impact expected.' },

      // ── Travel advisories (traveler-targeted) ──
      { sev:'mod',  type:'Travel Advisory', source:'State Dept', officeId:null,
        title:'L3 Reconsider Travel — political volatility',
        location:'Mexico City region', lat:19.4326, lng:-99.1332, radiusKm:0,
        summary:'Crime and kidnapping risk elevated. Affects travelers in Mexico City.' },
      { sev:'high', type:'Civil Unrest', source:'ACLED',    officeId:null,
        title:'Flash protest — central Singapore transit zone',
        location:'Singapore', lat:1.3521, lng:103.8198, radiusKm:3,
        summary:'Crowd aggregation near Raffles Place MRT. Traveler proximity flagged.' },
      { sev:'mod',  type:'Travel Advisory', source:'State Dept', officeId:null,
        title:'L2 Exercise increased caution — UAE',
        location:'Dubai', lat:25.2048, lng:55.2708, radiusKm:0,
        summary:'Routine advisory updated. Affects 1 employee currently in Dubai.' },
      { sev:'high', type:'Natural Disaster', source:'GDACS', officeId:null,
        title:'Typhoon track update — Cat 3 approaching Seoul',
        location:'Seoul', lat:37.5665, lng:126.978, radiusKm:200,
        summary:'Landfall projected 36h. Traveler in region — advise evac or shelter.' },
      { sev:'low',  type:'Travel Advisory', source:'State Dept', officeId:null,
        title:'L1 Exercise normal precautions — Berlin',
        location:'Berlin', lat:52.52, lng:13.405, radiusKm:0,
        summary:'Standard advisory. 1 traveler currently lodged.' },
    ];

    /* Slight per-injection variation: randomize magnitude, AQI, headcount
       in the title/summary so back-to-back identical templates feel distinct. */
    function variantize(t) {
      const c = { ...t };
      if (c.source === 'USGS' && /M\d/.test(c.title)) {
        const m = (4.6 + Math.random() * 1.8).toFixed(1);
        c.title = c.title.replace(/M\d\.\d/, 'M' + m);
        c.sev = parseFloat(m) >= 6.0 ? 'ext' : parseFloat(m) >= 5.2 ? 'high' : 'mod';
      }
      if (/AQI \d/.test(c.title)) {
        const aqi = 130 + Math.floor(Math.random() * 90);
        c.title = c.title.replace(/AQI \d+/, 'AQI ' + aqi);
        c.summary = c.summary.replace(/\d+ \(Unhealthy\)/, aqi + ' (Unhealthy)');
      }
      return c;
    }

    function pickAlert() {
      const wantExtreme = Math.random() < DEMO.extremeChance;
      const filtered = POOL.filter(p => wantExtreme ? p.sev === 'ext' : p.sev !== 'ext');
      const pool = filtered.length ? filtered : POOL;
      const tmpl = pool[Math.floor(Math.random() * pool.length)];
      const v = variantize(tmpl);
      return enrichEventWithImpact({
        ...v,
        id: 'demo-' + Math.random().toString(36).slice(2, 9),
        issued: new Date().toISOString(),
      });
    }

    function injectAlert() {
      if (DEMO.paused) { scheduleNext(); return; }
      const a = pickAlert();
      ALERTS = [a, ...ALERTS];
      DEMO.demoIds.add(a.id);
      // Schedule its removal
      const lifeMs = (DEMO.alertLifetimeSec.min + Math.random() *
        (DEMO.alertLifetimeSec.max - DEMO.alertLifetimeSec.min)) * 1000;
      setTimeout(() => removeAlert(a.id), lifeMs);
      // Trim if we've exceeded the demo cap
      const demoActive = ALERTS.filter(x => DEMO.demoIds.has(x.id));
      while (demoActive.length > DEMO.maxActiveDemo) {
        const oldest = demoActive[demoActive.length - 1];
        removeAlert(oldest.id);
        demoActive.pop();
      }
      renderAll();
      // If Extreme, briefly pulse the status strip (renderAll already handles styling)
      scheduleNext();
    }

    function removeAlert(id) {
      if (!DEMO.demoIds.has(id)) return;
      ALERTS = ALERTS.filter(a => a.id !== id);
      DEMO.demoIds.delete(id);
      renderAll();
    }

    function scheduleNext() {
      const r = DEMO.newAlertEverySec;
      const next = (r.min + Math.random() * (r.max - r.min)) * 1000;
      DEMO.timers.nextAlert = setTimeout(injectAlert, next);
    }

    /* Traveler movement — multi-leg itineraries.
       Every travelerMoveEverySec, a random traveler advances one leg. */
    const TRAVELER_LEGS = {
      t1:  [ {city:'Singapore',     lat:1.3521,  lng:103.8198, type:'hotel',  atOffice:null},
             {city:'Bengaluru',     lat:OFFICE_BY_ID.BLR.lat, lng:OFFICE_BY_ID.BLR.lng, type:'office', atOffice:'BLR'},
             {city:'Hong Kong',     lat:22.3193, lng:114.1694, type:'hotel',  atOffice:null} ],
      t2:  [ {city:'Mexico City',   lat:19.4326, lng:-99.1332, type:'hotel',  atOffice:null},
             {city:'San Francisco', lat:OFFICE_BY_ID.SFO.lat, lng:OFFICE_BY_ID.SFO.lng, type:'office', atOffice:'SFO'},
             {city:'Austin',        lat:30.2672, lng:-97.7431, type:'hotel',  atOffice:null} ],
      t3:  [ {city:'Dubai',         lat:25.2048, lng:55.2708,  type:'hotel',  atOffice:null},
             {city:'London',        lat:OFFICE_BY_ID.LON.lat, lng:OFFICE_BY_ID.LON.lng, type:'office', atOffice:'LON'},
             {city:'Istanbul',      lat:41.0082, lng:28.9784,  type:'hotel',  atOffice:null} ],
      t4:  [ {city:'Paris',         lat:48.8566, lng:2.3522,   type:'hotel',  atOffice:null},
             {city:'Dublin',        lat:OFFICE_BY_ID.DUB.lat, lng:OFFICE_BY_ID.DUB.lng, type:'office', atOffice:'DUB'},
             {city:'Amsterdam',     lat:52.3676, lng:4.9041,   type:'hotel',  atOffice:null} ],
      t5:  [ {city:'Seoul',         lat:37.5665, lng:126.978,  type:'hotel',  atOffice:null},
             {city:'Tokyo',         lat:OFFICE_BY_ID.TYO.lat, lng:OFFICE_BY_ID.TYO.lng, type:'office', atOffice:'TYO'},
             {city:'Taipei',        lat:25.0330, lng:121.5654, type:'hotel',  atOffice:null} ],
      t8:  [ {city:'Berlin',        lat:52.52,   lng:13.405,   type:'hotel',  atOffice:null},
             {city:'Bengaluru',     lat:OFFICE_BY_ID.BLR.lat, lng:OFFICE_BY_ID.BLR.lng, type:'office', atOffice:'BLR'},
             {city:'Munich',        lat:48.1351, lng:11.5820,  type:'hotel',  atOffice:null} ],
      t9:  [ {city:'JFK→LHR',       lat:30.0,    lng:-40.0,    type:'flight', atOffice:null},
             {city:'London',        lat:OFFICE_BY_ID.LON.lat, lng:OFFICE_BY_ID.LON.lng, type:'office', atOffice:'LON'},
             {city:'LHR→PDX',       lat:55.0,    lng:-50.0,    type:'flight', atOffice:null} ],
      t12: [ {city:'Reykjavik',     lat:64.1466, lng:-21.9426, type:'hotel',  atOffice:null},
             {city:'Dublin',        lat:OFFICE_BY_ID.DUB.lat, lng:OFFICE_BY_ID.DUB.lng, type:'office', atOffice:'DUB'},
             {city:'Edinburgh',     lat:55.9533, lng:-3.1883,  type:'hotel',  atOffice:null} ],
    };
    const legCounters = {};

    function moveTraveler() {
      if (DEMO.paused) return;
      const tids = Object.keys(TRAVELER_LEGS);
      const tid = tids[Math.floor(Math.random() * tids.length)];
      const legs = TRAVELER_LEGS[tid];
      legCounters[tid] = ((legCounters[tid] || 0) + 1) % legs.length;
      const leg = legs[legCounters[tid]];
      const idx = TRAVELERS.findIndex(t => t.id === tid);
      if (idx >= 0) {
        const before = TRAVELERS[idx];
        TRAVELERS[idx] = { ...before,
          destCity: leg.city, lat: leg.lat, lng: leg.lng, type: leg.type, atOffice: leg.atOffice };
        // Re-enrich active alerts so traveler-proximity badges refresh
        ALERTS = ALERTS.map(a => enrichEventWithImpact(a));
        renderAll();
        // Toast so the movement is visible to a watching operator
        try { toast(`✈ ${before.name} → ${leg.city}`); } catch (_) {}
      }
    }

    /* DEMO MODE badge — top-right, click to pause/resume */
    function injectBadge() {
      const b = document.createElement('div');
      b.id = 'demo-badge';
      b.style.cssText = [
        'position:fixed', 'top:10px', 'right:14px', 'z-index:9999',
        'background:#7a3aff', 'color:#fff', 'padding:5px 11px',
        'border-radius:14px', 'font:11px/1.4 system-ui,-apple-system,sans-serif',
        'cursor:pointer', 'opacity:0.92', 'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
        'user-select:none', 'letter-spacing:0.3px'
      ].join(';');
      b.textContent = '▶ DEMO MODE';
      b.title = 'Cycling alerts and traveler movement. Click to pause/resume.';
      b.addEventListener('click', () => {
        DEMO.paused = !DEMO.paused;
        b.textContent = DEMO.paused ? '⏸ DEMO PAUSED' : '▶ DEMO MODE';
        b.style.background = DEMO.paused ? '#666' : '#7a3aff';
      });
      document.body.appendChild(b);
    }

    /* Boot */
    // 0. Load mock people-data: office headcounts, travelers, remote employees,
    //    plus ACLED risk rollups for the BCI Country Risk Profile panel.
    //    All four surfaces (Travelers modal, ✈ proximity badges, BCI exposure
    //    readout, office bubbles, alert cards, BCI risk profile) need this to
    //    render with numbers. All four stay empty / undefined in live + bare
    //    Pages mode and the UI shows "pending Workday/Navan/ACLED integration"
    //    placeholders instead.
    OFFICES.forEach(o => { o.headcount = OFFICE_HEADCOUNTS_MOCK[o.id]; });
    // buildEmployees() ran on initial parse with no headcounts (returned []).
    // Now that OFFICES.headcount is populated, rebuild the synthetic employee
    // scatter so map dots / By-Office plotting / Office Manager view all populate.
    EMPLOYEES = buildEmployees();
    TRAVELERS = TRAVELERS_MOCK.slice();
    ACLED_RISK = { ...ACLED_RISK_MOCK };
    WHO_OUTBREAKS = WHO_OUTBREAKS_MOCK.slice();
    REMOTE_EMPLOYEES = REMOTE_EMPLOYEES_MOCK.slice();
    // 1. Enrich existing seed ALERTS so they pass the officeRelevantOnly filter
    ALERTS = ALERTS.map(a => enrichEventWithImpact(a));
    renderAll();
    // 2. Inject the badge
    injectBadge();
    // 3. Seed a few demo alerts in the first ~10s so the cycle is visible immediately
    setTimeout(injectAlert, 1500);
    setTimeout(injectAlert, 5000);
    setTimeout(injectAlert, 9000);
    // 4. Continuous cycling
    scheduleNext();
    setTimeout(moveTraveler, 8000);  // first traveler hop ~8s in so it's visible quickly
    DEMO.timers.travMove = setInterval(moveTraveler, DEMO.travelerMoveEverySec * 1000);
  })();
}

/* =========================================================================
   23. SYNTHETIC TEST SCENARIOS — operator-triggered fixtures
   -------------------------------------------------------------------------
   Activates when the URL carries `#api=mock` (same gate as the demo cycler).
   Adds a small launcher button that opens a modal with three preset
   scenarios. Useful for validating the alert / Crisis Comm / Incident /
   BCI flows end-to-end without waiting for real events.

   Synthetic alerts are tagged with id prefix `test-` so the Clear button
   can remove them in one shot without touching real or demo events
   (which use `demo-` prefix). They flow through the same
   enrichEventWithImpact + ALERTS + renderAll pipeline as everything else,
   so the dashboard treats them identically.
   ========================================================================= */
if (!API_BASE && /[#&]api=mock/.test(location.hash)) {
  (function bootTestScenarios() {
    function syntheticCount() {
      return ALERTS.filter(a => String(a.id).startsWith('test-')).length;
    }

    /* Single top-center container that holds all three mock-mode pills:
       Tests · Clear · DEMO MODE. Built lazily; we move the existing
       demo-badge into it once both IIFEs have run. */
    function ensurePillContainer() {
      let c = document.getElementById('mock-pill-container');
      if (c) return c;
      c = document.createElement('div');
      c.id = 'mock-pill-container';
      c.style.cssText = [
        'position:fixed', 'top:10px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:9999', 'display:flex', 'gap:8px', 'align-items:center',
        'pointer-events:none',  // child elements override; lets clicks pass through gaps
      ].join(';');
      document.body.appendChild(c);
      return c;
    }

    /* Common pill styling — only color/text varies per pill. */
    function pillStyleBase(bg, fg) {
      return [
        `background:${bg}`, `color:${fg}`, 'padding:5px 11px',
        'border-radius:14px', 'font:11px/1.4 system-ui,-apple-system,sans-serif',
        'cursor:pointer', 'opacity:0.92', 'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
        'user-select:none', 'letter-spacing:0.3px', 'font-weight:700',
        'pointer-events:auto',  // re-enable click handling on the pill itself
      ].join(';');
    }

    function refreshClearPill() {
      const existing = document.getElementById('test-clear-pill');
      const n = syntheticCount();
      if (n === 0) {
        if (existing) existing.remove();
        return;
      }
      if (existing) {
        existing.textContent = `🧹 Clear ${n}`;
        return;
      }
      const container = ensurePillContainer();
      const p = document.createElement('div');
      p.id = 'test-clear-pill';
      p.style.cssText = pillStyleBase('#f87171', '#1a0808');
      p.textContent = `🧹 Clear ${n}`;
      p.title = 'Clear all synthetic test events';
      p.addEventListener('click', clearSynthetic);
      // Insert after Tests, before DEMO MODE (if both exist)
      const launcher = document.getElementById('test-launcher');
      if (launcher && launcher.parentNode === container) {
        container.insertBefore(p, launcher.nextSibling);
      } else {
        container.appendChild(p);
      }
    }

    function injectAndRender(alert) {
      const enriched = enrichEventWithImpact(alert);
      ALERTS = [enriched, ...ALERTS.filter(a => a.id !== alert.id)];
      renderAll();
      refreshClearPill();
      try { toast(`🧪 Injected: ${alert.title}`); } catch (_) {}
    }

    // Scenario 1 — Office threat: M6.5 quake 28 km E of SFO
    function fireOfficeThreat() {
      const sfo = OFFICE_BY_ID.SFO;
      injectAndRender({
        id: 'test-office-' + Date.now(),
        sev: 'ext',
        type: 'Natural Disaster',
        source: 'USGS',
        officeId: 'SFO',
        lat: sfo.lat + 0.05,           // ~5 km N
        lng: sfo.lng + 0.30,           // ~25 km E (combined ~28 km)
        radiusKm: 200,
        title: 'M6.5 earthquake — 28 km E of San Francisco, depth 12 km',
        summary: 'Strong shaking reported near Hayward fault. Initial reports of facade damage downtown. No tsunami advisory issued.',
        issued: new Date().toISOString(),
      });
      App.closeModal();
    }

    // Scenario 2 — Traveler threat: civil unrest at a current non-office traveler's city
    function fireTravelerThreat() {
      const t = TRAVELERS.find(tr => !tr.atOffice && tr.type !== 'flight') || TRAVELERS[0];
      if (!t) {
        try { toast('No traveler available for synthetic threat.'); } catch (_) {}
        App.closeModal();
        return;
      }
      injectAndRender({
        id: 'test-traveler-' + Date.now(),
        sev: 'high',
        type: 'Civil Unrest',
        source: 'ACLED',
        officeId: null,
        lat: t.lat,
        lng: t.lng,
        radiusKm: 5,
        title: `Mass demonstration with confrontations — ${t.destCity}`,
        summary: `Multiple injuries reported. Curfew possible in affected districts. Traveler ${t.name} flagged within proximity radius.`,
        issued: new Date().toISOString(),
      });
      App.closeModal();
    }

    // Scenario 3 — BCI declaration: pre-fill the existing BCI modal for a Japan quake
    function fireBciScenario() {
      App.closeModal();
      Object.assign(BCP_FORM, {
        eventTypeId: 'quake',
        title: 'M7.4 earthquake — Tohoku coast, Japan',
        countries: ['Japan'],
        useFence: false,
        templateId: 'bc_announce',
        customMessage: '',
        acknowledged: false,
      });
      showBCPModal(true);   // preserve=true so our pre-fill isn't wiped
      try { toast('🚨 BCI pre-filled — review and Declare'); } catch (_) {}
    }

    // Clear all synthetic events (does not touch demo or real events).
    // Callable from either the in-modal Clear button or the floating pill.
    function clearSynthetic() {
      const before = ALERTS.length;
      ALERTS = ALERTS.filter(a => !String(a.id).startsWith('test-'));
      const removed = before - ALERTS.length;
      renderAll();
      refreshClearPill();
      App.closeModal();   // idempotent — fine when called from the floating pill
      try { toast(`🧹 Cleared ${removed} synthetic event${removed === 1 ? '' : 's'}`); } catch (_) {}
    }

    function openTestModal() {
      const t = TRAVELERS.find(tr => !tr.atOffice && tr.type !== 'flight') || TRAVELERS[0];
      const travelerLabel = t ? `${t.destCity} (${t.name})` : 'no traveler available';
      const html = `<div style="width:min(560px,92vw);">
        <div style="padding:14px 18px;border-bottom:1px solid var(--border);">
          <div style="font-size:15px;font-weight:700;">🧪 Synthetic Test Scenarios</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Mock-mode only. Each scenario injects a tagged event you can clear in one click.</div>
        </div>
        <div style="padding:14px 18px;display:flex;flex-direction:column;gap:10px;">
          <button class="btn-ghost" id="test-office-btn" style="text-align:left;padding:10px 12px;">
            <div style="font-weight:600;">🏢 Office threat — M6.5 near SFO</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Validates Extreme alert card, status-strip wash, impact badges, Crisis Comm pre-fill.</div>
          </button>
          <button class="btn-ghost" id="test-traveler-btn" style="text-align:left;padding:10px 12px;">
            <div style="font-weight:600;">✈ Traveler threat — civil unrest at ${esc(travelerLabel)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Validates traveler-proximity badge and Crisis Comm traveler context. Picks the first non-office traveler at injection time.</div>
          </button>
          <button class="btn-ghost" id="test-bci-btn" style="text-align:left;padding:10px 12px;">
            <div style="font-weight:600;">🚨 BCI declaration — Tohoku M7.4 earthquake (Japan)</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">Pre-fills the BCI modal. Validates exposure readout (TYO + travelers + remote employees in Japan).</div>
          </button>
        </div>
        <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;">
          <button class="btn-ghost" id="test-clear-btn" style="font-size:11px;">🧹 Clear synthetic events</button>
          <button class="btn-ghost" onclick="App.closeModal()">Close</button>
        </div>
      </div>`;
      showModal(html);
      document.getElementById('test-office-btn').onclick   = fireOfficeThreat;
      document.getElementById('test-traveler-btn').onclick = fireTravelerThreat;
      document.getElementById('test-bci-btn').onclick      = fireBciScenario;
      document.getElementById('test-clear-btn').onclick    = clearSynthetic;
    }

    /* Launcher pill — first slot in the shared top-center container. We also
       move the demo simulator's badge into the container here (it was
       absolute-positioned by its own IIFE; we strip those styles and
       re-flow it as a flex child so the three pills line up cleanly). */
    function injectLauncher() {
      const container = ensurePillContainer();

      // Tests pill
      const b = document.createElement('div');
      b.id = 'test-launcher';
      b.style.cssText = pillStyleBase('#06b6d4', '#062c34');
      b.textContent = '🧪 Tests';
      b.title = 'Synthetic test scenarios — Office / Traveler / BCI';
      b.addEventListener('click', openTestModal);
      container.appendChild(b);

      // Adopt the DEMO MODE badge: strip its position:fixed/top/right and
      // make it a flex child so it sits next to the Tests pill.
      const demoBadge = document.getElementById('demo-badge');
      if (demoBadge) {
        demoBadge.style.position = 'static';
        demoBadge.style.top = '';
        demoBadge.style.right = '';
        demoBadge.style.pointerEvents = 'auto';
        container.appendChild(demoBadge);  // re-append moves it to end
      }
    }

    injectLauncher();
  })();
}
