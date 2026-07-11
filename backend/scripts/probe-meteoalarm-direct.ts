/**
 * Direct MeteoAlarm API discovery probe.
 *
 * Prompted by 2026-07-13 approval email granting access to:
 *   - https://api.meteoalarm.org/metadata/v1  (Metadata API)
 *   - https://api.meteoalarm.org/edr/v1       (EDR API)
 *
 * Purpose: determine the direct API's exact shape so we can decide whether
 * to swap the current MeteoGate intermediary (`api.meteogate.eu`) for the
 * direct source. See docs/meteoalarm-direct-vs-meteogate.md for the
 * comparison framework.
 *
 * Auth per the approval email: `Authorization: Bearer <TOKEN>` header OR
 * `?token=<TOKEN>` query param. We use the Bearer header — matches every
 * other production adapter's auth pattern (bearer for OAuth, apikey header
 * only for MeteoGate specifically).
 *
 * Token comes from env var METEOALARM_DIRECT_TOKEN. Confirm .env is in
 * .gitignore before running.
 *
 * Usage (from backend/):
 *   npx tsx scripts/probe-meteoalarm-direct.ts
 *
 * What we're testing:
 *   1. Base URL reachability (both metadata + EDR bases).
 *   2. OGC EDR discovery — /collections should list what's available.
 *   3. If /collections works, hit its members with `?f=json` for content
 *      negotiation (same query-param override MeteoGate uses).
 *   4. Compare against known MeteoGate shapes so a diff is obvious in the
 *      output.
 *
 * Output prints URL → HTTP status → content-type → body length → first 800
 * chars of body. Enough to eyeball the shape without dumping a full
 * FeatureCollection.
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
  ok: boolean;
}

/**
 * Fetch with Bearer auth. If a `?f=json` query-param format override is
 * appropriate, callers pass includeFmt=true. We don't send an Accept header
 * — same rationale as the MeteoGate probes: some OGC EDR servers 406 on
 * `application/json` and prefer content negotiation via the query param.
 */
async function probe(url: string, includeFmt = false): Promise<ProbeResult> {
  const finalUrl = includeFmt ? `${url}${url.includes('?') ? '&' : '?'}f=json` : url;
  try {
    const resp = await fetch(finalUrl, {
      headers: {
        Authorization: `Bearer ${TOKEN!}`,
        'User-Agent': 'nr-safety-alerts-probe/0.1',
      },
    });
    const body = await resp.text();
    return {
      url: finalUrl,
      status: resp.status,
      ctype: resp.headers.get('content-type') ?? '',
      bodyLen: body.length,
      bodySnippet: body.slice(0, 800),
      ok: resp.ok,
    };
  } catch (err) {
    return {
      url: finalUrl,
      status: -1,
      ctype: '',
      bodyLen: 0,
      bodySnippet: `FETCH_ERROR: ${(err as Error).message}`,
      ok: false,
    };
  }
}

function printResult(label: string, result: ProbeResult): void {
  const marker = result.ok ? '✓' : '✗';
  console.log('');
  console.log(`${marker} ${label}`);
  console.log(`  URL:    ${result.url}`);
  console.log(`  Status: ${result.status}`);
  console.log(`  Type:   ${result.ctype}`);
  console.log(`  Length: ${result.bodyLen} bytes`);
  console.log(`  Body:   ${result.bodySnippet.replace(/\n/g, '\n          ')}${result.bodyLen > 800 ? '\n          [...truncated]' : ''}`);
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_DIRECT_TOKEN not set in .env.');
    console.error('Add it and rerun. Do NOT commit the .env file.');
    process.exit(1);
  }

  console.log('MeteoAlarm direct API probe — discovering shape of the two v1 APIs.');
  console.log(`EDR base:      ${EDR_BASE}`);
  console.log(`Metadata base: ${META_BASE}`);

  /* ============ Round 1: base URLs (do they respond at all?) ============ */
  console.log('\n--- Round 1: base URL reachability ---');
  printResult('EDR root',      await probe(EDR_BASE));
  printResult('Metadata root', await probe(META_BASE));

  /* ============ Round 2: OGC EDR discovery paths ============ */
  // OGC EDR spec conventionally exposes:
  //   /               — landing page (per OGC EDR-Part-1)
  //   /conformance    — which OGC classes the server implements
  //   /collections    — the list of available data collections
  //   /api            — machine-readable OpenAPI spec
  // MeteoGate followed this exactly (rooted at /warnings). Direct API
  // probably follows the same pattern rooted at /edr/v1.
  console.log('\n--- Round 2: EDR discovery paths (with ?f=json) ---');
  printResult('EDR /conformance', await probe(`${EDR_BASE}/conformance`, true));
  printResult('EDR /collections', await probe(`${EDR_BASE}/collections`, true));
  printResult('EDR /api',         await probe(`${EDR_BASE}/api`,         true));

  /* ============ Round 3: Metadata API — likely has locations/countries ============ */
  // The "Metadata API" is unfamiliar shape. Best guesses based on what
  // it might contain:
  //   /locations     — list of MeteoAlarm territories (countries + regions)
  //   /awareness     — event-type + severity taxonomies
  //   /agencies      — issuing meteorological agencies
  // Try each.
  console.log('\n--- Round 3: Metadata API guesses ---');
  printResult('Meta /',           await probe(`${META_BASE}/`,           true));
  printResult('Meta /locations',  await probe(`${META_BASE}/locations`,  true));
  printResult('Meta /countries',  await probe(`${META_BASE}/countries`,  true));
  printResult('Meta /awareness',  await probe(`${META_BASE}/awareness`,  true));
  printResult('Meta /agencies',   await probe(`${META_BASE}/agencies`,   true));

  /* ============ Round 4: If /collections came back, hit the first one ============ */
  // Left as a TODO — this second-round probe should read the collections
  // list from Round 2 and pick a concrete collection id + a location id
  // to probe an actual data query. Deferred until Round 2 shows us the
  // exact response shape.

  console.log('');
  console.log('---');
  console.log('Interpretation guide:');
  console.log('  200 + application/json = real API endpoint, worth adapter work.');
  console.log('  200 + text/html        = HTML portal, not the machine API path.');
  console.log('  401 / 403              = auth pattern differs from Bearer.');
  console.log('  404                    = wrong path, try adjacent guesses.');
  console.log('  406                    = content negotiation issue; try without ?f=json.');
  console.log('');
  console.log('Next step after this probe:');
  console.log('  Paste the output into the docs/meteoalarm-direct-vs-meteogate.md');
  console.log('  file (or share it in a Claude session) so the comparison can be');
  console.log('  finalized and a swap-vs-keep decision made.');
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
