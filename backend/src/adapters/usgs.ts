import type { SourceAdapter, RawAndNormalized, NormalizedEvent, Severity } from '../types.js';
import { log } from '../log.js';

/**
 * USGS Earthquake feed adapter.
 *
 * Endpoint: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson
 * Format:   GeoJSON FeatureCollection
 * Auth:     none
 * Rate:     no published limit; we hit it on a 60-second cadence
 *
 * Severity mapping is by magnitude:
 *   < 4.0  → low      (felt by some, no damage expected)
 *   4.0–5.0 → mod     (light shaking, possibly minor damage near epicenter)
 *   5.0–6.5 → high    (significant shaking, damage likely)
 *   > 6.5   → ext     (major damage, mass impact)
 *
 * Radius mapping is a rough rule-of-thumb felt-radius derived from magnitude.
 * Real apps would call USGS ShakeMap for a precise polygon; this is fine for demo.
 */

interface UsgsFeature {
  id: string;
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number, number] };
  properties: {
    mag: number | null;
    place: string | null;
    time: number;            // ms since epoch
    updated: number;
    url: string;
    detail: string;
    title: string;
    type: string;            // 'earthquake'
    status: 'automatic' | 'reviewed' | 'deleted';
    tsunami: 0 | 1;
  };
}
interface UsgsFeed {
  type: 'FeatureCollection';
  metadata: { generated: number; title: string; count: number };
  features: UsgsFeature[];
}

const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';

function severityForMagnitude(mag: number): Severity {
  if (mag >= 6.5) return 'ext';
  if (mag >= 5.0) return 'high';
  if (mag >= 4.0) return 'mod';
  return 'low';
}

function radiusKmForMagnitude(mag: number): number {
  // Empirical felt-radius in km. Increases superlinearly with magnitude.
  // Source: rough average of historical USGS DYFI felt reports.
  if (mag >= 7.0) return 600;
  if (mag >= 6.0) return 350;
  if (mag >= 5.0) return 180;
  if (mag >= 4.0) return 80;
  return 40;
}

export const usgsAdapter: SourceAdapter = {
  id: 'usgs',
  name: 'US Geological Survey — earthquakes',
  intervalSeconds: 60,

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(FEED_URL, {
      headers: { 'User-Agent': 'nr-safety-alerts/0.1 (cmt-dashboard)' },
    });
    if (!resp.ok) throw new Error(`USGS feed returned HTTP ${resp.status}`);
    const data = (await resp.json()) as UsgsFeed;
    log.debug({ count: data.features.length }, 'usgs.fetched');

    const items: RawAndNormalized[] = [];
    for (const f of data.features) {
      // Skip deleted events
      if (f.properties.status === 'deleted') continue;
      // Skip non-earthquake events (USGS occasionally emits other types in wider feeds)
      if (f.properties.type !== 'earthquake') continue;
      const mag = f.properties.mag;
      if (mag == null) continue;
      const [lng, lat] = f.geometry.coordinates;
      if (lat == null || lng == null) continue;

      const sev = severityForMagnitude(mag);
      const radius = radiusKmForMagnitude(mag);
      const tsunamiSuffix = f.properties.tsunami ? ' · tsunami advisory issued' : '';

      const normalized: NormalizedEvent = {
        sourceEventId: f.id,
        primarySourceId: 'usgs',
        title: f.properties.title || `M${mag.toFixed(1)} earthquake — ${f.properties.place ?? 'unknown'}`,
        summary: `Magnitude ${mag.toFixed(1)} earthquake. ${f.properties.place ?? 'Location unspecified.'}${tsunamiSuffix}`,
        severity: sev,
        category: 'natural',
        type: 'earthquake',
        location: f.properties.place ?? 'Unknown location',
        lat,
        lng,
        radiusKm: radius,
        issuedAt: new Date(f.properties.time),
        expiresAt: null,                // earthquakes don't "expire"
        sourceUrl: f.properties.url,
      };
      items.push({ sourceEventId: f.id, payload: f, normalized });
    }
    return items;
  },
};
