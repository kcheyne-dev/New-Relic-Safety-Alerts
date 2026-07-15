/**
 * NRSA / S.T.A.R. View — module constants.
 *
 * Pure-data reference values for the dashboard. No runtime dependencies on
 * Leaflet (`L`), `STATE`, or any other live module — safe to import at the
 * top of any module's load.
 *
 * SESSION-1 STATUS (2026-06-18): this file is a SHADOW of the inline `const`
 * definitions in `index.html`. Both copies exist intentionally during session
 * 1 of the modularization (see docs/modularization-session-1.md and
 * docs/modularization-plan.md). Session 2 will:
 *   1. Wire this module into the bootstrap (`<script type="module">`)
 *   2. Remove the corresponding inline definitions in index.html
 *   3. Replace inline references with `import { ... } from './constants.js'`
 *
 * UNTIL SESSION 2 LANDS: any change to a constant must be made in BOTH
 * places. The runtime reads the inline copy in index.html; this module is
 * dormant. Drift here would silently swap defaults the moment session 2
 * removes the inline copy, so keep them mirrored.
 */

/* ============ Severity ================================================ */

export const SEVERITY = ['low','mod','high','ext'];
export const SEV_RANK  = { low:1, mod:2, high:3, ext:4 };
export const SEV_NAME  = { low:'Low', mod:'Moderate', high:'High', ext:'Extreme' };
export const SEV_COLOR = { low:'#4ade80', mod:'#facc15', high:'#fb923c', ext:'#f87171' };

/* ============ Alert types + sources =================================== */

export const ALERT_TYPES = ['Natural Disaster','Civil Unrest','Public Safety','Travel Advisory'];

export const SOURCES = [
  { id:'NWS',         name:'National Weather Service',       type:'Natural Disaster', status:'ok',    url:'https://www.weather.gov/' },
  { id:'USGS',        name:'US Geological Survey',           type:'Natural Disaster', status:'ok',    url:'https://earthquake.usgs.gov/earthquakes/map/' },
  { id:'EMSC',        name:'European Med Seismological Ctr', type:'Natural Disaster', status:'ok',    url:'https://www.emsc-csem.org/Earthquake/' },
  { id:'NASA EONET',  name:'Earth Observatory',              type:'Natural Disaster', status:'ok',    url:'https://eonet.gsfc.nasa.gov/' },
  { id:'GDACS',       name:'Global Disaster Alert',          type:'Natural Disaster', status:'ok',    url:'https://www.gdacs.org/' },
  // ACLED / GDELT / Flashalert removed 2026-07-13 — see docs/data-sources.md § Archived sources.
  { id:'Socrata',     name:'SF Open Data — Police',          type:'Public Safety',    status:'ok',    url:'https://data.sfgov.org/Public-Safety/Police-Department-Incident-Reports/wg3w-h783' },
  { id:'ArcGIS APD',  name:'Atlanta Police Department',      type:'Public Safety',    status:'ok',    url:'https://opendata.atlantapd.org/' },
  { id:'FEMA IPAWS',  name:'FEMA Public Alert System',       type:'Public Safety',    status:'error', url:'https://www.fema.gov/emergency-managers/practitioners/integrated-public-alert-warning-system' },
  { id:'State Dept',  name:'US Travel Advisory',             type:'Travel Advisory',  status:'ok',    url:'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html' },
  { id:'MeteoAlarm',  name:'European Weather Warnings',      type:'Natural Disaster', status:'ok',    url:'https://www.meteoalarm.org/' },
  { id:'OpenWeatherMap', name:'Live Weather',                type:'Natural Disaster', status:'ok',    url:'https://openweathermap.org/' },
  { id:'OpenAQ',      name:'Air Quality',                    type:'Natural Disaster', status:'stale', url:'https://openaq.org/' },
];

/* ============ Offices ================================================= */

