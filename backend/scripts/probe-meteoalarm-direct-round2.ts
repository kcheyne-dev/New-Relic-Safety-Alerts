/**
 * Direct MeteoAlarm API — Round 2 probe.
 *
 * Round 1 (probe-meteoalarm-direct.ts, 2026-07-13) confirmed:
 *   - EDR API is OGC-EDR 1.0 conformant, same seven classes as MeteoGate.
 *   - Single collection `warnings`, same as MeteoGate.
 *   - Path prefix is `/edr/v1` (vs MeteoGate's `/warnings`).
 *   - Auth is `Authorization: Bearer <TOKEN>`.
 *   - Content negotiation is `?f=json`.
 *   - Data query type is `locations` at `/collections/warnings/locations`.
 *
 * Round 2 goes deeper:
 *   1. Fetch the OpenAPI spec (JSON) — gives us the full endpoint catalog
 *      for BOTH the EDR and Metadata APIs. Documents rate limits, error
 *      shapes, pagination limits — everything we've inferred but not
 *      confirmed.
 *   2. Hit `/collections/warnings/locations` — the territory list.
 *      Expect the same 40 codes MeteoGate returns (ALL, MT, SI, ...).
 *   3. Hit `/collections/warnings/locations/ALL?f=json&datetime=<23h>` —
 *      the actual data query. Compare shape against the MeteoGate index
 *      response shape documented in memory/meteogate_api.md.
 *   4. Attempt Metadata API endpoint discovery via its OpenAPI spec.
 *
 * Usage (from backend/):
 *   npx tsx scripts/probe-meteoalarm-direct-round2.ts
 */

import 'dotenv/config';

const TOKEN = process.env.METEOALARM_DIRECT_TOKEN;
const EDR_BASE = 'https://api.meteoalarm.org/edr/v1';
const META_BASE = 'https://api.meteoalarm.org/metadata/v1';

interface ProbeResult {
  url: string;
  status: number;
  ctype: string;
  bodyLen: number;
  bodySnippet: string;
  fullBody: string;
  ok: boolean;
}

