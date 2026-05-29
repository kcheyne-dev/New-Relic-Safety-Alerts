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

/** TfL line status severity (1-20 numeric scale). */
export function fromTflStatusSeverity(n: number): Severity {
  // TfL severity: 0-3 = severe disruption, 4-9 = major, 10-19 = minor, 20 = good service
  if (n <= 3)  return 'ext';
  if (n <= 9)  return 'high';
  if (n <= 19) return 'mod';
  return 'low';
}

/** Police-incident category → severity. Used by SF + ATL adapters. */
export function fromPoliceCategory(category: string): Severity {
  const c = category.toLowerCase();
  // Lethal / armed
  if (/(homicide|murder|shooting|stabbing|kidnap|hostage|terrorism|active shooter|bomb|explosion)/.test(c)) return 'ext';
  // Violent / weapon
  if (/(armed robbery|aggravated assault|weapon|firearm|carjacking|arson|sexual assault|battery)/.test(c)) return 'high';
  // Theft / property / disturbance
  if (/(robbery|burglary|assault|narcotics|disturbance|drug|gang|domestic|trespass)/.test(c)) return 'mod';
  // Misc / non-violent
  return 'low';
}
