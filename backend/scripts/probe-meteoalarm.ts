/**
 * MeteoGate API probe.
 *
 * NOTE: this is `api.meteogate.eu` (the EUMETNET API gateway), NOT
 * `api.meteoalarm.org` (the MeteoAlarm-specific warning aggregator). They
 * are both EUMETNET projects but have separate domains, separate tokens,
 * and separate auth methods. MeteoGate uses an `apikey:` header.
 *
 * Docs: https://eumetnet.github.io/meteogate-documentation/
 *
 * Verifies the API token works and dumps the response shape so we can
 * write a correct adapter. Safe to share output — does NOT print the
 * token.
 *
 * Usage (from the backend/ directory so dotenv picks up backend/.env):
 *
 *   cd backend
 *   npx tsx scripts/probe-meteoalarm.ts
 *
 * Exit codes:
 *   0  success — schema printed, token works
 *   1  no token in env (METEOALARM_API_KEY missing)
 *   2  API returned non-2xx (token rejected or endpoint down)
 *   3  unexpected error (network, parse, etc.)
 */

import 'dotenv/config';

// Same env var name kept for now to avoid forcing the user to re-edit .env.
// Could rename to METEOGATE_API_KEY in a later pass for clarity.
const TOKEN = process.env.METEOALARM_API_KEY;
const API_BASE = 'https://api.meteogate.eu';

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_API_KEY not set in environment.');
    console.error('  Add it to backend/.env and re-run from the backend/ directory.');
    process.exit(1);
  }

  console.log(`probing ${API_BASE} — sweeping candidate routes`);
  console.log(`(token is set, ${TOKEN.length} chars; value NOT printed)`);
  console.log(`auth: apikey header (per MeteoGate docs)`);
  console.log('');

  // Candidate routes — discovery sweep. Real MeteoGate routes are unknown
  // until we read the docs at https://eumetnet.github.io/meteogate-documentation/,
  // but these are plausible patterns. First 2xx wins; we'll dump its shape.
  const candidates = [
    '/routes',            // common discovery endpoint, doc mentioned "Show Routes"
    '/v1/routes',
    '/api/routes',
    '/openapi.json',
    '/swagger.json',
    '/v1',
    '/api/v1',
    '/warnings',          // MeteoAlarm-style warning data
    '/v1/warnings',
    '/observations',
    '/v1/observations',
    '/radar',
    '/forecasts',
    '/alerts',
    '/v1/alerts',
    '/info',
    '/health',
    '/status',
  ];

  let winningResp: Response | null = null;
  let winningRoute: string | null = null;

  for (const route of candidates) {
    const r = await fetch(`${API_BASE}${route}`, {
      headers: {
        apikey: TOKEN,
        Accept: 'application/json',
        'User-Agent': 'nr-safety-alerts-probe/0.1',
      },
    });
    const ctype = r.headers.get('content-type') ?? '';
    const marker = r.ok ? '✓' : (r.status === 401 ? '✗' : '·');
    console.log(`  ${marker} ${String(r.status).padStart(3)} ${route.padEnd(20)} ${ctype}`);
    if (r.ok && !winningResp) {
      winningResp = r;
      winningRoute = route;
      // Don't break — keep sweeping so we see the full landscape, but only
      // keep the first 2xx for shape inspection.
    }
    // If we get 401 anywhere, the token is bad — bail.
    if (r.status === 401) {
      console.log('');
      console.error('Got 401 — token is being rejected. Bailing out.');
      const errBody = await r.text();
      console.error('Error body:', errBody.slice(0, 500));
      process.exit(2);
    }
  }
  console.log('');

  if (!winningResp || !winningRoute) {
    console.error('No candidate route returned 2xx.');
    console.error('Token is valid (no 401 anywhere) but none of the guessed routes exist.');
    console.error('Next step: visit https://eumetnet.github.io/meteogate-documentation/');
    console.error('and look at the route list. Add the real routes to the candidates list.');
    process.exit(2);
  }

  console.log(`✓ ${winningRoute} returned 2xx — inspecting shape`);
  console.log('');
  const resp = winningResp;

  const json: unknown = await resp.json();
  if (!json || typeof json !== 'object') {
    console.error('FAIL: response body is not a JSON object.');
    process.exit(3);
  }
  const obj = json as Record<string, unknown>;

  console.log('Top-level response keys:', Object.keys(obj));
  console.log('');

  // PaginationMeta (per Swagger UI schemas section)
  const meta = obj.meta ?? obj.pagination ?? obj.paginationMeta;
  if (meta && typeof meta === 'object') {
    console.log('Pagination meta:');
    console.log(JSON.stringify(meta, null, 2));
    console.log('');
  }

  // Find the geocodes array — common key names
  const arr = (obj.geocodes ?? obj.data ?? obj.items ?? obj.results);
  if (!Array.isArray(arr)) {
    console.log('No array found under common keys (geocodes/data/items/results).');
    console.log('Full response (first 2000 chars):');
    console.log(JSON.stringify(json, null, 2).slice(0, 2000));
    return;
  }

  console.log(`Array length (limited to 5): ${arr.length}`);
  console.log('');
  if (arr.length === 0) {
    console.log('Array is empty. Cannot inspect entry shape.');
    return;
  }

  const first = arr[0];
  if (typeof first !== 'object' || first === null) {
    console.log('First entry is not an object:', typeof first);
    return;
  }

  console.log('First entry keys:', Object.keys(first as Record<string, unknown>));
  console.log('');

  // Pretty-print the first 1500 chars of the first entry. Coordinates are
  // public EU data so this is safe to share.
  console.log('First entry (first 1500 chars):');
  console.log(JSON.stringify(first, null, 2).slice(0, 1500));
  console.log('');

  // Hunt for coordinate-like fields to confirm the geometry representation
  const fields = first as Record<string, unknown>;
  const coordHints: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const kLower = k.toLowerCase();
    if (kLower.includes('lat') || kLower.includes('lon') || kLower.includes('lng') ||
        kLower.includes('coord') || kLower.includes('geom') || kLower === 'centroid' ||
        kLower === 'center' || kLower === 'point' || kLower === 'bbox') {
      coordHints.push(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v)}`);
    }
  }
  if (coordHints.length > 0) {
    console.log('Coordinate-relevant fields detected:');
    coordHints.forEach(line => console.log(line));
  } else {
    console.log('No obvious coordinate fields detected. May need to look at /regions or use centroid of polygon geometry.');
  }
}

main().catch((err: unknown) => {
  console.error('Probe failed:', err);
  process.exit(3);
});
