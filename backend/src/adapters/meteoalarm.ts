import type { SourceAdapter, RawAndNormalized } from '../types.js';
import { log } from '../log.js';
import {
  type CapJson,
  type IndexFeature,
  type IndexResponse,
  fetchJsonVariant,
  normalizeOneAlert,
} from './meteoalarm-shared.js';

/**
 * MeteoAlarm — European weather warnings via an OGC EDR API.
 *
 * UPSTREAM (the data): MeteoAlarm, the EUMETNET-operated aggregation of CAP 1.2
 * warning messages authored by each member country's national meteorological
 * agency (DWD Germany, AEMET Spain, Met Éireann Ireland, Météo-France, etc.).
 *
 * TRANSPORT (this adapter, TWO PROVIDERS supported):
 *
 *   1. **meteoalarm-direct** (default) — `api.meteoalarm.org/edr/v1`
 *      OGC EDR API. Direct upstream, no intermediary. Auth via
 *      `Authorization: Bearer <TOKEN>` header. Token: METEOALARM_DIRECT_TOKEN.
 *      Ratcheted to default on 2026-08-06 after 24+ days of clean prod
 *      cycles. See docs/meteoalarm-direct-vs-meteogate.md.
 *
 *   2. **meteogate** — `api.meteogate.eu` OGC API-EDR gateway. Legacy
 *      intermediary; byte-for-byte response-compatible with direct.
 *      Auth via `apikey: <TOKEN>` header. Token: METEOGATE_API_KEY
 *      (preferred) or METEOALARM_API_KEY (legacy alias). Kept as a
 *      fallback in case api.meteoalarm.org has an outage or policy
 *      change. See memory/meteogate_api.md.
 *
 * PROVIDER SELECTION: `METEOALARM_PROVIDER` env var accepts `meteogate`,
 * `meteoalarm-direct`, or `direct` (shorthand). Defaults to
 * `meteoalarm-direct`. Rollback: set `METEOALARM_PROVIDER=meteogate` in
 * `.env` + `launchctl kickstart -k gui/$(id -u)/com.newrelic.nrsa-backend`.
 *
 * BASE URL OVERRIDE: `METEOALARM_BASE_URL_OVERRIDE` optional. Only useful
 * for the direct provider's test / staging environments:
 *   - `https://api-test.meteoalarm.org` — test system
 *   - `https://api.met.dev` — staging system
 * When set, replaces the provider's default baseUrl. The collectionPath +
 * auth pattern stay the same. Setting this for the meteogate provider is
 * unsupported and will likely 404.
 *
 * PIPELINE per cycle (identical for both providers):
 *
 *   1. GET <baseUrl><collectionPath> with `?f=json&datetime=<now-23h>/<now>&language=<lang>`.
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
 *   - 100 features per page. Pagination is implemented (see the batchLoop
 *     block in fetch() — MAX_PAGES=25, CONCURRENCY=5, stop-signals for
 *     empty/partial/cap/error). Live during Swiss thunderstorm peak
 *     2026-06-29 pulled all 25 pages; `max_pages_hit` warn fires when
 *     the cap is reached with a full last page.
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

/**
 * Provider config. Selected at fetch time from METEOALARM_PROVIDER env var.
 * The two providers serve the same data (both are OGC EDR views over
 * MeteoAlarm CAP messages) but differ in base URL, auth pattern, and
 * language-param locale format. See file docblock for full comparison.
 */
type MeteoProvider = 'meteogate' | 'meteoalarm-direct';

interface ProviderConfig {
  /** Human label for logs / error messages. */
  label: string;
  /** Scheme + host, no trailing slash. */
  baseUrl: string;
  /** Path from baseUrl to the /locations/ALL endpoint. Leading slash. */
  collectionPath: string;
  /** Language query-param value. MeteoGate accepts bare `en`; direct API
   *  wants a locale like `en-GB`. */
  language: string;
  /** Env var names, in preference order — first non-empty wins. */
  tokenEnvVars: readonly string[];
  /** Given a token, return the request headers for auth. */
  authHeaders: (token: string) => Record<string, string>;
}

