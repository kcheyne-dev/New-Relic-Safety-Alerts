import type { SourceAdapter, RawAndNormalized, NormalizedEvent, Severity, Category } from '../types.js';
import { log } from '../log.js';

/**
 * NASA EONET — Earth Observatory Natural Event Tracker.
 *
 * Endpoint: https://eonet.gsfc.nasa.gov/api/v3/events?status=open
 * Auth:     none
 * Format:   JSON. Each event has 1+ "geometry" entries (Point or Polygon)
 *           timestamped — we use the most recent.
 *
 * EONET doesn't publish severity, just categories. We map:
 *   wildfires       → high (active fires are dangerous by definition)
 *   severeStorms    → high
 *   volcanoes       → high
 *   earthquakes     → mod (we have USGS for these; just for redundancy)
 *   floods          → high
 *   drought         → mod
 *   manmade         → mod
 *   tempExtremes    → mod
 *   default         → mod
 */

interface EonetGeometry {
  date: string;
  type: 'Point' | 'Polygon';
  coordinates: number[] | number[][][];
  magnitudeValue?: number;
  magnitudeUnit?: string;
}

interface EonetEvent {
  id: string;
  title: string;
  description?: string | null;
  link: string;
  closed: string | null;
  categories: Array<{ id: string; title: string }>;
  sources: Array<{ id: string; url: string }>;
  geometry: EonetGeometry[];
}

interface EonetFeed {
  title: string;
  description: string;
  events: EonetEvent[];
}

const FEED_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open';

const CATEGORY_MAP: Record<string, { sev: Severity; type: string; cat: Category }> = {
  wildfires:    { sev: 'high', type: 'wildfire',     cat: 'natural' },
  severeStorms: { sev: 'high', type: 'severe_storm', cat: 'natural' },
  volcanoes:    { sev: 'high', type: 'volcano',      cat: 'natural' },
  earthquakes:  { sev: 'mod',  type: 'earthquake',   cat: 'natural' },
  floods:       { sev: 'high', type: 'flood',        cat: 'natural' },
  drought:      { sev: 'mod',  type: 'drought',      cat: 'natural' },
  manmade:      { sev: 'mod',  type: 'manmade',      cat: 'natural' },
  tempExtremes: { sev: 'mod',  type: 'temp_extreme', cat: 'natural' },
  dustHaze:     { sev: 'mod',  type: 'dust',         cat: 'natural' },
  seaLakeIce:   { sev: 'low',  type: 'sea_lake_ice', cat: 'natural' },
  snow:         { sev: 'mod',  type: 'snow',         cat: 'natural' },
  waterColor:   { sev: 'low',  type: 'water_color',  cat: 'natural' },
};

/** Last point of a Polygon (centroid is overkill; first vertex is fine here). */
function pointFromGeometry(g: EonetGeometry): [number, number] | null {
  if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const c = g.coordinates as number[];
    return [c[0]!, c[1]!];
  }
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const ring = (g.coordinates as number[][][])[0];
    if (!ring || ring.length === 0) return null;
    let sx = 0, sy = 0, n = 0;
    for (const pt of ring) {
      if (pt && pt.length >= 2) { sx += pt[0]!; sy += pt[1]!; n++; }
    }
    if (n === 0) return null;
    return [sx / n, sy / n];
  }
  return null;
}

export const eonetAdapter: SourceAdapter = {
  id: 'eonet',
  name: 'NASA Earth Observatory Natural Event Tracker',
  intervalSeconds: 600,

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(FEED_URL);
    if (!resp.ok) throw new Error(`EONET feed returned HTTP ${resp.status}`);
    const data = (await resp.json()) as EonetFeed;
    log.debug({ count: data.events.length }, 'eonet.fetched');

    const items: RawAndNormalized[] = [];
    for (const e of data.events) {
      if (e.closed) continue;                       // ignore closed events
      if (!e.categories.length || !e.geometry.length) continue;

      // Use the latest geometry entry (events evolve over time)
      const latest = [...e.geometry].sort((a, b) => b.date.localeCompare(a.date))[0]!;
      const point = pointFromGeometry(latest);
      if (!point) continue;
      const [lng, lat] = point;

      const cat = e.categories[0]!;
      const mapped = CATEGORY_MAP[cat.id] ?? { sev: 'mod' as Severity, type: cat.id, cat: 'natural' as Category };

      const normalized: NormalizedEvent = {
        sourceEventId: e.id,
        primarySourceId: 'eonet',
        title: e.title,
        summary: e.description?.trim() || `${cat.title} event tracked by NASA EONET. ${e.sources.length} contributing source(s).`,
        severity: mapped.sev,
        category: mapped.cat,
        type: mapped.type,
        location: e.title,                          // EONET doesn't publish a clean place name
        lat,
        lng,
        radiusKm: null,
        issuedAt: new Date(latest.date),
        expiresAt: null,
        sourceUrl: e.link,
      };
      items.push({ sourceEventId: e.id, payload: e, normalized });
    }
    return items;
  },
};
