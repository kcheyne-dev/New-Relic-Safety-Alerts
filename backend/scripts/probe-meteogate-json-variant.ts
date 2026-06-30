/**
 * MeteoGate JSON-variant probe — last discovery question.
 *
 * Index feature.links contains BOTH:
 *   { rel: "canonical", type: "application/xml",  href: <CAP XML> }
 *   { rel: "json",      type: "application/json", href: <JSON variant> }
 *
 * If the JSON variant has the same fields the CAP XML has (severity, event,
 * sent, effective, expires, areaDesc, polygon, awareness_level/type codes),
 * the adapter can skip CAP XML parsing entirely and use JSON natively. This
 * is a significant simplification — drops the fast-xml-parser dependency and
 * the existing CAP parser code from the legacy adapter.
 *
 * This probe:
 *   1. Fetches the index for /locations/ALL
 *   2. Finds the first non-superseded feature
 *   3. Fetches BOTH the CAP XML and the JSON variant
 *   4. Reports the JSON shape + dumps it side-by-side
 *
 * Usage (from backend/):
 *   npx tsx scripts/probe-meteogate-json-variant.ts
 */

import 'dotenv/config';

const TOKEN = process.env.METEOALARM_API_KEY;
const API_BASE = 'https://api.meteogate.eu';

async function main(): Promise<void> {
  if (!TOKEN) { console.error('FAIL: METEOALARM_API_KEY not set.'); process.exit(1); }

  // 1. Get the index
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMinus23h = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    f: 'json',
    language: 'en',
    datetime: `${nowMinus23h}/${nowIso}`,
  });

  console.log('Fetching index /locations/ALL ...');
  const idxResp = await fetch(`${API_BASE}/warnings/collections/warnings/locations/ALL?${params}`, {
    headers: { apikey: TOKEN, 'User-Agent': 'nr-safety-alerts-probe/0.1' },
  });
  console.log(`  HTTP ${idxResp.status}`);
  if (!idxResp.ok) { console.error(await idxResp.text()); process.exit(2); }

  interface Feature {
    id?: string;
    properties?: Record<string, unknown>;
    links?: Array<{ rel: string; type: string; href: string }>;
  }
  const idx = (await idxResp.json()) as { features?: Feature[] };
  const features = idx.features ?? [];
  console.log(`  ${features.length} features`);

  // Find first non-superseded
  const active = features.find((f) => {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    return !p.supersededByAlertId;
  });
  if (!active) { console.log('No active features. Try later.'); process.exit(0); }

  console.log(`  picked active alertId: ${(active.properties as Record<string, unknown>).alertId}`);
  console.log('');

  // 2. Get the JSON and XML links
  const jsonLink = active.links?.find((l) => l.rel === 'json');
  const xmlLink  = active.links?.find((l) => l.rel === 'canonical');
  const geoLink  = active.links?.find((l) => l.rel === 'geometry');

  if (!jsonLink) { console.error('No rel=json link.'); process.exit(2); }

  console.log(`Fetching JSON variant ...`);
  const jsonResp = await fetch(jsonLink.href, { headers: { 'User-Agent': 'nr-safety-alerts-probe/0.1' } });
  console.log(`  HTTP ${jsonResp.status}  ${jsonResp.headers.get('content-type')}`);
  if (!jsonResp.ok) { console.error(await jsonResp.text()); process.exit(2); }
  const jsonBody = await jsonResp.text();
  let jsonObj: unknown;
  try { jsonObj = JSON.parse(jsonBody); } catch (e) {
    console.error('Not JSON despite content-type. First 500:', jsonBody.slice(0, 500));
    process.exit(3);
  }

  console.log('');
  console.log('=== JSON variant top-level keys ===');
  if (jsonObj && typeof jsonObj === 'object') {
    console.log(Object.keys(jsonObj as Record<string, unknown>));
  }
  console.log('');
  console.log('=== JSON variant (first 3500 chars, pretty) ===');
  console.log('─'.repeat(70));
  console.log(JSON.stringify(jsonObj, null, 2).slice(0, 3500));
  console.log('─'.repeat(70));

  // 3. Fetch geometry link too, since adapter wants exact polygon not bbox
  if (geoLink) {
    console.log('');
    console.log(`Fetching geometry variant (rel=geometry) ...`);
    const geoResp = await fetch(geoLink.href, { headers: { 'User-Agent': 'nr-safety-alerts-probe/0.1' } });
    console.log(`  HTTP ${geoResp.status}  ${geoResp.headers.get('content-type')}`);
    if (geoResp.ok) {
      const geoBody = await geoResp.text();
      const geo: unknown = JSON.parse(geoBody);
      console.log(`  geometry top-level keys: ${Object.keys(geo as Record<string, unknown>).join(', ')}`);
      console.log('');
      console.log('=== Geometry (first 1500 chars) ===');
      console.log('─'.repeat(70));
      console.log(JSON.stringify(geo, null, 2).slice(0, 1500));
      console.log('─'.repeat(70));
    }
  }
}

main().catch((err: unknown) => { console.error('Probe failed:', err); process.exit(3); });