const PROVIDERS: Record<MeteoProvider, ProviderConfig> = {
  meteogate: {
    label:         'MeteoGate (api.meteogate.eu)',
    baseUrl:       'https://api.meteogate.eu',
    collectionPath: '/warnings/collections/warnings/locations/ALL',
    language:      'en',
    // Preferred name first; legacy alias kept so existing .env files
    // continue to work. Renamed 2026-06-29 after realizing the token is
    // for MeteoGate specifically, not MeteoAlarm. See memory/meteogate_api.md.
    tokenEnvVars:  ['METEOGATE_API_KEY', 'METEOALARM_API_KEY'] as const,
    authHeaders:   (token) => ({ apikey: token }),
  },
  'meteoalarm-direct': {
    label:         'MeteoAlarm direct (api.meteoalarm.org/edr/v1)',
    baseUrl:       'https://api.meteoalarm.org',
    collectionPath: '/edr/v1/collections/warnings/locations/ALL',
    // Locale format per the OpenAPI spec — bare `en` may be accepted or
    // may cause empty responses; use `en-GB` to be spec-compliant. The
    // pickInfo() English-block filter uses startsWith('en') so the
    // server's response can carry either `en` or `en-GB` and both match.
    language:      'en-GB',
    tokenEnvVars:  ['METEOALARM_DIRECT_TOKEN'] as const,
    authHeaders:   (token) => ({ Authorization: `Bearer ${token}` }),
  },
};

/**
 * Pick the active provider from env. Defaults to `meteoalarm-direct` —
 * ratcheted from `meteogate` on 2026-08-06 after 24+ days of clean prod
 * cycles (see task #60 / #61 in the sanity-tracker). Direct is the
 * upstream source, needs no intermediary, and has cleaner auth (Bearer
 * vs custom apikey header). Set METEOALARM_PROVIDER=meteogate to fall
 * back to the legacy intermediary if the direct API misbehaves.
 */
function getProvider(): ProviderConfig {
  const raw = process.env.METEOALARM_PROVIDER?.trim().toLowerCase();
  if (raw === 'meteogate') return PROVIDERS.meteogate;
  if (raw && raw !== 'meteoalarm-direct' && raw !== 'direct') {
    log.warn({ provided: raw }, 'meteoalarm.unknown_provider');
  }
  return PROVIDERS['meteoalarm-direct'];
}

/**
 * Optional base-URL override — lets ops point at staging (api-test /
 * api.met.dev) for the direct provider without editing code. When set,
 * replaces the provider's default baseUrl but keeps collectionPath +
 * auth pattern. Only meaningful for the direct provider today; setting
 * this while using meteogate will almost certainly 404.
 */
function resolveBaseUrl(provider: ProviderConfig): string {
  const override = process.env.METEOALARM_BASE_URL_OVERRIDE?.trim();
  if (override) return override.replace(/\/$/, '');
  return provider.baseUrl;
}

