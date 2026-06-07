import type { SourceAdapter, RawAndNormalized, NormalizedEvent } from '../types.js';
import { radiusFromMagnitude } from '../pipeline/severity.js';
import { evaluateEarthquake } from '../pipeline/thresholds.js';
import { log } from '../log.js';

/**
 * EMSC — European Mediterranean Seismological Centre.
 *
 * Endpoint: https://www.seismicportal.eu/fdsnws/event/1/query
 *           ?format=json&limit=200&minmag=4
 * Auth:     none
 * Format:   GeoJSON FeatureCollection (FDSN WS standard)
 *
 * EMSC frequently picks up European events faster than USGS. Output schema
 * mirrors USGS closely. Severity mapping is identical to USGS.
 */

interface EmscFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number, number] };
  properties: {
    source_id: string;
    source_catalog: string;
    lastupdate: string;
    time: string;
    flynn_region: string;
    lat: number;
    lon: number;
    depth: number;
    evtype: string;        // 'ke' = known earthquake, 'se' = suspected, etc.
    auth: string;
    mag: number;
    magtype: string;
    unid: string;
  };
}
interface EmscFeed {
  type: 'FeatureCollection';
  metadata: { count: number; generated: number };
  features: EmscFeature[];
}

const FEED_URL = 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=200&minmag=4';

export const emscAdapter: SourceAdapter = {
  id: 'emsc',
  name: 'European Mediterranean Seismological Centre',
  intervalSeconds: 300,

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(FEED_URL, {
      headers: { 'User-Agent': 'nr-safety-alerts/0.1', Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`EMSC feed returned HTTP ${resp.status}`);
    const data = (await resp.json()) as EmscFeed;
    log.debug({ count: data.features?.length ?? 0 }, 'emsc.fetched');

    const items: RawAndNormalized[] = [];
    let droppedThreshold = 0;
    for (const f of data.features ?? []) {
      const p = f.properties;
      if (p.evtype !== 'ke') continue;            // only confirmed earthquakes
      const lat = p.lat ?? f.geometry.coordinates[1];
      const lng = p.lon ?? f.geometry.coordinates[0];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      // Threshold gate — same rules as USGS, see docs/severity-thresholds.md
      const verdict = evaluateEarthquake({ magnitude: p.mag, depthKm: p.depth ?? null });
      if (!verdict.pass) { droppedThreshold++; continue; }

      const radius = radiusFromMagnitude(p.mag);

      const normalized: NormalizedEvent = {
        sourceEventId: p.unid || p.source_id,
        primarySourceId: 'emsc',
        title: `M${p.mag.toFixed(1)} earthquake — ${p.flynn_region}`,
        summary: `Magnitude ${p.mag.toFixed(1)} ${p.magtype} earthquake at depth ${p.depth} km. ${p.flynn_region}.`,
        severity: verdict.severity!,
        category: 'natural',
        type: 'earthquake',
        location: p.flynn_region,
        lat,
        lng,
        radiusKm: radius,
        issuedAt: new Date(p.time),
        expiresAt: null,
        sourceUrl: `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(p.unid || p.source_id)}`,
      };
      items.push({
        sourceEventId: normalized.sourceEventId,
        payload: f,
        normalized,
        ...(verdict.requiresProximityKm
          ? { thresholds: { requiresProximityKm: verdict.requiresProximityKm } }
          : {}),
      });
    }
    log.debug({ kept: items.length, droppedThreshold, totalSeen: data.features?.length ?? 0 }, 'emsc.filtered');
    return items;
  },
};
