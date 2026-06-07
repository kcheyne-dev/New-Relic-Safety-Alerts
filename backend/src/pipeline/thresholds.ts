import type { Severity } from '../types.js';

/**
 * Per-source severity thresholds — turns raw feed signals into one of:
 *   - drop  (pass: false)
 *   - keep with assigned severity, possibly gated on office proximity
 *
 * Spec & rationale: docs/severity-thresholds.md
 *
 * Tuning principle: TIGHT for low-sev (drop noise), LOOSE for high-sev
 * (never miss a real event). High-sev rows pass globally with zero gating;
 * borderline rows get `requiresProximityKm` to defer the keep/drop decision
 * to persist.ts where PostGIS can answer "is this near any office?".
 */

export interface ThresholdOutcome {
  /** false → adapter drops this event entirely. */
  pass: boolean;
  /** Severity to apply when pass=true. Overrides whatever the adapter computed. */
  severity?: Severity;
  /**
   * If set, persist.ts will drop the event after PostGIS office match if
   * no office is within this radius. Used for borderline rows that only
   * clear the bar when geographically close to a hub.
   */
  requiresProximityKm?: number;
  /** Short reason — surfaced in adapter logs so we can audit drops. */
  reason: string;
}

const KEEP = (severity: Severity, reason: string, requiresProximityKm?: number): ThresholdOutcome =>
  ({ pass: true, severity, reason, ...(requiresProximityKm ? { requiresProximityKm } : {}) });

const DROP = (reason: string): ThresholdOutcome => ({ pass: false, reason });

// ----------------------------------------------------------------------------
// Tuning constants — collected here so a future operator can adjust without
// hunting through each per-source function.
// ----------------------------------------------------------------------------

export const PROXIMITY = {
  earthquakeShallow: 250,   // M4.5–4.9 shallow quakes need an office this close
  earthquakeMid:     500,   // M5.0–5.4 quakes need an office this close
  eonet:             250,   // wildfires / floods / severeStorms / earthquakes
  acledZeroFat:      500,   // 0-fatality battles / explosions / VAC
} as const;

// ----------------------------------------------------------------------------
// USGS / EMSC — earthquakes
// ----------------------------------------------------------------------------

/**
 * Earthquake threshold rule. Used by both USGS and EMSC adapters since
 * the magnitude/depth signals are the same.
 *
 * Spec: docs/severity-thresholds.md#usgs--emsc--earthquakes
 */
export function evaluateEarthquake(opts: {
  magnitude: number;
  depthKm: number | null;
}): ThresholdOutcome {
  const { magnitude: m, depthKm } = opts;
  if (!Number.isFinite(m)) return DROP('non-finite magnitude');
  if (m >= 6.5) return KEEP('ext',  'M6.5+');
  if (m >= 6.0) return KEEP('high', 'M6+');
  if (m >= 5.5) return KEEP('high', 'M5.5+');
  if (m >= 5.0) return KEEP('high', 'M5+ near office', PROXIMITY.earthquakeMid);
  if (m >= 4.5) {
    if (depthKm == null || depthKm <= 30) {
      return KEEP('mod', 'M4.5+ shallow near office', PROXIMITY.earthquakeShallow);
    }
    return DROP(`M${m.toFixed(1)} depth ${depthKm}km — too deep to feel`);
  }
  return DROP(`M${m.toFixed(1)} below feed floor`);
}

// ----------------------------------------------------------------------------
// NWS — National Weather Service
// ----------------------------------------------------------------------------

type CapSeverity = 'Minor' | 'Moderate' | 'Severe' | 'Extreme' | 'Unknown';

/**
 * NWS "Warnings only" rule. CAP severity Severe/Extreme always pass; Moderate
 * and below drop. Unknown CAP falls back to event-name suffix matching.
 *
 * Spec: docs/severity-thresholds.md#nws--us-national-weather-service
 */
export function evaluateNws(opts: {
  capSeverity: string | undefined;
  eventName: string;
}): ThresholdOutcome {
  const cap = (opts.capSeverity || 'Unknown') as CapSeverity;
  if (cap === 'Extreme') return KEEP('ext',  'CAP Extreme');
  if (cap === 'Severe')  return KEEP('high', 'CAP Severe');
  if (cap === 'Unknown' && /\bWarning\s*$/i.test(opts.eventName)) {
    return KEEP('high', 'CAP unknown, event name ends in Warning');
  }
  return DROP(`CAP ${cap} — Watch/Advisory/Statement`);
}

// ----------------------------------------------------------------------------
// GDACS
// ----------------------------------------------------------------------------

/**
 * GDACS Orange/Red only.
 * Spec: docs/severity-thresholds.md#gdacs--global-disaster-alert-coordination
 */
