/**
 * MeteoAlarm shared types + helpers.
 *
 * Extracted from meteoalarm.ts on 2026-08-06 as part of Task #63 (MQTT
 * consumer implementation). Both the REST adapter (backend/src/adapters/
 * meteoalarm.ts) and the MQTT consumer (backend/src/consumers/
 * meteoalarm-mqtt.ts) build NormalizedEvent rows the same way — from an
 * OGC-EDR-style index Feature plus its CAP JSON — so the geometry math,
 * info-block picker, JSON-variant fetcher, and full one-alert normalization
 * live here to avoid duplication.
 *
 * The wire shape is byte-for-byte compatible between transports:
 *   - REST /locations/ALL returns a FeatureCollection of Feature refs
 *   - MQTT warnings-ALL topic publishes individual Feature refs, one per msg
 * Both then follow `links[rel=json]` to fetch the CAP payload from
 * DigitalOcean Spaces.
 *
 * The bbox anti-meridian caveat from unionBboxCentroidAndRadiusKm applies
 * to both transports — MeteoAlarm covers Europe only, so it's a non-issue
 * today; add a wrap check before reusing this code for Pacific data.
 */

import type { RawAndNormalized, NormalizedEvent } from '../types.js';
import { evaluateMeteoAlarm } from '../pipeline/thresholds.js';
import { log } from '../log.js';

/** Radius bounds applied to the bbox-derived warning radius. */
export const MIN_RADIUS_KM = 30;
export const MAX_RADIUS_KM = 300;

// ---- types -----------------------------------------------------------------

export interface IndexFeatureProps {
  alertId: string;
  countryCode: string;
  hubLink: string;
  hubTime: string;
  supersededByAlertId: string | null;
  supersededAt: string | null;
  supersedeType: string | null;
  hubLanguage: string;
  geometryType?: string;
  [k: string]: unknown;
}

export interface IndexFeature {
  id?: string;
  type: 'Feature';
  geometry: { type: string; coordinates: number[][][] } | null;
  properties: IndexFeatureProps;
  links: Array<{ rel: string; type: string; href: string }>;
}

export interface IndexResponse {
  type: 'FeatureCollection';
  features?: IndexFeature[];
}

/** CAP 1.2 info block, as flattened to JSON by MeteoGate / MeteoAlarm. */
export interface CapJsonInfo {
  language: string;
  category?: string[];
  event?: string;
  description?: string;
  severity?: string;   // 'Minor' | 'Moderate' | 'Severe' | 'Extreme' | 'Unknown'
  certainty?: string;
  urgency?: string;
  responseType?: string;
  effective?: string;
  onset?: string;
  expires?: string;
  contact?: string;
  web?: string;
  area?: Array<{
    areaDesc?: string;
    altitude?: number;
    ceiling?: number;
    geocode?: Array<{ value: string; valueName: string }>;
  }>;
  eventCode?: Array<{ value: string; valueName: string }>;
}

/** CAP 1.2 envelope, as flattened to JSON by MeteoGate / MeteoAlarm. */
export interface CapJson {
  identifier: string;
  sender?: string;
  sent?: string;
  status?: string;
  msgType?: string;
  scope?: string;
  source?: string;
  references?: string;
  info?: CapJsonInfo[];
  code?: string[];
}

// ---- geometry --------------------------------------------------------------

/**
 * Accumulate bbox extents from a polygon's outer ring. Returns true if
 * any point was added; false on malformed input.
 */
function accumulateBbox(
  coords: number[][][],
  acc: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): boolean {
  const ring = coords?.[0];
  if (!ring || ring.length < 3) return false;
  for (const pt of ring) {
    if (!pt || pt.length < 2) return false;
    const lng = pt[0];
    const lat = pt[1];
    if (lat === undefined || lng === undefined) return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < acc.minLat) acc.minLat = lat;
    if (lat > acc.maxLat) acc.maxLat = lat;
    if (lng < acc.minLng) acc.minLng = lng;
    if (lng > acc.maxLng) acc.maxLng = lng;
  }
  return true;
}

