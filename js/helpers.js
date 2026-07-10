/**
 * NRSA / S.T.A.R. View — pure helper utilities.
 *
 * SESSION 2 / Step C1 (2026-06-19): pure helpers (no state references)
 * extracted from legacy-app.js. State-coupled helpers (alertCountryFor,
 * passesFilter, enrichEventWithImpact, ACLED/WHO/hazard helpers, etc.)
 * stay in legacy-app.js for step C2 — those need a separate look at the
 * state.X reference pattern.
 *
 * How callers reach these:
 *   - Other modules: `import { esc, fmtSize, ... } from './helpers.js'`
 *   - legacy-app.js: via `window.X` after main.js does
 *     `Object.assign(window, helpers)` — same pattern as the constants
 *     bridge. No source changes in legacy-app.js itself; bare `esc(text)`
 *     calls there resolve through window.
 *
 * The only constant this module needs is ATT_EMBED_LIMIT (file-size cap
 * for inline data: URL embedding). All other helpers are self-contained
 * or call sibling helpers via module scope.
 */

import {
  ATT_EMBED_LIMIT,
  COUNTRY_PRESENCE,
  IMPACT_RADIUS_DEFAULT_KM,
  OFFICES,
  OFFICE_BY_ID,
  SEV_RANK,
  WHO_COUNTRY_ALIASES,
} from './constants.js';
import { state } from './state.js';

/* ============ Time + random ========================================== */

/** ISO timestamp N minutes in the past. Used for seed alert timestamps and
 *  status-strip "X minutes ago" math. */
export function nowMinus(min) { return new Date(Date.now() - min * 60000).toISOString(); }

/** Random element of an array. */
export function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** Random fictional employee name (First Last) for mock data. */
export function randomName() {
  const F = ['Alex','Maya','Sam','Jordan','Priya','Wei','Noah','Sofia','Liam','Aisha','Ravi','Kim','Ben','Yui','Olu','Mia','Theo','Eve','Hana','Diego','Zara','Ana','Ravi','Tomas','Naomi','Imran','Chen','Kai'];
  const L = ['Patel','Garcia','Lee','Smith','Khan','Nguyen','Brown','Tanaka','OConnor','Müller','Costa','Iyer','Reed','Sato','Park','Davis','Singh','Chen','Yamamoto','Rossi','Adams','Kumar','Wong','Fitzgerald','Romano','Banerjee','Olsen','Cooper','Walsh','Sharma'];
  return rand(F) + ' ' + rand(L);
}

/** Short relative time label ("just now", "5m", "3h", "2d") from an ISO. */
export function relTime(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
}

/** UTC clock string ("HH:MM UTC"). */
export function fmtClock(d = new Date()) { return d.toUTCString().slice(17, 22) + ' UTC'; }

/** Local-id generator for newly created entities (incidents, messages, etc.).
 *  Format `i_xxxxxxx` — distinguishable from server UUIDs by the prefix.
 *  See isLocalIncidentId() in legacy-app.js for the matching predicate. */
export function uid() { return 'i_' + Math.random().toString(36).slice(2, 9); }

/* ============ Geo ===================================================== */

/** Haversine great-circle distance in km between two lat/lng points.
 *  Returns Infinity if any input is null/undefined (defensive — a missing
 *  coordinate shouldn't accidentally match anything via 0-distance). */
export function distanceKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return Infinity;
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ============ Alert priority scoring ================================== */

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
export function alertPriorityScore(a) {
  const sevWeight = { ext: 1000, high: 100, mod: 10, low: 1 };
  const ageHours = Math.max(0, (Date.now() - new Date(a.issued).getTime()) / 3600000);
  return (sevWeight[a.sev] || 1) - ageHours;
}

/** Highest priority score among a list of alerts; -Infinity if empty. */
export function topScore(alerts) {
  if (!alerts.length) return -Infinity;
  return alerts.reduce((m, a) => Math.max(m, alertPriorityScore(a)), -Infinity);
}

/* ============ HTML escaping + linkification =========================== */

/** Escape user-provided strings before injecting into HTML.
 *  Always pass user input through this before concatenating into a template
 *  literal — the dashboard's render functions rely on it for XSS safety. */
export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Auto-linkify http(s) URLs inside escaped text. Pass already-escaped text;
 *  this function does NOT re-escape, only wraps URLs in <a> tags. */
