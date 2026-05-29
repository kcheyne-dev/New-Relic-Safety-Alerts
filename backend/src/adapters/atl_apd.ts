import type { SourceAdapter, RawAndNormalized, NormalizedEvent } from '../types.js';
import { fromPoliceCategory } from '../pipeline/severity.js';
import { log } from '../log.js';

/**
 * Atlanta Police Department — COBRA daily updated incidents via ArcGIS REST.
 *
 * Endpoint: https://services2.arcgis.com/4FcmTqzRN6XvUDA8/arcgis/rest/services/COBRA_Daily_Updated/FeatureServer/0/query
 * Auth:     none
 * Format:   ArcGIS FeatureCollection (similar to GeoJSON)
 *
 * Filters server-side to within ~5 miles of the ATL office and last 24h.
 * Severity is derived from the UCR category names.
 */

const ATL_LAT = 33.7837;
const ATL_LNG = -84.3833;
const RADIUS_METERS = 8000;

interface ArcgisFeature {
  attributes: {
    OBJECTID?: number;
    offense_id?: number | string;
    rpt_date?: number;            // ms epoch
    occur_date?: number;
    UCR_Literal?: string;
    UC2_Literal?: string;
    Location?: string;
    Beat?: number;
    lat?: number;
    long?: number;
  };
  geometry?: { x?: number; y?: number };
}
interface ArcgisFeed {
  features?: ArcgisFeature[];
}

function buildUrl(): string {
  const sinceMs = Date.now() - 24 * 3600 * 1000;
  // ArcGIS spatial filter: bounding box around ATL; tighten with ST_DWithin in our pipeline anyway
  const where = encodeURIComponent(`rpt_date >= ${sinceMs}`);
  const params = [
    `where=${where}`,
    `outFields=*`,
    `f=json`,
    `resultRecordCount=200`,
    `orderByFields=rpt_date DESC`,
  ].join('&');
  return `https://services2.arcgis.com/4FcmTqzRN6XvUDA8/arcgis/rest/services/COBRA_Daily_Updated/FeatureServer/0/query?${params}`;
}

/** Earth-flat distance in meters. Good enough at this scale. */
function approxDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const atlApdAdapter: SourceAdapter = {
  id: 'atl_apd',
  name: 'Atlanta Police Department — Open Data',
  intervalSeconds: 900,

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(buildUrl(), {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Atlanta APD ArcGIS returned HTTP ${resp.status}`);
    const data = (await resp.json()) as ArcgisFeed;
    log.debug({ count: data.features?.length ?? 0 }, 'atl_apd.fetched');

    const items: RawAndNormalized[] = [];
    for (const f of data.features ?? []) {
      const a = f.attributes;
      // ArcGIS lat/long fields are inconsistent; try several
      const lat = a.lat ?? f.geometry?.y;
      const lng = a.long ?? f.geometry?.x;
      if (lat == null || lng == null) continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      // Drop incidents outside our 8 km perimeter (server-side filter doesn't always apply spatially)
      if (approxDistanceMeters(lat, lng, ATL_LAT, ATL_LNG) > RADIUS_METERS) continue;

      const cat = a.UCR_Literal ?? a.UC2_Literal ?? 'Unknown';
      const sev = fromPoliceCategory(cat);
      if (sev === 'low') continue;

      const id = String(a.offense_id ?? a.OBJECTID ?? `${a.rpt_date}-${lat}-${lng}`);
      const title = `${cat} (APD)`;
      const summary = `${cat}${a.Location ? ` · ${a.Location}` : ''}${a.Beat ? ` · Beat ${a.Beat}` : ''}`;

      const issuedMs = a.rpt_date ?? a.occur_date ?? Date.now();

      const normalized: NormalizedEvent = {
        sourceEventId: id,
        primarySourceId: 'atl_apd',
        title,
        summary,
        severity: sev,
        category: 'public_safety',
        type: cat.toLowerCase().replace(/\s+/g, '_'),
        location: a.Location ?? 'Atlanta',
        lat, lng,
        radiusKm: 1,
        issuedAt: new Date(issuedMs),
        expiresAt: null,
        sourceUrl: 'https://opendata.atlantapd.org/',
      };
      items.push({ sourceEventId: id, payload: f, normalized });
    }
    return items;
  },
};
