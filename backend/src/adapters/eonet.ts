import type { SourceAdapter, RawAndNormalized, NormalizedEvent, Category } from '../types.js';
import { evaluateEonet } from '../pipeline/thresholds.js';
import { log } from '../log.js';
import { config } from '../config.js';

/**
 * NASA EONET — Earth Observatory Natural Event Tracker.
 *
 * Endpoint: https://eonet.gsfc.nasa.gov/api/v3/events?status=open
 * Auth:     none
 * Format:   JSON. Each event has 1+ "geometry" entries (Point or Polygon)
 *           timestamped — we use the most recent.
 *
 * EONET doesn't publish severity, just categories. Severity + drop decisions
 * live in pipeline/thresholds.ts (evaluateEonet) — see docs/severity-thresholds.md.
 * In short: volcanoes always pass; wildfires/floods/severeStorms/earthquakes
 * pass only if near an office (proximity gate in persist.ts); other categories
 * (drought, dust, snow, ...) drop entirely. Recency floor and prescribed-fire
 * filter run before the threshold gate, as before.
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

// EONET doesn't publish severity, just categories. Severity now comes from
// pipeline/thresholds.ts (evaluateEonet). This map only carries type + category
// for normalization; the threshold gate decides whether each category is kept
// at all and what severity to assign.
const CATEGORY_MAP: Record<string, { type: string; cat: Category }> = {
  wildfires:    { type: 'wildfire',     cat: 'natural' },
  severeStorms: { type: 'severe_storm', cat: 'natural' },
  volcanoes:    { type: 'volcano',      cat: 'natural' },
  earthquakes:  { type: 'earthquake',   cat: 'natural' },
  floods:       { type: 'flood',        cat: 'natural' },
  drought:      { type: 'drought',      cat: 'natural' },
  manmade:      { type: 'manmade',      cat: 'natural' },
  tempExtremes: { type: 'temp_extreme', cat: 'natural' },
  dustHaze:     { type: 'dust',         cat: 'natural' },
  seaLakeIce:   { type: 'sea_lake_ice', cat: 'natural' },
  snow:         { type: 'snow',         cat: 'natural' },
  waterColor:   { type: 'water_color',  cat: 'natural' },
};

/** Heuristic: EONET groups prescribed/managed fires under "wildfires" with no flag.
 *  Title patterns from the data: "RX Prescribed Fire", "Compartment N RX...", etc. */
function isPrescribedFire(title: string): boolean {
  const t = title.toLowerCase();
  return t.includes('prescribed fire') || /\brx\b/i.test(title);
}

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

    // EONET keeps wildfires "open" indefinitely if no one closes them — many entries
    // are years stale. Drop anything older than the configured max-age window.
    const cutoffMs = Date.now() - config.quality.eonetMaxAgeDays * 24 * 60 * 60 * 1000;

    const items: RawAndNormalized[] = [];
    let droppedOld = 0, droppedRx = 0, droppedThreshold = 0;
    for (const e of data.events) {
      if (e.closed) continue;                       // ignore closed events
      if (!e.categories.length || !e.geometry.length) continue;
      if (isPrescribedFire(e.title)) { droppedRx++; continue; }   // RX/prescribed burns are not threats

      // Use the latest geometry entry (events evolve over time)
      const latest = [...e.geometry].sort((a, b) => b.date.localeCompare(a.date))[0]!;
      const latestMs = new Date(latest.date).getTime();
      if (Number.isFinite(latestMs) && latestMs < cutoffMs) { droppedOld++; continue; }

      const cat = e.categories[0]!;

      // Threshold gate — see docs/severity-thresholds.md
      const verdict = evaluateEonet({ categoryId: cat.id });
      if (!verdict.pass) { droppedThreshold++; continue; }

      const point = pointFromGeometry(latest);
      if (!point) continue;
      const [lng, lat] = point;

      const mapped = CATEGORY_MAP[cat.id] ?? { type: cat.id, cat: 'natural' as Category };

      const normalized: NormalizedEvent = {
        sourceEventId: e.id,
        primarySourceId: 'eonet',
        title: e.title,
        summary: e.description?.trim() || `${cat.title} event tracked by NASA EONET. ${e.sources.length} contributing source(s).`,
        severity: verdict.severity!,
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
      items.push({
        sourceEventId: e.id,
        payload: e,
        normalized,
        ...(verdict.requiresProximityKm
          ? { thresholds: { requiresProximityKm: verdict.requiresProximityKm } }
          : {}),
      });
    }
    log.debug({ kept: items.length, droppedOld, droppedRx, droppedThreshold, totalSeen: data.events.length }, 'eonet.filtered');
    return items;
  },
};
