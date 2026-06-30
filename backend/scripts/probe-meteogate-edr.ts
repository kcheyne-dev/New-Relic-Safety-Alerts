/**
 * MeteoGate EDR + Hub probe — stage 4.
 *
 * Stage-3 discovery revealed the portal nav links to three API namespaces:
 *   /edr/v1/   ← OGC Environmental Data Retrieval (standard endpoints known)
 *   /hub/v1/   ← unknown
 *   /metadata/v1/  ← 404 here; likely lives on api.meteoalarm.org
 *
 * EDR is an OGC standard, so the route shapes are predictable:
 *   /collections                      ← list of available data collections
 *   /collections/{id}                 ← collection metadata
 *   /collections/{id}/items           ← features (point data, warnings, etc.)
 *   /collections/{id}/position        ← point query
 *   /collections/{id}/area            ← area query
 *   /conformance                      ← OGC conformance classes
 *   /api                              ← OpenAPI spec
 *
 * Usage (from backend/):
 *   npx tsx scripts/probe-meteogate-edr.ts
 */

import 'dotenv/config';

const TOKEN = process.env.METEOALARM_API_KEY;
const API_BASE = 'https://api.meteogate.eu';

const NAMESPACES = ['/edr/v1', '/hub/v1'];

// OGC EDR standard entrypoints + a few extras
const ENTRYPOINTS = [
  '',                  // namespace root
  '/',
  '/collections',
  '/conformance',
  '/api',
  '/openapi',
  '/openapi.json',
  '/docs',
];

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_API_KEY not set.');
    process.exit(1);
  }
  console.log(`probing EDR + Hub namespaces on ${API_BASE}`);
  console.log(`(token is set, ${TOKEN.length} chars; value NOT printed)`);
  console.log('');

  const hits: { url: string; ctype: string; body: string }[] = [];

  for (const ns of NAMESPACES) {
    console.log(`=== ${ns} ===`);
    for (const ep of ENTRYPOINTS) {
      const path = `${ns}${ep}`;
      const r = await fetch(`${API_BASE}${path}`, {
        headers: {
          apikey: TOKEN,
          Accept: 'application/json',
          'User-Agent': 'nr-safety-alerts-probe/0.1',
        },
      });
      const ctype = r.headers.get('content-type') ?? '(none)';
      const isJson = ctype.includes('json');
      const marker = r.ok ? (isJson ? 'J' : 'H') : (r.status === 401 ? '✗' : '·');
      console.log(`  ${marker} ${String(r.status).padStart(3)} ${path.padEnd(35)} ${ctype}`);
      if (r.ok && isJson) {
        const body = await r.text();
        hits.push({ url: path, ctype, body });
      }
    }
    console.log('');
  }

  console.log('Legend: J=JSON (API hit), H=HTML, ·=4xx, ✗=401');
  console.log('');

  if (hits.length === 0) {
    console.log('No JSON responses. Next step: open https://api.meteogate.eu/ in a browser');
    console.log('and look at the portal navigation for "Routes", "Docs", or specific API names.');
    return;
  }

  console.log(`✓ Found ${hits.length} JSON endpoint(s).`);
  console.log('');
  for (const hit of hits) {
    console.log(`▶ ${hit.url}  (${hit.ctype})`);
    console.log('─'.repeat(70));
    console.log(hit.body.slice(0, 1500));
    console.log('─'.repeat(70));
    console.log('');
  }
}

main().catch((err: unknown) => {
  console.error('Probe failed:', err);
  process.exit(3);
});
