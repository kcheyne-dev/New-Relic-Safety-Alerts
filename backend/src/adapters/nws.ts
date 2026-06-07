import type { SourceAdapter, RawAndNormalized, NormalizedEvent, Category } from '../types.js';
import { evaluateNws } from '../pipeline/thresholds.js';
import { log } from '../log.js';

/**
 * NWS — National Weather Service active alerts.
 *
 * Endpoint: https://api.weather.gov/alerts/active
 * Auth:     none, but they ASK for a User-Agent that identifies your app + contact
 * Format:   GeoJSON FeatureCollection (per their CAP-XML translation layer)
 *
 * NWS provides a structured 4-level severity that maps cleanly to ours.
 * We keep only alerts with a usable point or polygon — anything without
 * geometry isn't useful for an office-proximity dashboard.
 */

interface NwsFeature {
  id: string;
  type: 'Feature';
  geometry: { type: string; coordinates: unknown } | null;
  properties: {
    id: string;
    areaDesc: string;
    sent: string;        // ISO
    effective: string;
    expires: string;
    onset: string | null;
    ends: string | null;
    status: string;      // 'Actual','Test',...
    messageType: string; // 'Alert','Update','Cancel'
    category: string;    // 'Met','Geo','Safety','Security','Health','Env',...
    severity: 'Minor' | 'Moderate' | 'Severe' | 'Extreme' | 'Unknown';
    certainty: string;
    urgency: string;
    event: string;       // 'Severe Thunderstorm Warning'
    headline: string | null;
    description: string | null;
    instruction: string | null;
    web: string | null;
  };
}
interface NwsFeed {
  type: 'FeatureCollection';
  features: NwsFeature[];
}

const FEED_URL = 'https://api.weather.gov/alerts/active';
const UA = 'nr-safety-alerts/0.1 (cmt-dashboard@example.com)';

function categoryFor(c: string): Category {
  switch (c) {
    case 'Met':
    case 'Geo':
    case 'Env':     return 'natural';
    case 'Safety':  return 'public_safety';
    case 'Security':return 'civil';
    case 'Health':  return 'health';
    default:        return 'natural';
  }
}

/** Crude polygon-centroid for events with a polygon geometry. Not exact. */
function centroidFromPolygon(coords: number[][][]): [number, number] | null {
  const ring = coords[0];
  if (!ring || ring.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const pt of ring) {
    if (pt && pt.length >= 2) {
      const x = pt[0]!;
      const y = pt[1]!;
      sx += x; sy += y; n++;
    }
  }
  if (n === 0) return null;
  return [sx / n, sy / n];
}

function pointFromGeometry(g: NwsFeature['geometry']): [number, number] | null {
  if (!g) return null;
  if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const c = g.coordinates as number[];
    return [c[0]!, c[1]!];
  }
  if ((g.type === 'Polygon' || g.type === 'MultiPolygon') && Array.isArray(g.coordinates)) {
    const coords = g.type === 'Polygon'
      ? (g.coordinates as number[][][])
      : ((g.coordinates as number[][][][])[0] ?? null);
    if (!coords) return null;
    return centroidFromPolygon(coords);
  }
  return null;
}

export const nwsAdapter: SourceAdapter = {
  id: 'nws',
  name: 'US National Weather Service — alerts',
  intervalSeconds: 300,

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(FEED_URL, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/geo+json',
      },
    });
    if (!resp.ok) throw new Error(`NWS feed returned HTTP ${resp.status}`);
    const data = (await resp.json()) as NwsFeed;
    log.debug({ count: data.features.length }, 'nws.fetched');

    const items: RawAndNormalized[] = [];
    let droppedThreshold = 0;
    for (const f of data.features) {
      const p = f.properties;
      if (p.status !== 'Actual') continue;
      if (p.messageType === 'Cancel') continue;

      // Threshold gate — Warnings only, see docs/severity-thresholds.md
      const verdict = evaluateNws({ capSeverity: p.severity, eventName: p.event });
      if (!verdict.pass) { droppedThreshold++; continue; }

      const center = pointFromGeometry(f.geometry);
      if (!center) continue;
      const [lng, lat] = center;

      const summary = [p.headline, p.description, p.instruction]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 1200);

      const normalized: NormalizedEvent = {
        sourceEventId: p.id,
        primarySourceId: 'nws',
        title: p.event,
        summary: summary || p.areaDesc,
        severity: verdict.severity!,
        category: categoryFor(p.category),
        type: p.event.toLowerCase().replace(/\s+/g, '_'),
        location: p.areaDesc,
        lat,
        lng,
        radiusKm: null,                     // NWS gives polygons, not radii — we use point + polygon hits later
        issuedAt: new Date(p.sent),
        expiresAt: p.expires ? new Date(p.expires) : null,
        sourceUrl: p.web ?? `https://api.weather.gov/alerts/${encodeURIComponent(p.id)}`,
      };
      items.push({ sourceEventId: p.id, payload: f, normalized });
    }
    log.debug({ kept: items.length, droppedThreshold, totalSeen: data.features.length }, 'nws.filtered');
    return items;
  },
};
