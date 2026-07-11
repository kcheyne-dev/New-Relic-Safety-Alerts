/**
 * Smoke test for the meteoalarm adapter.
 *
 * Invokes `meteoalarmAdapter.fetch()` and pretty-prints what it would emit
 * to the persistence layer. Does NOT touch the DB.
 *
 * Provider selection follows the same env-var contract as the runtime:
 *   METEOALARM_PROVIDER=meteogate           (default; existing prod path)
 *   METEOALARM_PROVIDER=meteoalarm-direct   (direct api.meteoalarm.org)
 * Optional: METEOALARM_BASE_URL_OVERRIDE to point at api-test.meteoalarm.org
 * or api.met.dev while validating a swap.
 *
 * Usage (from backend/):
 *   npx tsx scripts/test-meteoalarm-adapter.ts
 *
 *   # Test the direct provider against staging:
 *   METEOALARM_PROVIDER=meteoalarm-direct \
 *     METEOALARM_BASE_URL_OVERRIDE=https://api-test.meteoalarm.org \
 *     npx tsx scripts/test-meteoalarm-adapter.ts
 */

import 'dotenv/config';
import { meteoalarmAdapter } from '../src/adapters/meteoalarm.js';

async function main(): Promise<void> {
  console.log(`adapter: ${meteoalarmAdapter.id} — ${meteoalarmAdapter.name}`);
  console.log(`intervalSeconds: ${meteoalarmAdapter.intervalSeconds}`);
  console.log('');
  console.log('Fetching...');
  const t0 = Date.now();
  const items = await meteoalarmAdapter.fetch();
  const dt = Date.now() - t0;
  console.log(`Done in ${dt}ms. Emitted ${items.length} normalized event(s).`);
  console.log('');

  if (items.length === 0) {
    console.log('No events emitted. Possible reasons:');
    console.log('  - No Severe/Extreme warnings active in the last 23h');
    console.log('  - Provider token missing (see `meteoalarm.no_api_key` log');
    console.log('    line for which env var the active provider expects)');
    console.log('  - All features were superseded or had no JSON variant');
    console.log('Check the log output above for `meteoalarm.*` lines.');
    return;
  }

  // Summarize one row per event in a compact table.
  console.log('Emitted events:');
  for (const it of items) {
    const n = it.normalized;
    console.log(`  [${n.severity}] ${n.title}`);
    console.log(`         loc=${n.location}`);
    console.log(`         coord=(${n.lat.toFixed(3)}, ${n.lng.toFixed(3)}) radius=${n.radiusKm}km`);
    console.log(`         issued=${n.issuedAt.toISOString()}  expires=${n.expiresAt?.toISOString() ?? '(none)'}`);
    console.log(`         id=${n.sourceEventId.slice(0, 60)}${n.sourceEventId.length > 60 ? '…' : ''}`);
    console.log('');
  }

  // Tally by severity + by country
  const sevTally = new Map<string, number>();
  for (const it of items) {
    const k = it.normalized.severity;
    sevTally.set(k, (sevTally.get(k) ?? 0) + 1);
  }
  console.log('By severity:');
  for (const [k, v] of sevTally) console.log(`  ${k}: ${v}`);
}

main().catch((err: unknown) => {
  console.error('Test failed:', err);
  process.exit(1);
});
