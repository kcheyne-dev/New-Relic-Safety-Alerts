import type { Severity } from '../types.js';

/**
 * Centralized severity normalization. All adapters import from here so
 * the canonical Low/Mod/High/Ext mapping has one source of truth.
 *
 * Order of severity (ascending): low < mod < high < ext
 */

export const SEV_RANK: Record<Severity, number> = { low: 1, mod: 2, high: 3, ext: 4 };

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEV_RANK[a] >= SEV_RANK[b] ? a : b;
}

// ----------------------------------------------------------------------------
// Per-source severity mappers
// ----------------------------------------------------------------------------

/** USGS / EMSC / any earthquake source by magnitude. */
export function fromMagnitude(mag: number): Severity {
  if (mag >= 6.5) return 'ext';
  if (mag >= 5.0) return 'high';
  if (mag >= 4.0) return 'mod';
  return 'low';
}

/** USGS / EMSC felt-radius from magnitude (rough rule of thumb in km). */
export function radiusFromMagnitude(mag: number): number {
  if (mag >= 7.0) return 600;
  if (mag >= 6.0) return 350;
  if (mag >= 5.0) return 180;
  if (mag >= 4.0) return 80;
  return 40;
}

/** CAP standard severity (NWS, MeteoAlarm cap:severity). */
export function fromCap(s: string | undefined): Severity {
  switch ((s || '').toLowerCase()) {
    case 'extreme':  return 'ext';
    case 'severe':   return 'high';
    case 'moderate': return 'mod';
    case 'minor':    return 'low';
    default:         return 'low';
  }
}

/** GDACS alertlevel — Green / Orange / Red. */
export function fromGdacsAlert(s: string | undefined): Severity {
  switch ((s || '').toLowerCase()) {
    case 'red':    return 'ext';
    case 'orange': return 'high';
    case 'green':  return 'mod';
    default:       return 'mod';
  }
}

/** MeteoAlarm color (when only color is available, no CAP severity). */
export function fromMeteoAlarmColor(s: string | undefined): Severity {
  const t = (s || '').toLowerCase();
  if (t.includes('red'))    return 'ext';
  if (t.includes('orange')) return 'high';
  if (t.includes('yellow') || t.includes('amber')) return 'mod';
  if (t.includes('green'))  return 'low';
  return 'mod';
}

/** US State Department — Travel Advisory Level 1-4. */
export function fromTravelLevel(category: string | string[] | undefined): Severity {
  const s = Array.isArray(category) ? category.join(' ') : category ?? '';
  const m = s.match(/Level\s*(\d)/i);
  if (!m) return 'low';
  switch (m[1]) {
    case '4': return 'ext';
    case '3': return 'high';
    case '2': return 'mod';
    default:  return 'low';
  }
}

/** TfL line status severity (1-20 numeric scale).
 *
 *  Reference (TfL Unified API):
 *    0  Special Service          7  Reduced Service
 *    1  Closed                   8  Bus Service (replacement)
 *    2  Suspended                9  Minor Delays      ← common, NOT high
 *    3  Part Suspended          10  Good Service
 *    4  Planned Closure         11  Part Closed
 *    5  Part Closure            14  Change of Frequency
 *    6  Severe Delays           17  Issues Reported
 *                               19  Information
 *                               20  Service Closed
 *
 *  CMT-relevance bar: only real disruptions (closures + severe delays).
 *  Minor delays, reduced service, bus replacements, and informational
 *  status updates are dropped at ingest time.
 */
export function fromTflStatusSeverity(n: number): Severity {
  if (n >= 1 && n <= 3) return 'ext';   // Closed / Suspended / Part Suspended
  if (n >= 4 && n <= 6) return 'high';  // Planned/Part Closure / Severe Delays
  return 'low';                          // everything else: filter out
}

/** Police-incident category → severity. Used by SF + ATL adapters.
 *
 *  CMT-relevance bar: only events that meaningfully threaten employee
 *  safety inside or around an office. Property crime, drug offenses,
 *  trespass, and ordinary assault don't clear that bar — even close
 *  to an office, they're a routine-policing concern, not a CMT one.
 *
 *  Result tiers:
 *    ext  — active life threat (mass-casualty / active shooter / bomb)
 *    high — imminent armed danger (armed robbery, aggravated assault,
 *           weapon-involved, carjacking, arson)
 *    low  — everything else (filtered out by the adapter)
 *
 *  No mod tier here on purpose. Earlier mappings sent 'drug', 'burglary',
 *  'disturbance' into mod, which produced a noisy SFPD incident wall.
 */
export function fromPoliceCategory(category: string): Severity {
  const c = category.toLowerCase();
  // Active life threat
  if (/(homicide|murder|shooting|stabbing|kidnap|hostage|terrorism|active shooter|bomb|explosion|mass.?(casualty|shooting))/.test(c))
    return 'ext';
  // Imminent armed danger
  if (/(armed robbery|aggravated assault|weapon|firearm|carjacking|arson|sexual assault)/.test(c))
    return 'high';
  // Everything else: drop
  return 'low';
}