export function evaluateGdacs(opts: { alertLevel: string | undefined }): ThresholdOutcome {
  const a = (opts.alertLevel || '').toLowerCase();
  if (a === 'red')    return KEEP('ext',  'GDACS Red');
  if (a === 'orange') return KEEP('high', 'GDACS Orange');
  return DROP(`GDACS ${opts.alertLevel || 'unknown'} — below Orange`);
}

// ----------------------------------------------------------------------------
// EONET
// ----------------------------------------------------------------------------

/**
 * EONET — volcanoes always pass; wildfires/floods/severeStorms/earthquakes
 * need office proximity; everything else drops.
 *
 * Spec: docs/severity-thresholds.md#eonet--nasa-earth-observatory-natural-event-tracker
 */
export function evaluateEonet(opts: { categoryId: string }): ThresholdOutcome {
  switch (opts.categoryId) {
    case 'volcanoes':
      return KEEP('high', 'volcano');
    case 'severeStorms':
      return KEEP('mod', 'severe storm near office', PROXIMITY.eonet);
    case 'wildfires':
      return KEEP('mod', 'wildfire near office', PROXIMITY.eonet);
    case 'floods':
      return KEEP('mod', 'flood near office', PROXIMITY.eonet);
    case 'earthquakes':
      return KEEP('low', 'EONET earthquake (corroboration only) near office', PROXIMITY.eonet);
    default:
      return DROP(`EONET category '${opts.categoryId}' below threshold`);
  }
}

// ----------------------------------------------------------------------------
// State Department travel advisories
// ----------------------------------------------------------------------------

/**
 * State Dept Level 3+. Drops L1 and L2.
 * Spec: docs/severity-thresholds.md#state-department--travel-advisories
 */
export function evaluateStateDept(opts: { level: number | null }): ThresholdOutcome {
  const lvl = opts.level;
  if (lvl === 4) return KEEP('ext',  'Travel Advisory L4 — Do Not Travel');
  if (lvl === 3) return KEEP('high', 'Travel Advisory L3 — Reconsider Travel');
  if (lvl === 2) return DROP('Travel Advisory L2 — below threshold');
  if (lvl === 1) return DROP('Travel Advisory L1 — below threshold');
  return DROP('Travel Advisory level unparseable');
}

// ----------------------------------------------------------------------------
// ACLED
// ----------------------------------------------------------------------------

const ACLED_VIOLENT = new Set([
  'Battles',
  'Explosions/Remote violence',
  'Violence against civilians',
]);

/**
 * ACLED severity ladder by event type and fatalities. Zero-fatality
 * violent events get a proximity gate; zero-fatality riots/strategic
 * drop entirely.
 *
 * Spec: docs/severity-thresholds.md#acled--armed-conflict-location--event-data
 */
export function evaluateAcled(opts: {
  eventType: string;
  fatalities: number;
}): ThresholdOutcome {
  const { eventType, fatalities: f } = opts;

  if (ACLED_VIOLENT.has(eventType)) {
    if (f >= 5) return KEEP('ext',  `${eventType} ≥5 fatalities`);
    if (f >= 1) return KEEP('high', `${eventType} ${f} fatalities`);
    return KEEP('mod', `${eventType} 0 fatalities near office`, PROXIMITY.acledZeroFat);
  }

  if (eventType === 'Riots') {
    if (f >= 5) return KEEP('high', 'Riot ≥5 fatalities');
    if (f >= 1) return KEEP('mod',  `Riot ${f} fatalities`);
    return DROP('Riot 0 fatalities — below threshold');
  }

  if (eventType === 'Strategic developments') {
    if (f > 0) return KEEP('high', `Strategic development with ${f} fatalities`);
    return DROP('Strategic development 0 fatalities — below threshold');
  }

  return DROP(`ACLED event_type '${eventType}' not in whitelist`);
}

// ----------------------------------------------------------------------------
// MeteoAlarm
// ----------------------------------------------------------------------------

/**
 * MeteoAlarm — Orange and Red only.
 * Spec: docs/severity-thresholds.md#meteoalarm--european-weather-warnings
 */
export function evaluateMeteoAlarm(opts: { capSeverity: string | undefined; titleColor: string }): ThresholdOutcome {
  const cap = (opts.capSeverity || '').toLowerCase();
  if (cap === 'extreme') return KEEP('ext',  'MeteoAlarm CAP Extreme');
  if (cap === 'severe')  return KEEP('high', 'MeteoAlarm CAP Severe');

  const c = opts.titleColor.toLowerCase();
  if (c.includes('red'))    return KEEP('ext',  'MeteoAlarm Red');
  if (c.includes('orange')) return KEEP('high', 'MeteoAlarm Orange');
  return DROP(`MeteoAlarm ${opts.capSeverity ?? opts.titleColor} — below Orange`);
}
