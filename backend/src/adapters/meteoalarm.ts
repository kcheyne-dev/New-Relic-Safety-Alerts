import type { SourceAdapter, RawAndNormalized, NormalizedEvent } from '../types.js';
import { evaluateMeteoAlarm } from '../pipeline/thresholds.js';
import { log } from '../log.js';

/**
 * MeteoAlarm — European weather warnings via the MeteoGate OGC EDR API.
 *
 * UPSTREAM (the data): MeteoAlarm, the EUMETNET-operated aggregation of CAP 1.2
 * warning messages authored by each member country's national meteorological
 * agency (DWD Germany, AEMET Spain, Met Éireann Ireland, Météo-France, etc.).
 *
 * TRANSPORT (this adapter): MeteoGate (`api.meteogate.eu`) — the modern
 * OGC API-EDR gateway. Replaces the 2026-06-24 "MeteoAlarm REVIVED" per-country
 * Atom+CAP1.2 fan-out with a single index call returning GeoJSON. See
 * memory/meteogate_api.md for full architecture notes from the 2026-06-29
 * night discovery session (probe scripts in backend/scripts/probe-meteogate-*).
 *
 * AUTH: `apikey: <TOKEN>` header. Token comes from METEOGATE_API_KEY
 * (preferred) or METEOALARM_API_KEY (legacy alias — kept for back-compat).
 *
 * PIPELINE per cycle:
 *
 *   1. GET /warnings/collections/warnings/locations/ALL
 *      with `?f=json&datetime=<now-23h>/<now>&language=en`.
 *      Returns a GeoJSON FeatureCollection of alert REFERENCES (bbox geometry
 *      + alertId + countryCode + supersede metadata + hubLink). Each is a
 *      lightweight pointer, NOT the full warning content.
 *
 *   2. Drop superseded references (`supersededByAlertId != null`). DWD
 *      reissues warnings as Updates every ~30 min — live sample showed an
 *      81% supersede ratio. The server tracks this for us so we don't have
 *      to chain by `<references>` CAP fields.
 *
 *   3. Fetch each survivor's JSON variant (`links[rel=json]`) in parallel.
 *      These are presigned DigitalOcean Spaces URLs returning the CAP
 *      message as native JSON (no XML parsing). No auth required for the
 *      Spaces URLs themselves.
 *
 *   4. Pick the `info[]` block with `language='en'` if present; fall back
 *      to the first block. Some agencies (notably DWD) don't translate,
 *      so the operator may see native-language event/description text —
 *      acceptable as it preserves the authoritative wording.
 *
 *   5. Apply `evaluateMeteoAlarm` threshold on `info.severity`
 *      (Severe→high, Extreme→ext; Moderate/Minor/Unknown drop).
 *
 *   6. Compute lat/lng/radiusKm from the index feature's bbox polygon
 *      (centroid + half-diagonal, bounded to [30, 300] km). The bbox is
 *      the union of all individual area polygons for the warning. No
 *      Nominatim geocoding needed — kills the 2026-06-24 Null Island bug
 *      at the source.
 *
 * WHY KEEP `id: 'meteoalarm'` (NOT 'meteogate'):
 *   - Existing rows in `events` and `raw_events` are keyed on this id
 *   - Threshold rule `evaluateMeteoAlarm` and dashboard source labeling
 *     are wired to it
 *   - MeteoGate is just the transport; MeteoAlarm is the data producer
 *     and the brand operators recognize
 *
 * SERVER-IMPOSED CONSTRAINTS:
 *   - 24-hour `sent_range` (datetime) max — enforced server-side, hard 400.
 *     We use a rolling 23h window. With 15-min cycle interval (default)
 *     the idempotent `(source_id, source_event_id)` upsert in persist.ts
 *     handles overlap for free.
 *   - 100 features per page. In live sampling only ~19/100 are
 *     non-superseded, so first page is normally enough. Pagination is a
 *     TODO if a busy weather day pushes us past 100 active references.
 *   - No explicit `Accept` header — server 406s `application/json`. The
 *     `?f=json` query param does content negotiation.
 *
 * UK COVERAGE: restored. The 2026-06-24 note "UK gap accepted (Met Office
 * pulled out of MeteoAlarm)" was true for the legacy Atom feed but UK is
 * back in the MeteoGate location list. No special-casing needed — UK
 * warnings flow through `/locations/ALL` like everything else.
 *
 * LICENSE: each CAP message is CC BY 4.0 with the producing agency
 * preserved in `info.contact`. Internal CMT use only; no public
 * redistribution.
 */

