import { query } from '../db.js';
import { config } from '../config.js';
import { log } from '../log.js';

/**
 * Geocoding service.
 *
 * 1. Looks up the cache table first.
 * 2. On miss, calls Nominatim (free, public) honoring its 1 req/sec usage policy.
 * 3. Caches successes (and failures, with a shorter TTL) to avoid hammering.
 *
 * Note: for production volumes (or anything commercial-scale) you should run
 * your own Nominatim Docker instance — see `docs/self-hosted-geocoding.md`.
 * The public service is rate-limited and asks you to keep it light.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  display: string;
}

const CACHE_HIT_TTL_MS = config.geocode.cacheTtlDays * 24 * 3600 * 1000;
const CACHE_MISS_TTL_MS = 24 * 3600 * 1000;     // re-try unresolved names every 24h

let lastNominatimCallAt = 0;

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Sleep for `ms` milliseconds. Used to honor Nominatim's 1 req/sec policy.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFromNominatim(q: string): Promise<GeocodeResult | null> {
  // Throttle: ensure ≥1.1s between calls. Belt + suspenders.
  const sinceLast = Date.now() - lastNominatimCallAt;
  if (sinceLast < 1100) await sleep(1100 - sinceLast);
  lastNominatimCallAt = Date.now();

  const url = `${config.geocode.nominatimUrl}?q=${encodeURIComponent(q)}&format=json&limit=1`;
  const resp = await globalThis.fetch(url, {
    headers: {
      'User-Agent': config.geocode.nominatimUserAgent,
      'Accept-Language': 'en',
    },
  });
  if (!resp.ok) {
    log.warn({ q, status: resp.status }, 'geocode.http_error');
    return null;
  }
  const data = (await resp.json()) as Array<{
    lat: string; lon: string; display_name: string;
  }>;
  const first = data[0];
  if (!first) return null;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, display: first.display_name };
}

/**
 * Resolve a place name to coordinates. Returns null if unresolvable.
 * Always reads from cache when possible; only hits Nominatim on a miss
 * or expired entry.
 */
export async function geocode(rawQuery: string): Promise<GeocodeResult | null> {
  if (!rawQuery) return null;
  const q = normalizeQuery(rawQuery);

  const cached = await query<{
    lat: number | null; lng: number | null; display: string | null; expires_at: Date | null;
  }>(
    `SELECT lat, lng, display, expires_at FROM geocode_cache WHERE query = $1`,
    [q]
  );
  const row = cached.rows[0];
  if (row && (!row.expires_at || row.expires_at > new Date())) {
    if (row.lat == null || row.lng == null) return null;          // cached miss
    return { lat: row.lat, lng: row.lng, display: row.display ?? rawQuery };
  }

  // Cache miss — fetch from Nominatim
  let result: GeocodeResult | null = null;
  try {
    result = await fetchFromNominatim(q);
  } catch (err) {
    log.warn({ q, err: err instanceof Error ? err.message : String(err) }, 'geocode.fetch_failed');
  }

  const ttl = result ? CACHE_HIT_TTL_MS : CACHE_MISS_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  await query(
    `INSERT INTO geocode_cache (query, lat, lng, display, provider, expires_at)
     VALUES ($1, $2, $3, $4, 'nominatim', $5)
     ON CONFLICT (query) DO UPDATE SET
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       display = EXCLUDED.display,
       fetched_at = NOW(),
       expires_at = EXCLUDED.expires_at`,
    [q, result?.lat ?? null, result?.lng ?? null, result?.display ?? null, expiresAt]
  );

  return result;
}

/**
 * Resolve a normalized event's location to lat/lng IF the event doesn't already
 * have valid coordinates. Mutates the event in place. Returns true if the event
 * is now usable (had or got coords), false if we still couldn't geocode.
 */
export async function ensureCoords(event: { lat: number; lng: number; location: string }): Promise<boolean> {
  if (Number.isFinite(event.lat) && Number.isFinite(event.lng) && event.lat !== 0 && event.lng !== 0) {
    return true;
  }
  if (!event.location) return false;
  const r = await geocode(event.location);
  if (!r) return false;
  event.lat = r.lat;
  event.lng = r.lng;
  return true;
}