export function linkify(escapedText) {
  if (!escapedText) return '';
  return escapedText.replace(/(https?:\/\/[^\s<>"]+)/g,
    (m) => `<a href="${m}" target="_blank" rel="noopener" class="auto-link">${m}</a>`);
}

/* ============ Formatters ============================================== */

/** File-size formatting (B / KB / MB). Returns '' for null/undefined; '0 B' for 0. */
export function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** Office headcount formatter — em-dash placeholder when undefined (live mode
 *  before Workday integration). Locale-formats numbers when present. */
export function fmtHeadcount(h) { return h == null ? '—' : Number(h).toLocaleString(); }

/** Sum headcounts across an array of offices. Treats missing headcount as 0. */
export function sumHeadcount(offices) { return offices.reduce((s, o) => s + (o.headcount || 0), 0); }

/* ============ Attachment helpers ====================================== */

/** Emoji icon for a MIME type. Falls back to 📎 for anything unrecognized. */
export function fileIcon(type) {
  type = type || '';
  if (type.startsWith('image/')) return '🖼️';
  if (type === 'application/pdf') return '📄';
  if (type.startsWith('video/')) return '🎬';
  if (type.startsWith('audio/')) return '🎵';
  if (type.includes('zip') || type.includes('compressed') || type.includes('archive')) return '📦';
  if (type.includes('word') || type.includes('document')) return '📝';
  if (type.includes('sheet') || type.includes('csv') || type.includes('excel')) return '📊';
  return '📎';
}

/** Read a File into an attachment object. Embeds as data: URL if small
 *  (≤ ATT_EMBED_LIMIT, currently 2MB); larger files are flagged oversized
 *  and persisted with metadata-only (in production they'd upload to backend). */
export function fileToAttachment(file) {
  return new Promise((resolve) => {
    const base = {
      id: 'att_' + Math.random().toString(36).slice(2, 9),
      name: file.name, size: file.size, type: file.type,
    };
    if (file.size > ATT_EMBED_LIMIT) {
      resolve({ ...base, data: null, oversized: true });
      return;
    }
    const reader = new FileReader();
    reader.onload  = () => resolve({ ...base, data: reader.result });
    reader.onerror = () => resolve({ ...base, data: null });
    reader.readAsDataURL(file);
  });
}

/** Render an attachment chip. removable=true when in draft state.
 *  Calls sibling helpers (esc, fmtSize, fileIcon) via module scope. */
export function attachmentChipHTML(att, removable = false) {
  const href = att.data ? att.data : '#';
  const dl = att.data ? `download="${esc(att.name)}"` : '';
  let click = '';
  if (!att.data) {
    if (att._restored) {
      click = `onclick="event.preventDefault();alert('File content not retained across page reload. Metadata preserved (${esc(att.name)}, ${fmtSize(att.size)}). Re-attach the file to send it.');"`;
    } else if (att.oversized) {
      click = `onclick="event.preventDefault();alert('File too large to embed (limit ${fmtSize(ATT_EMBED_LIMIT)}). In production this would be uploaded to a backend.');"`;
    } else {
      click = `onclick="event.preventDefault();"`;
    }
  }
  return `<a class="att-chip${att.oversized ? ' oversized' : ''}${att._restored ? ' restored' : ''}" href="${href}" target="_blank" rel="noopener" ${dl} ${click}>
    <span class="att-icon" aria-hidden="true">${fileIcon(att.type)}</span>
    <span class="att-name">${esc(att.name)}</span>
    ${att.size ? `<span class="att-size">${fmtSize(att.size)}</span>` : ''}
    ${att._restored ? '<span class="att-size" style="color:var(--muted)" title="Restored from local save — file content not retained">↺</span>' : ''}
    ${removable ? `<button class="att-x" data-att-remove="${esc(att.id)}" aria-label="Remove ${esc(att.name)}" title="Remove">×</button>` : ''}
  </a>`;
}

/* ============ Persistence helpers ===================================== */

/** Strip the (potentially huge) data: URL from an attachment, keep metadata.
 *  Run before localStorage save — embedded base64 attachments easily blow
 *  past the 5-10MB localStorage quota. */
export function stripAtt(a) {
  if (!a) return a;
  const { data, ...rest } = a;
  return { ...rest, _restored: !data };  // mark as no-data after persist
}

/** Strip attachments from a message before localStorage save. */
export function stripMessageAtts(m) {
  return { ...m, attachments: (m.attachments || []).map(stripAtt) };
}

/** Strip transient bookkeeping fields (Sprint-5 fire-and-forget state)
 *  from an incident before localStorage write. Restoring _persistPending=true
 *  on next boot would block future API persists on this incident;
 *  _backendResponses is hydration-only; _pendingMessages is the in-flight
 *  message-persist queue from the dispatchSend race fix and would be stale. */
export function stripIncident(i) {
  const { _persistPending, _backendResponses, _pendingMessages, ...rest } = i;
  return {
    ...rest,
    notes:    (rest.notes    || []).map(n => ({ ...n, attachments: (n.attachments || []).map(stripAtt) })),
    messages: (rest.messages || []).map(stripMessageAtts),
  };
}

/* ============ Hazard rollup template ================================== */

/** Empty hazard rollup with all keys zeroed and travelAdvisoryLevel null.
 *  Shape consumers fill in via liveHazardsForCountry / aggregations. */
export function _emptyHazardRollup() {
  return {
    travelAdvisoryLevel: null,   // 'L1' | 'L2' | 'L3' | 'L4' | null
    severeWeather: 0,            // NWS / MeteoAlarm severe warnings
    gdacsActive: 0,              // GDACS Orange/Red active
    earthquakes: 0,              // USGS / EMSC seismic events
    wildfires: 0,                // wildfire-tagged alerts
    volcanoes: 0,                // volcano-tagged alerts
    civilUnrest: 0,              // ACLED-style or Civil Unrest type
    publicSafety: 0,             // Public Safety type catch-all
    total: 0,                    // sum of all counts (excl advisory level)
  };
}

/* =========================================================================
   STATE-COUPLED HELPERS — extracted in session 2 / step C2 (2026-06-19).

   Function bodies reference state-bearing identifiers (ALERTS, STATE,
   TRAVELERS, WHO_OUTBREAKS, ACLED_RISK) and constants (OFFICES, OFFICE_BY_ID,
   COUNTRY_PRESENCE, SEV_RANK, etc.) as bare globals. Both groups are
   bridged onto window by main.js — state via getter/setter for
   reassignable identifiers, constants via Object.assign. Module-side
   lookup falls through to window for undeclared identifiers, so the
   bare references resolve correctly at call time.

   Sibling helper references (e.g., outbreaksAggregated calling
   outbreaksForCountry, liveHazardsForCountry calling _emptyHazardRollup)
   resolve through module scope — every helper is an export in this
   same file. SEV_TO_LEVEL and LEVEL_RANK constants in liveHazards*
   are local to those functions and stay unchanged.
   ========================================================================= */

// Bridge-cleanup pilot (2026-07-03): converted from bare-window read to
// explicit `import { OFFICES } from './constants.js'`. Same runtime value
// (constants module was already bridged onto window via main.js step 5) but
// now static-analyzable — a typo like `OFFICEs` would be caught by lint.
export function hasOfficeHeadcounts() {
  return OFFICES.some(o => o.headcount != null);
}

// Bridge-cleanup pilot: `ACLED_RISK` bare read → `state.ACLED_RISK`. The
// bridge in main.js still exposes window.ACLED_RISK for legacy-app.js's
// bare references; this module now reaches the same object directly.
export function hasAcledRisk() {
  return Object.keys(state.ACLED_RISK).length > 0;
}

// Bridge-cleanup batch B (2026-07-03): ACLED_RISK bare read → state.ACLED_RISK.
export function aggregateAcledRisk(countryNames) {
  const totals = { battles: 0, vac: 0, explosions: 0, riots: 0, strategicDev: 0, fatalities: 0, totalEvents: 0 };
  for (const name of countryNames) {
    const r = state.ACLED_RISK[name];
    if (!r) continue;
    totals.battles      += r.battles      || 0;
    totals.vac          += r.vac          || 0;
    totals.explosions   += r.explosions   || 0;
    totals.riots        += r.riots        || 0;
    totals.strategicDev += r.strategicDev || 0;
    totals.fatalities   += r.fatalities   || 0;
  }
  totals.totalEvents = totals.battles + totals.vac + totals.explosions + totals.riots + totals.strategicDev;
  return totals;
}

// Bridge-cleanup pilot: `WHO_COUNTRY_ALIASES` bare read → explicit import.
export function normalizeWhoCountry(name) {
  return WHO_COUNTRY_ALIASES[name] || name;
}

// Bridge-cleanup batch B: WHO_OUTBREAKS bare reads → state.WHO_OUTBREAKS for
// both fns below. `normalizeWhoCountry` inside outbreaksForCountry is a
// sibling helper — module-local resolution, unchanged.
export function hasWhoOutbreaks() {
  return state.WHO_OUTBREAKS.length > 0;
}

export function outbreaksForCountry(countryName) {
  return state.WHO_OUTBREAKS.filter(o => normalizeWhoCountry(o.country) === countryName);
}

export function outbreaksAggregated(countryNames) {
  const all = [];
  for (const name of countryNames) {
    for (const o of outbreaksForCountry(name)) all.push(o);
  }
  return all;
}

// Bridge-cleanup batch C (2026-07-03): OFFICE_BY_ID + COUNTRY_PRESENCE
// bare reads → explicit constants imports. Detection-critical function —
// verified by tests/proximity-detection.spec.ts.
export function alertCountryFor(alert) {
  if (!alert) return null;
  if (alert.officeId) {
    const o = OFFICE_BY_ID[alert.officeId];
    if (o) return o.country;
  }
  if (Array.isArray(alert.affectedOfficeIds) && alert.affectedOfficeIds.length > 0) {
    const o = OFFICE_BY_ID[alert.affectedOfficeIds[0]];
    if (o) return o.country;
  }
  // Fall back to text match against known countries (case-insensitive)
  const haystack = ((alert.location || '') + ' ' + (alert.title || '')).toLowerCase();
  for (const cp of COUNTRY_PRESENCE) {
    if (haystack.includes(cp.name.toLowerCase())) return cp.name;
  }
  return null;
}

// Bridge-cleanup batch C: COUNTRY_PRESENCE bare → import; TRAVELERS bare →
// state.TRAVELERS. `alertCountryFor` is a sibling — module-local, unchanged.
// Detection-critical — verified by tests/proximity-detection.spec.ts.
export function relevanceTierOf(alert) {
  if (!alert) return null;
  if ((alert.affectedOfficeIds || []).length > 0) return 'direct';
  if ((alert.affectedTravelers  || []).length > 0) return 'direct';
  const country = alertCountryFor(alert);
  if (country) {
    if (COUNTRY_PRESENCE.some(cp => cp.name === country)) return 'indirect';
    if (state.TRAVELERS.some(t => t.country === country)) return 'indirect';
  }
  if (alert.sev === 'ext') return 'watch';
  return null;
}

export function liveHazardsForCountry(countryName) {
  const out = _emptyHazardRollup();
  if (!countryName) return out;
  const SEV_TO_LEVEL = { low: 'L1', mod: 'L2', high: 'L3', ext: 'L4' };
  const LEVEL_RANK = { L1: 1, L2: 2, L3: 3, L4: 4 };

  for (const a of ALERTS) {
    if (alertCountryFor(a) !== countryName) continue;
    const src = (a.source || '').toLowerCase();
    const ttl = (a.title  || '').toLowerCase();

    if (a.type === 'Travel Advisory') {
      const lvl = SEV_TO_LEVEL[a.sev] || 'L1';
      if (!out.travelAdvisoryLevel || LEVEL_RANK[lvl] > LEVEL_RANK[out.travelAdvisoryLevel]) {
        out.travelAdvisoryLevel = lvl;
      }
      continue;
    }

    if (a.type === 'Civil Unrest') { out.civilUnrest++; out.total++; continue; }
    if (a.type === 'Public Safety') { out.publicSafety++; out.total++; continue; }

    // Natural Disaster — sub-categorize by source / title keyword
    if (src === 'usgs' || src === 'emsc' || /earthquake|quake|m\d\.\d/.test(ttl)) {
      out.earthquakes++; out.total++;
    } else if (/volcano/.test(ttl) || /volcano/.test(a.type || '')) {
      out.volcanoes++; out.total++;
    } else if (/wildfire|fire/.test(ttl)) {
      out.wildfires++; out.total++;
    } else if (src === 'gdacs' && (a.sev === 'high' || a.sev === 'ext')) {
      out.gdacsActive++; out.total++;
    } else if (src === 'nws' || src === 'meteoalarm') {
      out.severeWeather++; out.total++;
    } else {
      // Catch-all natural disaster — count toward weather as the closest bucket
      out.severeWeather++; out.total++;
    }
  }
  return out;
}

export function liveHazardsAggregated(countryNames) {
  const totals = _emptyHazardRollup();
  const LEVEL_RANK = { L1: 1, L2: 2, L3: 3, L4: 4 };
  for (const name of countryNames) {
    const r = liveHazardsForCountry(name);
    totals.severeWeather += r.severeWeather;
    totals.gdacsActive   += r.gdacsActive;
    totals.earthquakes   += r.earthquakes;
    totals.wildfires     += r.wildfires;
    totals.volcanoes     += r.volcanoes;
    totals.civilUnrest   += r.civilUnrest;
    totals.publicSafety  += r.publicSafety;
    totals.total         += r.total;
    if (r.travelAdvisoryLevel) {
      if (!totals.travelAdvisoryLevel ||
          LEVEL_RANK[r.travelAdvisoryLevel] > LEVEL_RANK[totals.travelAdvisoryLevel]) {
        totals.travelAdvisoryLevel = r.travelAdvisoryLevel;
      }
    }
  }
  return totals;
}

export function maxSevForOffice(officeId) {
  const a = activeAlertsForOffice(officeId);
  if (!a.length) return null;
  return SEVERITY[Math.max(...a.map(x => SEV_RANK[x.sev]-1))];
}

export function activeAlertsForOffice(id) {
  return ALERTS.filter(a => a.officeId === id && passesFilter(a));
}

// Bridge-cleanup batch C: IMPACT_RADIUS_DEFAULT_KM and OFFICE_BY_ID bare
// → explicit constants imports (OFFICES was already imported in the pilot).
// TRAVELERS bare → state.TRAVELERS. distanceKm and relevanceTierOf are
// sibling helpers — module-local, unchanged.
// Detection-critical — verified by tests/proximity-detection.spec.ts.
export function enrichEventWithImpact(e) {
  const radiusKm = e.radiusKm > 0 ? e.radiusKm : (IMPACT_RADIUS_DEFAULT_KM[e.type] || 100);
  const affectedTravelers = state.TRAVELERS.filter(t =>
    distanceKm(e.lat, e.lng, t.lat, t.lng) <= radiusKm
  ).map(t => t.id);
  // Office-headcount impact: any office within radius (in addition to backend's affectedOfficeIds)
  const officeMatches = OFFICES.filter(o =>
    distanceKm(e.lat, e.lng, o.lat, o.lng) <= radiusKm
  ).map(o => o.id);
  const allOfficeIds = Array.from(new Set([
    ...(e.affectedOfficeIds || []),
    ...officeMatches,
  ]));
  const totalEmployeesAffected = allOfficeIds.reduce((sum, id) => sum + ((OFFICE_BY_ID[id]?.headcount) || 0), 0);
  const enriched = {
    ...e,
    affectedOfficeIds:    allOfficeIds,
    officeId:             e.officeId || allOfficeIds[0] || null,
    affectedTravelers,
    totalEmployeesAffected,
  };
  // Three-tier relevance classification — see relevanceTierOf for semantics.
  // Cached here so the feed render + sort can read enriched.relevanceTier
  // directly. isRelevant retains its semantic of "show in feed by default" =
  // direct OR indirect; watch and null are hidden until 🌐 All is toggled on.
  enriched.relevanceTier = relevanceTierOf(enriched);
  enriched.isRelevant    = enriched.relevanceTier === 'direct' || enriched.relevanceTier === 'indirect';
  return enriched;
}

// Bridge-cleanup batch B: SEV_RANK bare read → explicit import. STATE bare
// read → state.UI_STATE (5 references). The 5 filter checks — sev-min,
// visible types, visible offices, officeRelevantOnly, search — all now
// resolve their state through the module import.
export function passesFilter(a) {
  const S = state.UI_STATE;
  if (SEV_RANK[a.sev] < SEV_RANK[S.filterMinSev]) return false;
  if (!S.visibleAlertTypes.includes(a.type)) return false;
  if (a.officeId && !S.visibleOffices.includes(a.officeId)) return false;
  if (S.officeRelevantOnly && !a.isRelevant) return false;
  if (S.search && !(a.title+' '+a.location+' '+a.summary).toLowerCase().includes(S.search.toLowerCase())) return false;
  return true;
}

// Bridge-cleanup batch B: ALERTS bare read → state.ALERTS. passesFilter is
// a sibling — module-local, unchanged.
export function visibleAlerts() { return state.ALERTS.filter(passesFilter); }

// Bridge-cleanup batch B: TRAVELERS bare read → state.TRAVELERS.
export function travelersAtOffice(id) { return state.TRAVELERS.filter(t => t.atOffice === id); }

export function allTargets() {
  // Offices + custom locations available for selection
  return [...OFFICES.map(o => ({ id:o.id, name:o.name, kind:'office', headcount:o.headcount })),
          ...STATE.customLocations.map(c => ({ id:c.id, name:c.name, kind:'custom', headcount:0 }))];
}

export function targetById(id) { return allTargets().find(t => t.id === id); }

export function recipientsForChannel(ch, ids) {
  return ids.map(id => {
    const t = targetById(id); if (!t) return null;
    if (ch === 'slack') return `#nr-safety-${t.id.toLowerCase()}`;
    if (ch === 'email') return `${t.id.toLowerCase()}-safety@newrelic.com`;
    if (ch === 'sms')   return `${fmtHeadcount(t.headcount)} numbers`;
    return null;
  }).filter(Boolean);
}

export function allTemplates() {
  return [
    ...Object.entries(TEMPLATES).map(([k,t]) => ({
      id:k, name:t.name, body:t.body, category:t.category, priority:t.priority||99, builtin:true,
    })),
    ...STATE.userTemplates.map(t => ({
      id:t.id, name:t.name, body:t.body, category:'custom', priority:99, builtin:false,
    })),
  ];
}

export function suggestTemplate(alert) {
  if (!alert) return 'check';
  const title  = (alert.title || '').toLowerCase();
  const type   = alert.type   || '';
  const source = (alert.source || '').toLowerCase();

  // 1. Title-keyword overrides (most specific)
  if (/\b(active shooter|armed (?:assailant|gunman)|hostage|gunfire|shooting)\b/.test(title))
    return 'shelter_active_threat';
  if (/\b(bomb threat|suspicious package|ied|explosive device)\b/.test(title))
    return 'evac_bomb';
  if (/\b(terror|terrorist|mass[-\s]?casualty)\b/.test(title))
    return 'bc_announce_terror';
  if (/\b(wildfire|structure fire|fire evacuation|smoke advisory|fire warning)\b/.test(title))
    return 'evac_fire';
  if (/\btornado\b/.test(title))
    return 'shelter_severe_weather';

  // 2. Type + source heuristics
  if (type === 'Natural Disaster') {
    // Earthquake signals: USGS/EMSC adapters always quake; GDACS/EONET may include
    if (source === 'usgs' || source === 'emsc' || /\b(earthquake|quake|seismic|m\d\.\d)\b/.test(title))
      return 'shelter_quake';
    // Severe weather: NWS Warnings, MeteoAlarm, GDACS tropical cyclone
    if (source === 'nws' || source === 'meteoalarm' ||
        /\b(severe thunderstorm|hurricane|cyclone|typhoon|flash flood|storm warning)\b/.test(title))
      return 'shelter_severe_weather';
    // Volcano / flood / wildfire fall through to evac_fire above; otherwise generic shelter
    return 'shelter';
  }

  if (type === 'Civil Unrest') {
    // Traveler-only context (no office in radius but traveler is) → traveler check
    if (alert.affectedTravelers && alert.affectedTravelers.length > 0 && !alert.officeId)
      return 'check_traveler';
    return 'shelter_civil_unrest';
  }

  if (type === 'Public Safety') {
    // Default to shelter — Public Safety covers broad ground (police incidents,
    // utility outages, transit disruption). Operator will refine.
    return 'shelter';
  }

  if (type === 'Travel Advisory') {
    return 'travel_advisory';
  }

  // 3. Traveler-only context fallback (any type)
  if (alert.affectedTravelers && alert.affectedTravelers.length > 0 && !alert.officeId)
    return 'check_traveler';

  // 4. Final fallback
  return 'check';
}