async function probe(url: string, snippetLen = 800): Promise<ProbeResult> {
  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN!}`,
        'User-Agent': 'nr-safety-alerts-probe/0.1',
      },
    });
    const body = await resp.text();
    return {
      url,
      status: resp.status,
      ctype: resp.headers.get('content-type') ?? '',
      bodyLen: body.length,
      bodySnippet: body.slice(0, snippetLen),
      fullBody: body,
      ok: resp.ok,
    };
  } catch (err) {
    return {
      url,
      status: -1,
      ctype: '',
      bodyLen: 0,
      bodySnippet: `FETCH_ERROR: ${(err as Error).message}`,
      fullBody: '',
      ok: false,
    };
  }
}

function printSummary(label: string, r: ProbeResult, snippetLen = 800): void {
  const marker = r.ok ? '✓' : '✗';
  console.log('');
  console.log(`${marker} ${label}`);
  console.log(`  URL:    ${r.url}`);
  console.log(`  Status: ${r.status}`);
  console.log(`  Type:   ${r.ctype}`);
  console.log(`  Length: ${r.bodyLen} bytes`);
  console.log(`  Body:   ${r.bodySnippet.slice(0, snippetLen).replace(/\n/g, '\n          ')}${r.bodyLen > snippetLen ? '\n          [...truncated]' : ''}`);
}

/**
 * ISO-8601 datetime range spanning the past 23 hours. MeteoGate's `datetime`
 * parameter is a closed range up to 24h wide; the direct API is expected to
 * follow the same OGC EDR semantics.
 */
function pastRange(hours = 23): string {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  return `${start.toISOString()}/${end.toISOString()}`;
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_DIRECT_TOKEN not set in .env.');
    process.exit(1);
  }

  console.log('MeteoAlarm direct API probe — ROUND 2.');
  console.log('Building on Round 1 findings: OGC EDR conformant, single `warnings` collection.');

  /* ============ Step 1: OpenAPI spec ============ */
  // Round 1 /api response linked the OpenAPI JSON at /edr/v1/docs/openapi.
  // That's the machine-readable contract. Fetching it gives us EVERY
  // endpoint definition, parameter schema, response schema, error
  // responses, and any documented rate limits or deprecation notes.
  console.log('\n--- Step 1: OpenAPI specs (full contracts) ---');
  const edrSpec = await probe(`${EDR_BASE}/docs/openapi`);
  printSummary('EDR OpenAPI spec', edrSpec, 3000);   // longer snippet — this is the important one

  // Attempt Metadata OpenAPI at the mirrored path.
  const metaSpec = await probe(`${META_BASE}/docs/openapi`);
  printSummary('Metadata OpenAPI spec', metaSpec, 3000);

  /* ============ Step 2: territory list ============ */
  console.log('\n--- Step 2: /collections/warnings/locations (territory list) ---');
  const locations = await probe(`${EDR_BASE}/collections/warnings/locations?f=json`);
  printSummary('Locations list', locations, 2500);

  /* ============ Step 3: real data query for ALL ============ */
  const dt = pastRange(23);
  console.log(`\n--- Step 3: real data query — ALL, datetime=${dt} ---`);
  const allData = await probe(
    `${EDR_BASE}/collections/warnings/locations/ALL?f=json&datetime=${encodeURIComponent(dt)}&language=en`,
    2500,
  );
  printSummary('/locations/ALL data query', allData, 2500);

  // Feature count summary if it parsed as GeoJSON FeatureCollection.
  try {
    const parsed = JSON.parse(allData.fullBody);
    if (parsed && Array.isArray(parsed.features)) {
      console.log(`\n  → Parsed as GeoJSON: ${parsed.features.length} features returned.`);
      if (parsed.features[0]) {
        console.log('  → First feature shape (properties keys):');
        console.log('    ' + Object.keys(parsed.features[0].properties || {}).sort().join(', '));
        console.log('  → First feature links (rel values):');
        const links = parsed.features[0].links || [];
        console.log('    ' + links.map((l: { rel: string }) => l.rel).join(', '));
      }
      // Count active vs superseded, if that field exists.
      const supersededCount = parsed.features.filter((f: { properties?: { supersededByAlertId?: string | null } }) => f?.properties?.supersededByAlertId).length;
      if (supersededCount) {
        console.log(`  → ${supersededCount} / ${parsed.features.length} features are superseded (drop before CAP fetch).`);
      }
    }
  } catch {
    /* Body wasn't JSON — the printed status/ctype tells the story. */
  }

  /* ============ Step 4: Metadata API portal HTML extraction ============ */
  // The Metadata root is HTML (Phoenix LiveView). Same technique the
  // MeteoGate discovery used: fetch the portal, extract data-phx-link
  // and href paths, probe each.
  console.log('\n--- Step 4: Metadata API portal — extract internal paths ---');
  const metaRoot = await probe(`${META_BASE}/`);
  if (metaRoot.ok && metaRoot.ctype.includes('text/html')) {
    const html = metaRoot.fullBody;
    const paths = new Set<string>();
    const patterns = [
      /\bhref=["']([^"'#?]+)["']/g,
      /\bdata-[a-z-]+=["'](\/[^"'#?]+)["']/g,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        if (m[1].startsWith('/metadata/v1/') && !m[1].match(/\.(css|js|png|svg|ico)$/)) {
          paths.add(m[1].split('?')[0]);
        }
      }
    }
    const list = [...paths].sort();
    console.log(`  Found ${list.length} internal /metadata/v1/ paths:`);
    list.forEach(p => console.log(`    ${p}`));

    // Probe the first few as JSON.
    console.log('\n  Probing top 5 as JSON:');
    for (const p of list.slice(0, 5)) {
      const r = await probe(`https://api.meteoalarm.org${p}?f=json`, 200);
      console.log(`    [${r.status}] ${r.ctype.slice(0, 30)} ${p}`);
    }
  } else {
    console.log('  Metadata root did not return HTML — skipping extraction.');
  }

  console.log('');
  console.log('---');
  console.log('Round 2 complete. Paste output back so the comparison doc can be');
  console.log('finalized and a decision (swap / fallback / hold) made on concrete data.');
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