function getApiKey(provider: ProviderConfig): string | null {
  for (const name of provider.tokenEnvVars) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

// Types (IndexFeature, IndexResponse, CapJson, CapJsonInfo), geometry math
// (unionBboxCentroidAndRadiusKm), pickInfo, fetchJsonVariant, and the
// per-alert normalization pipeline (normalizeOneAlert) all extracted to
// backend/src/adapters/meteoalarm-shared.ts on 2026-08-06 (task #63) so
// the MQTT consumer at backend/src/consumers/meteoalarm-mqtt.ts can reuse
// them without duplication.

// ---- adapter ---------------------------------------------------------------

export const meteoalarmAdapter: SourceAdapter = {
  id: 'meteoalarm',
  // Provider-neutral now — transport is decided at fetch time via
  // METEOALARM_PROVIDER (see getProvider). The active provider is logged
  // at info level on every cycle start ('meteoalarm.cycle.start').
  name: 'MeteoAlarm — European weather warnings',
  intervalSeconds: 900,

  async fetch(): Promise<RawAndNormalized[]> {
    const provider = getProvider();
    const baseUrl = resolveBaseUrl(provider);
    const apiKeyMaybe = getApiKey(provider);
    if (!apiKeyMaybe) {
      log.warn(
        { provider: provider.label, expectedEnvVars: provider.tokenEnvVars },
        'meteoalarm.no_api_key',
      );
      return [];
    }
    const apiKey: string = apiKeyMaybe;  // preserves narrowing in nested closures
    const authHeaders = provider.authHeaders(apiKey);
    // Info level so operators can grep logs to confirm which provider ran
    // without enabling debug. Cheap: one line per 15-min cycle.
    log.info({ provider: provider.label, baseUrl }, 'meteoalarm.cycle.start');

    // 1. Build base query params (page is added per iteration).
    const now = new Date();
    const nowMinus23h = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    const baseParams = new URLSearchParams({
      f: 'json',
      language: provider.language,
      datetime: `${nowMinus23h.toISOString()}/${now.toISOString()}`,
    });

    // 2. Paginated index fetch.
    //
    // The server caps each response at PAGE_SIZE features. The first
    // production cycle (2026-06-29) revealed this isn't an edge case: with
    // DWD reissuing warnings every few minutes, page 1 was 100% German
    // alerts and warnings from lower-frequency agencies (CH, IT, ES, BA,
    // …) were silently pushed beyond the wall. Pagination is the
    // difference between a Germany-only feed and a Europe-wide feed.
    //
    // No top-level `links[rel=next]` is provided by the server, so we
    // increment `?page=N`. Pages are fetched in BATCHES of CONCURRENCY in
    // parallel so 25 pages doesn't take 25× the latency. Within a batch
    // we still process results in page order: as soon as any page comes
    // back partial/empty/error, we stop scheduling further batches.
    //
    // Stop signals:
    //   - empty page (HTTP 204 or features.length === 0)        → 'empty'
    //   - partial page (features.length < PAGE_SIZE)            → 'partial'
    //   - MAX_PAGES safety cap (still more data we can't reach) → 'cap'  → WARN
    //   - HTTP error                                            → 'error' → WARN
    //
    // NO Accept header — server 406s `application/json`; `?f=json` is enough.
    const PAGE_SIZE   = 100;
    const MAX_PAGES   = 25;        // 2500 features upper bound per cycle
    const CONCURRENCY = 5;         // parallel fetches per batch

    type PageResult = { pageNum: number; ok: boolean; status: number; features: IndexFeature[]; error?: string };

    async function fetchPage(pageNum: number): Promise<PageResult> {
      const params = new URLSearchParams(baseParams);
      params.set('page', String(pageNum));
      const pageUrl = `${baseUrl}${provider.collectionPath}?${params}`;
      try {
        const resp = await globalThis.fetch(pageUrl, {
          headers: { ...authHeaders, 'User-Agent': 'nr-safety-alerts/0.1' },
        });
        if (resp.status === 204) return { pageNum, ok: true, status: 204, features: [] };
        if (!resp.ok) return { pageNum, ok: false, status: resp.status, features: [] };
        const page = (await resp.json()) as IndexResponse;
        return { pageNum, ok: true, status: resp.status, features: page.features ?? [] };
      } catch (err) {
        return { pageNum, ok: false, status: 0, features: [], error: (err as Error).message };
      }
    }

    const features: IndexFeature[] = [];
    let pagesFetched = 0;
    let stopReason: 'empty' | 'partial' | 'cap' | 'error' = 'cap';

    batchLoop: for (let batchStart = 1; batchStart <= MAX_PAGES; batchStart += CONCURRENCY) {
      const batchPages: number[] = [];
      for (let p = batchStart; p < batchStart + CONCURRENCY && p <= MAX_PAGES; p++) {
        batchPages.push(p);
      }
      const results = await Promise.all(batchPages.map(fetchPage));
      // Process in page order so we stop at the correct page.
      for (const r of results) {
        pagesFetched = r.pageNum;
        if (!r.ok) {
          log.warn(
            { page: r.pageNum, status: r.status, err: r.error },
            r.error ? 'meteoalarm.index.error' : 'meteoalarm.index.failed',
          );
          stopReason = 'error';
          break batchLoop;
        }
        if (r.status === 204) { stopReason = 'empty'; break batchLoop; }
        features.push(...r.features);
        if (r.features.length < PAGE_SIZE) { stopReason = 'partial'; break batchLoop; }
        // Full page → continue.
      }
    }

    // Silent-data-loss signal: we hit the MAX_PAGES cap with a full last
    // page, meaning the server has more we didn't fetch. Operators should
    // raise MAX_PAGES or shorten the datetime window if this fires.
    if (stopReason === 'cap') {
      log.warn(
        { pagesFetched, featuresAccumulated: features.length, maxPages: MAX_PAGES },
        'meteoalarm.index.max_pages_hit',
      );
    }
    log.debug(
      { pagesFetched, stopReason, totalFeatures: features.length },
      'meteoalarm.index.paginated',
    );

    if (features.length === 0) {
      log.info({}, 'meteoalarm.fetched.empty');
      return [];
    }

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

    // 5. Fetch JSON variants — one per unique alertId, batched in parallel.
    //    During severe weather we can have ~100 unique alerts; firing 100
    //    simultaneous fetches at MeteoGate's DO Spaces hub is impolite and
    //    rate-limit-prone. Batched to JSON_FETCH_CONCURRENCY at a time
    //    (review item #4 — bounded parallelism).
    const JSON_FETCH_CONCURRENCY = 10;
    const groups = [...groupedById.entries()];
    const jsonResults: (CapJson | null)[] = new Array(groups.length);
    for (let batchStart = 0; batchStart < groups.length; batchStart += JSON_FETCH_CONCURRENCY) {
      const batch = groups.slice(batchStart, batchStart + JSON_FETCH_CONCURRENCY);
      const settled = await Promise.all(batch.map(([, fList]) => {
        const first = fList[0];
        return first ? fetchJsonVariant(first) : Promise.resolve(null);
      }));
      for (let i = 0; i < settled.length; i++) {
        jsonResults[batchStart + i] = settled[i] ?? null;
      }
    }

    // 6. Build NormalizedEvents — one per unique alertId. All the
    //    threshold/geometry/normalize logic is in meteoalarm-shared.ts
    //    (task #63) so the MQTT consumer can reuse it.
    const items: RawAndNormalized[] = [];
    let droppedThreshold    = 0;
    let droppedNoCap        = 0;   // CAP JSON fetch failed (transport)
    let droppedNoInfoBlock  = 0;   // CAP had no info[] block (upstream malformed)
    let droppedNoGeometry   = 0;
    for (let i = 0; i < groups.length; i++) {
      const entry = groups[i];
      const cap   = jsonResults[i];
      if (!entry) continue;
      const [alertId, fList] = entry;
      if (!cap) {
        droppedNoCap++;
        log.debug({ alertId }, 'meteoalarm.dropped.no_cap');
        continue;
      }

      const result = normalizeOneAlert(fList, cap);
      if (result.kind === 'drop') {
        if (result.reason === 'no_info_block') {
          droppedNoInfoBlock++;
          log.debug({ alertId }, 'meteoalarm.dropped.no_info_block');
        } else if (result.reason === 'threshold') {
          droppedThreshold++;
        } else /* no_geometry */ {
          droppedNoGeometry++;
          log.debug({ alertId, reason: result.detail }, 'meteoalarm.dropped.geometry');
        }
        continue;
      }
      items.push(result.item);
    }

    log.info(
      {
        kept:                items.length,
        droppedThreshold,
        droppedNoCap,
        droppedNoInfoBlock,
        droppedNoGeometry,
        uniqueAlerts:        groupedById.size,
        activeIndexFeatures: activeFeatures.length,
        totalIndexFeatures:  features.length,
      },
      'meteoalarm.filtered',
    );
    return items;
  },
};