/**
 * Centroid + radius from one OR MORE bbox polygons (their union).
 *
 * MeteoAlarm/MeteoGate's index returns ONE Feature per (alertId × area ×
 * info_lang) combination, so a multi-region warning shows up as multiple
 * Features with the same alertId, each carrying the bbox of ONE area.
 * Taking the union of those bboxes recovers the full geographic extent
 * of the warning before computing centroid + radius.
 *
 * MQTT delivers a single Feature per message, so the union in that path
 * is trivially just that one Feature's bbox — same math, degenerate case.
 * Multi-region warnings arriving over MQTT come as multiple messages
 * with the same alertId and get eventually-consistent via the persist
 * upsert on (source_id, source_event_id); the REST reconciliation pass
 * later computes the full union.
 *
 * Radius is clamped to [MIN_RADIUS_KM, MAX_RADIUS_KM] — tiny warnings
 * get a generous floor so they still trigger office matches; continental
 * warnings (e.g. a Spain-wide heatwave) get a cap so they don't shadow
 * everything.
 *
 * LIMITATIONS — REUSE WITH CARE:
 *   - Anti-meridian (180°/-180°) wrap is NOT handled. A polygon that
 *     crosses the date line will produce a garbage centroid because the
 *     bbox spans most of the globe in longitude. MeteoAlarm/MeteoGate
 *     warnings are European so this is a non-issue today; if you reuse
 *     this for Pacific or global data, add a wrap check: if
 *     `maxLng - minLng > 180`, normalize one side to ±360 before averaging.
 */
export function unionBboxCentroidAndRadiusKm(
  polygons: number[][][][],
): { lat: number; lng: number; radiusKm: number } | null {
  const acc = { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity };
  let any = false;
  for (const coords of polygons) {
    if (accumulateBbox(coords, acc)) any = true;
  }
  if (!any || !Number.isFinite(acc.minLat) || !Number.isFinite(acc.minLng)) return null;
  const lat = (acc.minLat + acc.maxLat) / 2;
  const lng = (acc.minLng + acc.maxLng) / 2;
  // ~111 km per degree of latitude; longitude scaled by cos(centroid lat).
  const latSpanKm = (acc.maxLat - acc.minLat) * 111;
  const lngSpanKm = (acc.maxLng - acc.minLng) * 111 * Math.cos(lat * Math.PI / 180);
  const halfDiagKm = Math.sqrt(latSpanKm * latSpanKm + lngSpanKm * lngSpanKm) / 2;
  const radiusKm = Math.max(MIN_RADIUS_KM, Math.min(MAX_RADIUS_KM, halfDiagKm));
  return { lat, lng, radiusKm };
}

// ---- CAP JSON helpers ------------------------------------------------------

/**
 * Pick the English info block if present; else the first available.
 * Uses toLowerCase().startsWith('en') to catch both `en` and `en-GB`
 * (direct API returns `en-GB` per the OpenAPI spec).
 */
export function pickInfo(infos: CapJsonInfo[] | undefined): CapJsonInfo | null {
  if (!infos || infos.length === 0) return null;
  const english = infos.find(i => i.language?.toLowerCase().startsWith('en'));
  return english ?? infos[0] ?? null;
}

/**
 * Fetch the CAP JSON variant for a feature by following `links[rel=json]`.
 * The link URL is a presigned DigitalOcean Spaces URL that expires — call
 * this before the presign TTL runs out (typically ~1 hour). No auth needed
 * for the DO Spaces URLs themselves.
 *
 * Returns null on transport failure (logged) or if the feature has no
 * `links[rel=json]` entry. Callers should treat null as a drop condition.
 */
export async function fetchJsonVariant(feature: IndexFeature): Promise<CapJson | null> {
  const link = feature.links.find(l => l.rel === 'json');
  if (!link) return null;
  try {
    const resp = await globalThis.fetch(link.href, {
      headers: { 'User-Agent': 'nr-safety-alerts/0.1' },
    });
    if (!resp.ok) {
      log.warn(
        { alertId: feature.properties.alertId, status: resp.status },
        'meteoalarm.json_variant.failed',
      );
      return null;
    }
    return (await resp.json()) as CapJson;
  } catch (err) {
    log.warn(
      { alertId: feature.properties.alertId, err: (err as Error).message },
      'meteoalarm.json_variant.error',
    );
    return null;
  }
}

// ---- per-alert normalization ----------------------------------------------

export type NormalizeDropReason = 'no_info_block' | 'threshold' | 'no_geometry';