const API_BASE = 'https://api.meteogate.eu';
const COLLECTION_PATH = '/warnings/collections/warnings/locations/ALL';

/** Radius bounds applied to the bbox-derived warning radius. */
const MIN_RADIUS_KM = 30;
const MAX_RADIUS_KM = 300;

function getApiKey(): string | null {
  // Preferred name first; fall back to the legacy name so existing .env
  // files keep working without immediate edits. We renamed the discovery
  // probes' env-var preference 2026-06-29 night after realizing the token
  // is for MeteoGate, not MeteoAlarm. See memory/meteogate_api.md.
  return process.env.METEOGATE_API_KEY || process.env.METEOALARM_API_KEY || null;
}

// ---- types -----------------------------------------------------------------

interface IndexFeatureProps {
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
interface IndexFeature {
  id?: string;
  type: 'Feature';
  geometry: { type: string; coordinates: number[][][] } | null;
  properties: IndexFeatureProps;
  links: Array<{ rel: string; type: string; href: string }>;
}
interface IndexResponse {
  type: 'FeatureCollection';
  features?: IndexFeature[];
}

/** CAP 1.2 info block, as flattened to JSON by MeteoGate. */
interface CapJsonInfo {
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

/** CAP 1.2 envelope, as flattened to JSON by MeteoGate. */
interface CapJson {
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

// ---- helpers ---------------------------------------------------------------

/**
 * Accumulate bbox extents from a polygon's outer ring. Returns null on
 * malformed input.
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
 * MeteoGate's index returns ONE Feature per (alertId × area × info_lang)
 * combination, so a multi-region warning shows up as multiple Features
 * with the same alertId, each carrying the bbox of ONE area. Taking the
 * union of those bboxes recovers the full geographic extent of the
 * warning before computing centroid + radius.
 *
 * Radius is clamped to [MIN_RADIUS_KM, MAX_RADIUS_KM] — tiny warnings get
 * a generous floor so they still trigger office matches; continental
 * warnings (e.g. a Spain-wide heatwave) get a cap so they don't shadow
 * everything.
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

/** Pick the English info block if present; else the first available. */
function pickInfo(infos: CapJsonInfo[] | undefined): CapJsonInfo | null {
  if (!infos || infos.length === 0) return null;
  const english = infos.find(i => i.language?.toLowerCase().startsWith('en'));
  return english ?? infos[0] ?? null;
}

async function fetchJsonVariant(feature: IndexFeature): Promise<CapJson | null> {
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

// ---- adapter ---------------------------------------------------------------

export const meteoalarmAdapter: SourceAdapter = {
  id: 'meteoalarm',
  name: 'MeteoAlarm — European weather warnings (via MeteoGate)',
  intervalSeconds: 900,

  async fetch(): Promise<RawAndNormalized[]> {
    const apiKey = getApiKey();
    if (!apiKey) {
      log.warn({}, 'meteoalarm.no_api_key');
      return [];
    }

    // 1. Build 23-hour window (24h max enforced server-side).
    const now = new Date();
    const nowMinus23h = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      f: 'json',
      language: 'en',
      datetime: `${nowMinus23h.toISOString()}/${now.toISOString()}`,
    });
    const url = `${API_BASE}${COLLECTION_PATH}?${params}`;

    // 2. Fetch the index. NO Accept header — server 406s `application/json`;
    //    `?f=json` content-negotiates correctly without it.
    let idxResp: Response;
    try {
      idxResp = await globalThis.fetch(url, {
        headers: { apikey: apiKey, 'User-Agent': 'nr-safety-alerts/0.1' },
      });
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'meteoalarm.index.error');
      return [];
    }
    if (idxResp.status === 204) {
      log.info({}, 'meteoalarm.fetched.empty');
      return [];
    }
    if (!idxResp.ok) {
      log.warn({ status: idxResp.status }, 'meteoalarm.index.failed');
      return [];
    }
    const idx = (await idxResp.json()) as IndexResponse;
    const features = idx.features ?? [];

