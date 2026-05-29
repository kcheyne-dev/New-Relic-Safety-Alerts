import type { SourceAdapter, RawAndNormalized, NormalizedEvent } from '../types.js';
import { fromPoliceCategory } from '../pipeline/severity.js';
import { log } from '../log.js';

/**
 * San Francisco Police — Open Data via Socrata.
 *
 * Endpoint: https://data.sfgov.org/resource/wg3w-h783.json
 * Auth:     none (rate-limited; recommend a free Socrata App Token at scale)
 * Format:   JSON array
 *
 * Filters to last 24h, severity ≥ Moderate (skip parking + minor stuff that
 * floods the feed), within ~10 km of the SFO office. We do the proximity
 * filter at fetch time too, server-side via Socrata's $where clause.
 */

const SFO_LAT = 37.7898;
const SFO_LNG = -122.3942;
const RADIUS_METERS = 10000;

interface SfIncident {
  incident_datetime?: string;
  incident_id?: string;
  incident_number?: string;
  incident_category?: string;
  incident_subcategory?: string;
  incident_description?: string;
  resolution?: string;
  intersection?: string;
  cnn?: string;
  latitude?: string;
  longitude?: string;
  point?: { type: 'Point'; coordinates: [number, number] };
}

function buildUrl(): string {
  // Socrata SoQL: last 24h, near SFO, drop "parking" / "non-criminal" noise
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const where = encodeURIComponent(
    `incident_datetime > '${since}' ` +
    `AND latitude IS NOT NULL ` +
    `AND within_circle(point, ${SFO_LAT}, ${SFO_LNG}, ${RADIUS_METERS}) ` +
    `AND incident_category NOT IN ('Non-Criminal', 'Lost Property', 'Recovered Vehicle')`
  );
  return `https://data.sfgov.org/resource/wg3w-h783.json?$where=${where}&$limit=200&$order=incident_datetime DESC`;
}

export const sfPoliceAdapter: SourceAdapter = {
  id: 'sf_police',
  name: 'San Francisco Police — Open Data',
  intervalSeconds: 600,

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(buildUrl(), {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`SF Socrata returned HTTP ${resp.status}`);
    const data = (await resp.json()) as SfIncident[];
    log.debug({ count: data.length }, 'sf_police.fetched');

    const items: RawAndNormalized[] = [];
    for (const r of data) {
      if (!r.latitude || !r.longitude || !r.incident_datetime) continue;
      const lat = Number(r.latitude);
      const lng = Number(r.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const cat = r.incident_category ?? 'Unknown';
      const sev = fromPoliceCategory(cat + ' ' + (r.incident_subcategory ?? ''));
      // We only emit Moderate+ to keep the dashboard signal-heavy
      if (sev === 'low') continue;

      const id = r.incident_id ?? r.incident_number ?? `${r.incident_datetime}-${lat}-${lng}`;
      const title = `${cat}${r.incident_subcategory ? ` — ${r.incident_subcategory}` : ''} (SFPD)`;
      const summary = (r.incident_description || cat) + (r.intersection ? ` · ${r.intersection}` : '');

      const normalized: NormalizedEvent = {
        sourceEventId: id,
        primarySourceId: 'sf_police',
        title,
        summary,
        severity: sev,
        category: 'public_safety',
        type: cat.toLowerCase().replace(/\s+/g, '_'),
        location: r.intersection ?? 'San Francisco',
        lat, lng,
        radiusKm: 1,                                    // local incident
        issuedAt: new Date(r.incident_datetime),
        expiresAt: null,
        sourceUrl: `https://data.sfgov.org/Public-Safety/Police-Department-Incident-Reports-2018-to-Present/wg3w-h783/explore?qid=${encodeURIComponent(id)}`,
      };
      items.push({ sourceEventId: id, payload: r, normalized });
    }
    return items;
  },
};
