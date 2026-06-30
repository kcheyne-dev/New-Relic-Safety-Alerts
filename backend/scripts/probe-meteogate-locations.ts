/**
 * MeteoGate locations data probe — stage 6, the payoff.
 *
 * Stage 5 confirmed the collection: `warnings` at
 *   /warnings/collections/warnings/locations
 * Returns GeoJSON. Supports filters: awareness_level (2/3/4), awareness_type
 * (1-15), active (ISO 8601 interval), language, page.
 *
 * Plan for adapter rewrite:
 *   - Single call: GET /warnings/collections/warnings/locations
 *       ?f=json
 *       &awareness_level=3,4         (orange + red only, drops yellow at wire)
 *       &active=<now-style>
 *       &language=en
 *   - Parse GeoJSON FeatureCollection
 *   - Each Feature.geometry → lat/lng/radiusKm (proper geometry, no Null Island)
 *   - Each Feature.properties → severity/title/summary/issuedAt/expiresAt
 *
 * This probe inspects the response so we know exactly what's in
 * Feature.properties to map onto NormalizedEvent.
 *
 * Usage (from backend/):
 *   npx tsx scripts/probe-meteogate-locations.ts
 */

import 'dotenv/config';

const TOKEN = process.env.METEOALARM_API_KEY;
const API_BASE = 'https://api.meteogate.eu';

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_API_KEY not set.');
    process.exit(1);
  }

  // Filter for orange + red, currently active, English text.
  // `active` left out for first probe — server may have a default; we'll
  // see what comes back. Page 1 keeps response size reasonable.
  const params = new URLSearchParams({
    f: 'json',
    awareness_level: '3,4',
    language: 'en',
    page: '1',
  });
  const url = `${API_BASE}/warnings/collections/warnings/locations?${params}`;

  console.log(`GET ${url.replace(/apikey=[^&]+/g, 'apikey=REDACTED')}`);
  console.log(`(token in apikey header, ${TOKEN.length} chars; value NOT printed)`);
  console.log('');

  const resp = await fetch(url, {
    headers: {
      apikey: TOKEN,
      'User-Agent': 'nr-safety-alerts-probe/0.1',
    },
  });
  console.log(`HTTP ${resp.status}  ${resp.headers.get('content-type')}`);
  console.log('');

  if (!resp.ok) {
    console.error('Failed. Body (first 1000 chars):');
    console.error((await resp.text()).slice(0, 1000));
    process.exit(2);
  }

  interface GeoJsonFeature {
    type: 'Feature';
    id?: string | number;
    geometry: { type: string; coordinates: unknown } | null;
    properties: Record<string, unknown> | null;
  }
  interface FeatureCollection {
    type: string;
    features?: GeoJsonFeature[];
    numberMatched?: number;
    numberReturned?: number;
    links?: Array<{ href: string; rel: string; title?: string }>;
    timeStamp?: string;
  }

  const body = await resp.text();
  let fc: FeatureCollection;
  try {
    fc = JSON.parse(body);
  } catch (e) {
    console.error('Body is not JSON:');
    console.error(body.slice(0, 800));
    process.exit(3);
  }

  console.log(`Top-level keys: ${Object.keys(fc).join(', ')}`);
  console.log(`type: ${fc.type}`);
  if (fc.numberMatched !== undefined) console.log(`numberMatched (total): ${fc.numberMatched}`);
  if (fc.numberReturned !== undefined) console.log(`numberReturned (page): ${fc.numberReturned}`);
  if (fc.timeStamp) console.log(`timeStamp: ${fc.timeStamp}`);
  console.log('');

  const features = fc.features ?? [];
  console.log(`Feature count this page: ${features.length}`);
  console.log('');

  if (features.length === 0) {
    console.log('No features. May need active=<now> param. Trying a broader query...');
    return;
  }

  // Inspect first feature in detail
  const f0 = features[0];
  console.log('=== First feature ===');
  console.log(`id: ${f0.id ?? '(none)'}`);
  console.log(`geometry.type: ${f0.geometry?.type ?? '(null)'}`);
  if (f0.geometry) {
    const coords = JSON.stringify(f0.geometry.coordinates);
    console.log(`geometry.coordinates: ${coords.length > 200 ? coords.slice(0, 200) + '…' : coords}`);
  }
  if (f0.properties) {
    console.log(`properties keys (${Object.keys(f0.properties).length}): ${Object.keys(f0.properties).join(', ')}`);
    console.log('');
    console.log('properties (first 2000 chars of JSON):');
    console.log('─'.repeat(70));
    console.log(JSON.stringify(f0.properties, null, 2).slice(0, 2000));
    console.log('─'.repeat(70));
  }
  console.log('');

  // Tally by awareness_level + awareness_type for visibility
  const levelTally = new Map<string, number>();
  const typeTally = new Map<string, number>();
  for (const f of features) {
    const props = f.properties ?? {};
    const lvl = String((props as Record<string, unknown>).awareness_level ?? '?');
    const typ = String((props as Record<string, unknown>).awareness_type ?? '?');
    levelTally.set(lvl, (levelTally.get(lvl) ?? 0) + 1);
    typeTally.set(typ, (typeTally.get(typ) ?? 0) + 1);
  }
  console.log('=== Tallies across this page ===');
  console.log('by awareness_level:');
  for (const [k, v] of [...levelTally.entries()].sort()) console.log(`  ${k}: ${v}`);
  console.log('by awareness_type:');
  for (const [k, v] of [...typeTally.entries()].sort()) console.log(`  ${k}: ${v}`);

  // Pagination hint
  if (fc.links) {
    const next = fc.links.find((l) => l.rel === 'next');
    if (next) console.log(`\nNext page available: ${next.href}`);
  }
}

main().catch((err: unknown) => {
  console.error('Probe failed:', err);
  process.exit(3);
});
