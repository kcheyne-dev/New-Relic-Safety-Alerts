import type { SourceAdapter, RawAndNormalized, NormalizedEvent } from '../types.js';
import { fromPoliceCategory } from '../pipeline/severity.js';
import { log } from '../log.js';

/**
 * San Francisco Police — Open Data via Socrata.
 *
 * Endpoint: https://data.sfgov.org/resource/wg3w-h783.json
 * Auth:     none (rate-limited; recommend a free Socrata App Token via
 *           SOCRATA_APP_TOKEN env to avoid 4xx under load)
 * Format:   JSON array
 *
 * Filters to last 24h, near SFO. Uses a bounding box rather than
 * `within_circle()` because Socrata's spatial functions are inconsistently
 * supported across dataset versions and were causing HTTP 400 in previous
 * versions of this adapter. Bounding box approximates a 10 km circle around
 * SFO and is simpler / more reliable.
 */

const SFO_LAT = 37.7898;
const SFO_LNG = -122.3942;
// ~10 km bounding box (1 deg lat ≈ 111 km; 1 deg lng @ 37° ≈ 88 km)
const BBOX = {
  latMin: SFO_LAT - 0.09,
  latMax: SFO_LAT + 0.09,
  lngMin: SFO_LNG - 0.115,
  lngMax: SFO_LNG + 0.115,
};

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
  // Socrata SoQL — keep it conservative:
  //  - timestamp uses 'YYYY-MM-DDTHH:MI:SS' without milliseconds or Z (Socrata's
  //    floating_timestamp format)
  //  - bounding box on latitude/longitude (no spatial function calls)
  //  - drop categories that flood the feed with non-actionable noise
  const sinceDate = new Date(Date.now() - 24 * 3600 * 1000);
  const since = sinceDate.toISOString().replace(/\.\d{3}Z$/, '');   // strip ms + Z
  const params = new URLSearchParams({
    $where: [
      `incident_datetime > '${since}'`,
      `latitude IS NOT NULL`,
      `latitude BETWEEN ${BBOX.latMin} AND ${BBOX.latMax}`,
      `longitude BETWEEN ${BBOX.lngMin} AND ${BBOX.lngMax}`,
      `incident_category NOT IN ('Non-Criminal','Lost Property','Recovered Vehicle')`,
    ].join(' AND '),
    $limit: '200',
    $order: 'incident_datetime DESC',
  });
  return `https://data.sfgov.org/resource/wg3w-h783.json?${params.toString()}`;
}

export const sfPoliceAdapter: SourceAdapter = {
  id: 'sf_police',
  name: 'San Francisco Police — Open Data',
  intervalSeconds: 600,

  async fetch(): Promise<RawAndNormalized[]> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    // Optional app token — avoids stricter rate limits / 4xx under load.
    if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
    const resp = await globalThis.fetch(buildUrl(), { headers });
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