    // 3. Drop superseded references — server tells us which is which.
    const activeFeatures = features.filter(f => !f.properties.supersededByAlertId);

    // 4. Group by alertId — the index emits one Feature per (area × info)
    //    combination, so a multi-region warning appears multiple times with
    //    the same alertId pointing at the same CAP JSON. Dedupe so we fetch
    //    each CAP once and emit one NormalizedEvent per warning, with a
    //    union bbox covering all the per-area features.
    const groupedById = new Map<string, IndexFeature[]>();
    for (const f of activeFeatures) {
      const id = f.properties.alertId;
      if (!id) continue;
      const list = groupedById.get(id);
      if (list) list.push(f);
      else groupedById.set(id, [f]);
    }
    log.debug(
      {
        total:        features.length,
        active:       activeFeatures.length,
        superseded:   features.length - activeFeatures.length,
        uniqueAlerts: groupedById.size,
      },
      'meteoalarm.index.filtered',
    );

    // 5. Fetch JSON variants — one per unique alertId, in parallel.
    const groups = [...groupedById.entries()];
    const jsonResults = await Promise.all(
      groups.map(([, fList]) => {
        const first = fList[0];
        return first ? fetchJsonVariant(first) : Promise.resolve(null);
      }),
    );

    // 6. Build NormalizedEvents — one per unique alertId.
    const items: RawAndNormalized[] = [];
    let droppedThreshold  = 0;
    let droppedNoGeometry = 0;
    let droppedNoContent  = 0;
    for (let i = 0; i < groups.length; i++) {
      const entry = groups[i];
      const cap   = jsonResults[i];
      if (!entry) continue;
      const [, fList] = entry;
      const head = fList[0];
      if (!head) continue;
      if (!cap) { droppedNoContent++; continue; }

      const info = pickInfo(cap.info);
      if (!info) { droppedNoContent++; continue; }

      // Threshold gate — Severe (orange) and Extreme (red) only.
      // `titleColor` field unused now; severity is authoritative in JSON.
      const verdict = evaluateMeteoAlarm({
        capSeverity: info.severity,
        titleColor:  '',
      });
      if (!verdict.pass) { droppedThreshold++; continue; }

      // Union of all index features' bboxes for this alertId. Recovers the
      // full geographic extent of multi-region warnings instead of pinning
      // to one sub-region's bbox.
      const polygons = fList
        .map(f => f.geometry?.coordinates)
        .filter((c): c is number[][][] => !!c);
      if (polygons.length === 0) { droppedNoGeometry++; continue; }
      const geom = unionBboxCentroidAndRadiusKm(polygons);
      if (!geom) { droppedNoGeometry++; continue; }

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
      items.push({
        sourceEventId: cap.identifier,
        // Persist all contributing index features + the CAP so raw_events
        // has full audit context. The persist.ts upsert is on (source_id,
        // source_event_id) so successive cycles overwrite cleanly.
        payload: { indexFeatures: fList, cap },
        normalized,
      });
    }

    log.info(
      {
        kept:               items.length,
        droppedThreshold,
        droppedNoGeometry,
        droppedNoContent,
        uniqueAlerts:       groupedById.size,
        activeIndexFeatures: activeFeatures.length,
        totalIndexFeatures:  features.length,
      },
      'meteoalarm.filtered',
    );
    return items;
  },
};
