/**
 * NRSA / S.T.A.R. View — mock fixture data for #api=mock + bare-Pages demos.
 *
 * Imported only by demo.js (which is itself only loaded under #api=mock or
 * bare GitHub Pages). In live mode, none of these values reach STATE — the
 * dashboard renders "pending Workday/Navan/ACLED integration" placeholders
 * instead of fake numbers. The discipline matters: when real integrations
 * land (Workday for office headcounts + remote employees, Navan for
 * travelers, ACLED for civil-unrest rollups), the swap is data-only.
 *
 * SESSION-1 STATUS (2026-06-18): SHADOW module. Both this file and the
 * inline definitions in `index.html` (around lines 5060–5237) coexist
 * during session 1 — the runtime reads inline; this module is dormant.
 * Session 2 will wire the imports + drop the inline copies. Until then,
 * any change must be mirrored in BOTH places. See
 * docs/modularization-session-1.md for the wire-up plan.
 *
 * Numbers are illustrative — not factual. Real numbers swap in via the
 * respective integrations.
 */

import { OFFICE_BY_ID } from './constants.js';

/* ============ Module-private helpers ===================================
 * Tiny utilities used by the REMOTE_EMPLOYEES_MOCK IIFE. Mirror the inline
 * definitions in index.html (currently at lines 594–599). These will move
 * to `helpers.js` in session 2, at which point this file imports them
 * instead of redefining locally. */

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function randomName() {
  const F = ['Alex','Maya','Sam','Jordan','Priya','Wei','Noah','Sofia','Liam','Aisha','Ravi','Kim','Ben','Yui','Olu','Mia','Theo','Eve','Hana','Diego','Zara','Ana','Ravi','Tomas','Naomi','Imran','Chen','Kai'];
  const L = ['Patel','Garcia','Lee','Smith','Khan','Nguyen','Brown','Tanaka','OConnor','Müller','Costa','Iyer','Reed','Sato','Park','Davis','Singh','Chen','Yamamoto','Rossi','Adams','Kumar','Wong','Fitzgerald','Romano','Banerjee','Olsen','Cooper','Walsh','Sharma'];
  return rand(F) + ' ' + rand(L);
}

/* ============ Office headcounts ======================================== */

/* Mock office headcounts — applied onto OFFICES at demo bootstrap. Live +
 * bare Pages leave o.headcount undefined and the UI shows
 * "pending Workday integration" placeholders. Office identity itself
 * (location, address, name) is real and lives in OFFICES (constants.js). */
export const OFFICE_HEADCOUNTS_MOCK = {
  SFO: 412, PDX: 188, ATL: 262,
  BCN: 142, DUB: 217, LON: 305,
  TYO: 96,  BLR: 512, HYD: 484,
};

/* ============ Travelers ================================================
 * Mock travelers — populated only in demo mode. Live + bare Pages keep
 * TRAVELERS = [] and the Travelers modal / BCI exposure readout show
 * "Pending Navan integration" placeholders instead of fake names.
 * Companion to REMOTE_EMPLOYEES_MOCK below; same pattern. */

export const TRAVELERS_MOCK = [
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

/* ============ Remote employees =========================================
 * Mock remote employees — populated only in demo mode. Live + bare Pages
 * keep REMOTE_EMPLOYEES = [] and the BCI modal shows
 * "Remote employees: pending Workday integration" instead of a count.
 *
 * NOTE: This is computed by an IIFE at module-load time using rand() +
 * randomName() above. Each load produces a fresh randomized list. That's
 * also how the inline copy works — the names are not deterministic but the
 * country/city distribution is fixed. */
export const REMOTE_EMPLOYEES_MOCK = (() => {
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

/* ============ ACLED civil-unrest rollups ==============================
 * Mock ACLED country risk rollups — last 30 days of vetted civil-unrest /
 * armed-conflict events per country. Populated only in demo mode. Live +
 * bare Pages keep ACLED_RISK = {} and the BCI modal shows "pending ACLED
 * license & integration" placeholder.
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
export const ACLED_RISK_MOCK = {
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

/* ============ WHO disease outbreaks ====================================
 * Mock WHO Disease Outbreak News — active disease outbreaks the operator
 * should know about when assessing country risk. Populated only in demo
 * mode. Live + bare Pages: WHO_OUTBREAKS = [] (the Live Hazards row is
 * conditionally rendered, so no explicit placeholder needed).
 *
 * Source pattern: the real WHO Disease Outbreak News feed is at
 *   https://www.who.int/emergencies/disease-outbreak-news/
 * and publishes a structured RSS. The backend adapter (`who_don.ts`)
 * fetches + parses + persists; this mock matches that adapter's schema so
 * the swap is data-only, not UI work.
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
 * WHO adapter ships. */

export const WHO_OUTBREAKS_MOCK = [
  { country:'Yemen',       disease:'Cholera',         severity:'high', cases:14820, since:'2025-11-15', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Active cholera transmission across 8 governorates; treatment centers stretched.' },
  { country:'Sudan',       disease:'Cholera',         severity:'high', cases:8421,  since:'2026-02-08', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Cholera outbreak driven by displacement and damaged water infrastructure.' },
  { country:'Sudan',       disease:'Measles',         severity:'mod',  cases:2104,  since:'2026-03-22', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Measles among under-5 children in IDP camps; vaccination campaigns underway.' },
  { country:'India',       disease:'Nipah virus',     severity:'high', cases:18,    since:'2026-04-30', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Localized Nipah cluster in Kerala; contact tracing active. 6 fatalities.' },
  { country:'Brazil',      disease:'Dengue',          severity:'mod',  cases:412000,since:'2026-01-12', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Major dengue season; SP and RJ states reporting elevated transmission.' },
  { country:'Mexico',      disease:'Dengue',          severity:'mod',  cases:78400, since:'2026-04-08', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Dengue activity above 5-year average; coastal states most affected.' },
  { country:'USA',         disease:'Measles',         severity:'low',  cases:121,   since:'2026-03-04', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'Multi-state measles clusters; under-vaccinated communities.' },
  { country:'Australia',   disease:'Japanese encephalitis', severity:'low', cases:14, since:'2026-04-18', link:'https://www.who.int/emergencies/disease-outbreak-news/', summary:'JE virus expansion in NSW/VIC; rural exposure risk.' },
];
