import type { Severity } from '../types.js';
import { fromPoliceCategory } from './severity.js';

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

// ----------------------------------------------------------------------------
// London TfL — keyword-gated, CMT-grade only
// ----------------------------------------------------------------------------

/**
 * TfL's status feed is a commuter-information service. The whole 1-20 scale
 * is "service health," not "is this dangerous." A Tube line being Suspended
 * routinely means a signal failure or leaves-on-the-line — annoying for the
 * commute, but not a CMT concern.
 *
 * CMT bar (per docs/project-review-2026-06-16.md): events with extreme
 * likelihood to affect an office (Q1), a traveler (Q2), or a large-population
 * scale event (Q3). Routine transit disruptions don't meet any of these.
 *
 * Tuning: drop at ingest unless the `reason` or `statusSeverityDescription`
 * text contains a CMT-grade incident keyword (police, fire, evacuation, etc.).
 * For matched events, apply the original 1-3=ext / 4-6=high severity mapping.
 *
 * 2026-06-29 tuning: removed bare "incident" from the regex. TfL uses
 * "customer incident" as a euphemism for routine passenger-related issues
 * (medical calls, trespassers, train faults), and that single word was
 * matching ~all noise events through this gate. The remaining keywords
 * are all specific enough to stand alone — TfL writes "police incident",
 * "fire on track", "evacuation in progress" when it's actually real;
 * those still match via the more specific word.
 *
 * Note: even with the keyword gate, matched events can still look
 * "Direct" relative to the LON office because the adapter pins all
 * TfL events to the LON office coordinates (see london_tfl.ts). A
 * casualty event on a south-London Overground line shouldn't look
 * Direct relative to a central-London office. The geometry fix lives
 * in the adapter, not here — see LINE_CENTROIDS in london_tfl.ts.
 *
 * Spec: docs/severity-thresholds.md#london_tfl (TODO — add when next touched).
 */
export const TFL_CMT_KEYWORDS = /\b(police|fire|evacuat\w*|emergency|suspicious|security|casualt\w*|fatal\w*|explos\w*|attack|terror\w*|hostile|lockdown|crime|stab\w*|shoot\w*|riot\w*|protest\w*|bomb)\b/i;

export function evaluateLondonTfl(opts: {
  statusSeverity: number;
  reason: string;
  description: string;
}): ThresholdOutcome {
  const haystack = `${opts.reason} ${opts.description}`.trim();
  if (!haystack) return DROP('TfL event with no reason/description text');
  if (!TFL_CMT_KEYWORDS.test(haystack)) {
    return DROP(`no CMT incident keyword in: "${haystack.slice(0, 80)}${haystack.length > 80 ? '…' : ''}"`);
  }
  // Keyword matched — apply original severity mapping.
  if (opts.statusSeverity >= 1 && opts.statusSeverity <= 3) {
    return KEEP('ext',  `CMT keyword + TfL severity ${opts.statusSeverity} (Closed/Suspended)`);
  }
  if (opts.statusSeverity >= 4 && opts.statusSeverity <= 6) {
    return KEEP('high', `CMT keyword + TfL severity ${opts.statusSeverity} (Closure/Severe Delays)`);
  }
  return DROP(`TfL severity ${opts.statusSeverity} below CMT bar even with keyword`);
}

// ----------------------------------------------------------------------------
// Police records feeds — historical-record sources, capped at 'mod'
// ----------------------------------------------------------------------------

/**
 * SFPD (Socrata), ATL APD (ArcGIS COBRA), and PDX FlashAlert all publish
 * AFTER-THE-FACT incident records. By the time an event lands in any of
 * these feeds, the police call has been responded to, the scene has been
 * processed, reports have been written and reviewed. The data is
 * structurally historical, not real-time — typical lag is hours to a
 * full day.
 *
 * For CMT use (Q1: extreme likelihood to affect office; Q2: traveler
 * threat), an "aggravated assault 35 hours ago at an intersection 2 miles
 * from the office" is not an active threat. It's context for "this
 * neighborhood has elevated crime activity" but it doesn't drive
 * office-relevant ext/high alerts or CMT mobilization.
 *
 * OPERATOR FEEDBACK (2026-06-20): three SFPD events near SFO surfaced
 * as 'high' (two aggravated assaults + one weapons offense), all 35-39
 * hours old. None met the bar. The category-based severity logic
 * (`fromPoliceCategory`) was correct in spirit but operating on the
 * wrong axis — it judged "how serious is this CRIME?" rather than
 * "how active is this THREAT?". A 35-hour-old assault is a closed
 * case, not a CMT mobilization trigger.
 *
 * DECISION (Option B from the 2026-06-20 lens-review discussion):
 * cap police-records feeds at 'mod'. Events still surface for context
 * — a geo-fence around an office will still show recent armed incidents
 * as situational awareness — but they don't drive default office-relevant
 * filtering, don't fire the status-strip extreme wash, and don't read as
 * "CMT mobilize." Non-armed/non-threat categories (drug, burglary,
 * disturbance, trespass) continue to drop entirely, preserving the
 * 2026-06-15 cleanup.
 *
 * The right replacement for real-time security incident detection is a
 * paid feed (Factal recommended in the 2026-06-20 review) — see
 * docs/action-plan-2026-06-19.md and project-status-2026-06-19.md.
 * Until then, police records remain as context-only.
 *
 * SCOPE: applies to sf_police and atl_apd — both after-the-fact
 * police-records feeds using `fromPoliceCategory`.
 *
 * NOT applied to pdx_flashalert: structurally different (emergency
 * notifications from agencies, keyword-based severity inference, more
 * real-time than police records). Currently disabled on URL-404 anyway.
 * When/if revived, it needs its own evaluator (likely a keyword gate
 * similar to evaluateLondonTfl), not this demotion.
 */
export function evaluatePoliceRecordsFeed(opts: {
  categoryText: string;
}): ThresholdOutcome {
  const sev = fromPoliceCategory(opts.categoryText);
  if (sev === 'low') {
    return DROP('non-armed/non-threat police category (drug/burglary/etc.)');
  }
  // sev is 'ext' or 'high' from fromPoliceCategory's category match.
  // Demote uniformly to 'mod' because the source is historical-records,
  // not real-time-threat. The reason field preserves what fromPoliceCategory
  // would have returned for audit / future-tuning context.
  return KEEP('mod', `police records category → ${sev} → demoted to mod (historical source, not real-time)`);
}