export const OFFICES = [
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

export const OFFICE_BY_ID = Object.fromEntries(OFFICES.map(o => [o.id, o]));

/* ============ Country presence ======================================== */

export const COUNTRY_PRESENCE = [
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

/* ============ WHO country alias map =================================== */

export const WHO_COUNTRY_ALIASES = {
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

/* ============ Role styling ============================================ */

export const ROLE_TAG_STYLE = {
  admin:    { bg: 'var(--green)',  fg: '#062c1f',      label: 'Admin' },
  cmt:      { bg: 'var(--blue)',   fg: '#fff',         label: 'CMT Member' },
  office:   { bg: 'var(--yellow)', fg: '#1f1c00',      label: 'Office Manager' },
  employee: { bg: 'var(--bg3)',    fg: 'var(--muted)', label: 'Employee' },
};

/* ============ Crisis Comms templates ================================== */

export const TEMPLATE_CATEGORIES = [
  { id: 'shelter',     label: 'Shelter in Place' },
  { id: 'evacuate',    label: 'Evacuation' },
  { id: 'checkin',     label: 'Safety Check-in' },
  { id: 'allclear',    label: 'All Clear' },
  { id: 'bc_announce', label: 'BC Announcement' },
  { id: 'bc_checkin',  label: 'BC Check-in' },
  { id: 'bc_closure',  label: 'Office Closure' },
  { id: 'travel',      label: 'Travel' },
];

export const TEMPLATES = {
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

/* ============ BCI event types ========================================= */

export const BCP_EVENT_TYPES = [
  { id:'terror',    label:'Terrorist incident',          titleHint:'Terror incident — ' },
  { id:'masscas',   label:'Mass-casualty event',         titleHint:'Mass-casualty event — ' },
  { id:'quake',     label:'Major earthquake',            titleHint:'Major earthquake — ' },
  { id:'hurricane', label:'Hurricane / Typhoon',         titleHint:'Hurricane — ' },
  { id:'civil',     label:'Civil collapse / unrest',     titleHint:'Civil unrest — ' },
  { id:'transit',   label:'Mass transit failure',        titleHint:'Transit disruption — ' },
  { id:'geopol',    label:'Geopolitical escalation',     titleHint:'Geopolitical event — ' },
  { id:'other',     label:'Other / Custom',              titleHint:'' },
];

/* ============ Hazard map zones ======================================== */

export const HAZARD_ZONES = {
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
export const TILE_OVERLAYS = {
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

/* ============ Default impact radii (used when alert has no explicit one) */

export const IMPACT_RADIUS_DEFAULT_KM = {
  'Natural Disaster': 100,
  'Civil Unrest':     50,
  'Public Safety':    25,
  'Travel Advisory':  300,
};

/* ============ Backend → frontend category mapping ===================== */

export const BACKEND_TYPE_TO_CATEGORY = {
  earthquake: 'Natural Disaster', tropical_cyclone: 'Natural Disaster',
  severe_storm: 'Natural Disaster', tornado_warning: 'Natural Disaster',
  flood: 'Natural Disaster', flood_warning: 'Natural Disaster',
  wildfire: 'Natural Disaster', volcano: 'Natural Disaster',
  drought: 'Natural Disaster', snow: 'Natural Disaster',
  winter_storm: 'Natural Disaster', temp_extreme: 'Natural Disaster',
  dust: 'Natural Disaster', sea_lake_ice: 'Natural Disaster',
  water_color: 'Natural Disaster',
  travel_advisory: 'Travel Advisory',
  transit_disruption: 'Public Safety',
  manmade: 'Civil Unrest',
};

export const BACKEND_CATEGORY_TO_LABEL = {
  natural:        'Natural Disaster',
  civil:          'Civil Unrest',
  public_safety:  'Public Safety',
  travel:         'Travel Advisory',
  health:         'Public Safety',  // best fallback — no dedicated UI bucket
};

export const SOURCE_ID_TO_CATEGORY = {
  usgs:           'Natural Disaster',
  nws:            'Natural Disaster',
  emsc:           'Natural Disaster',
  eonet:          'Natural Disaster',
  gdacs:          'Natural Disaster',
  meteoalarm:     'Natural Disaster',
  state_dept:     'Travel Advisory',
  sf_police:      'Public Safety',
  atl_apd:        'Public Safety',
  london_tfl:     'Public Safety',
  // pdx_flashalert / gdelt / acled removed 2026-07-13 — see docs/data-sources.md § Archived sources.
  who_don:        'Public Safety',
};

/* ============ Storage keys + behavior tunables ======================== */

export const TOKEN_KEY = 'nrsa-jwt';
export const PERSIST_KEY = 'nrsa-state-v1';
export const PERSIST_DEBOUNCE_MS = 500;
export const ATT_EMBED_LIMIT = 2 * 1024 * 1024;   // 2 MB
export const PANEL_MIN_W = 280;
export const PANEL_MAX_W = 600;

/* ============ Test-message routing (added 2026-06-18) ================= */

/**
 * When STATE.isTest is true at dispatch, the message is routed exclusively
 * to these endpoints regardless of the office picker, AND the body is
 * prefixed with the drill-warning preamble below. The Slack / email / SMS
 * integrations are still simulated stubs in this build, but encoding the
 * routing here means: when those integrations land, the dispatcher already
 * knows where to send a test (and where NOT to send it) without touching
 * compose UI again.
 *
 * Operator override path: if a per-environment test channel needs to differ
 * (e.g., a separate Slack workspace for staging), set window.NRSA_TEST_ROUTING
 * before script load.
 */
export const TEST_ROUTING = (typeof window !== 'undefined' && window.NRSA_TEST_ROUTING) || {
  slack: '#cmt-test-channel',
  email: 'cmt-test-distro@newrelic.com',
  sms:   null,                             // SMS test routing intentionally absent
};

export const TEST_PREFIX_SUBJECT = '[TEST] ';
export const TEST_PREFIX_BODY = '🧪 TEST DRILL — DO NOT ACT — this message was sent in drill mode and is logged with isTest=true. Real recipients should disregard.\n\n';