export type NormalizeResult =
  | { kind: 'ok'; item: RawAndNormalized }
  | { kind: 'drop'; reason: NormalizeDropReason; detail?: string };

/**
 * Turn one alert's index features + its CAP JSON into a persist-ready
 * RawAndNormalized item, OR return a drop reason.
 *
 * Called from BOTH the REST adapter's per-alertId loop and the MQTT
 * consumer's per-message handler. Extracted so both paths apply the same
 * threshold rules, geometry math, title/location assembly, and
 * NormalizedEvent shape.
 *
 * `fList` is the list of index Features that share this cap.identifier.
 * REST path: N features per alertId (one per area × info_lang).
 * MQTT path: usually just 1 (per message); duplicate alertIds arriving
 * as separate messages are deduplicated downstream by persist.ts's
 * upsert on (source_id, source_event_id=cap.identifier).
 */
export function normalizeOneAlert(
  fList: IndexFeature[],
  cap: CapJson,
): NormalizeResult {
  const head = fList[0];
  if (!head) return { kind: 'drop', reason: 'no_geometry', detail: 'empty fList' };

  const info = pickInfo(cap.info);
  if (!info) return { kind: 'drop', reason: 'no_info_block' };

  // Threshold gate — Severe (orange) and Extreme (red) only.
  // `titleColor` field unused now; severity is authoritative in JSON.
  const verdict = evaluateMeteoAlarm({
    capSeverity: info.severity,
    titleColor:  '',
  });
  if (!verdict.pass) return { kind: 'drop', reason: 'threshold' };

  // Union of all index features' bboxes for this alertId. Recovers the
  // full geographic extent of multi-region warnings instead of pinning
  // to one sub-region's bbox. In the MQTT path with fList.length=1 the
  // union is just that one bbox.
  const polygons = fList
    .map(f => f.geometry?.coordinates)
    .filter((c): c is number[][][] => !!c);
  if (polygons.length === 0) {
    return { kind: 'drop', reason: 'no_geometry', detail: 'no polygons in any feature' };
  }
  const geom = unionBboxCentroidAndRadiusKm(polygons);
  if (!geom) {
    return { kind: 'drop', reason: 'no_geometry', detail: `union bbox failed, polygonCount=${polygons.length}` };
  }

  // Title + location from the CAP info's area[] (which has the complete
  // list of all affected sub-regions in canonical form, not the per-
  // index-feature splits).
  const eventName = info.event || 'Weather warning';
  const areas = (info.area ?? [])
    .map(a => a.areaDesc)
    .filter((s): s is string => !!s);
  const primaryArea = areas[0] ?? head.properties.countryCode;
  const compositeArea = areas.length > 1
    ? `${primaryArea} (+${areas.length - 1} more)`
    : primaryArea;
  const location = `${compositeArea}, ${head.properties.countryCode}`;

  // Time fields — prefer onset, fall back through effective, then sent,
  // then now. Expires is optional.
  const issuedIso = info.onset || info.effective || cap.sent;
  const issuedAt  = issuedIso ? new Date(issuedIso) : new Date();
  const expiresAt = info.expires ? new Date(info.expires) : null;

  const normalized: NormalizedEvent = {
    sourceEventId:    cap.identifier,
    primarySourceId:  'meteoalarm',
    title:            `${eventName} — ${compositeArea}`,
    summary:          (info.description || `${eventName} active for ${compositeArea}`).slice(0, 1000),
    severity:         verdict.severity!,
    category:         'natural',
    type:             eventName.toLowerCase().replace(/\s+/g, '_'),
    location,
    lat:              geom.lat,
    lng:              geom.lng,
    radiusKm:         geom.radiusKm,
    issuedAt,
    expiresAt,
    // Stable public reference. We can't use links[rel=canonical] because
    // it's a presigned DO Spaces URL that expires; use the producer's
    // public site, country-scoped.
    sourceUrl:        `https://meteoalarm.org/en/live/?country=${head.properties.countryCode.toLowerCase()}`,
  };

  return {
    kind: 'ok',
    item: {
      sourceEventId: cap.identifier,
      // Persist all contributing index features + the CAP so raw_events
      // has full audit context. The persist.ts upsert is on (source_id,
      // source_event_id) so successive cycles / MQTT bursts overwrite
      // cleanly (idempotent by alertId).
      payload: { indexFeatures: fList, cap },
      normalized,
    },
  };
}
