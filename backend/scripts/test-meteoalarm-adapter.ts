/**
 * Smoke test for the rewritten meteoalarm adapter (now MeteoGate-backed).
 *
 * Invokes `meteoalarmAdapter.fetch()` and pretty-prints what it would emit
 * to the persistence layer. Does NOT touch the DB.
 *
 * Usage (from backend/):
 *   npx tsx scripts/test-meteoalarm-adapter.ts
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
    console.log('  - METEOGATE_API_KEY missing or invalid');
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
