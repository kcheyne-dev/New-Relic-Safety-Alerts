/**
 * Fetch the direct MeteoAlarm EDR OpenAPI spec and save to disk.
 *
 * Round 3 probe (probe-meteoalarm-direct-round3.ts) discovered the spec
 * at /edr/v1/docs/openapi.yaml — 19KB, YAML format only (the JSON variant
 * advertised by /api's response returns 404). Round 3 printed the first
 * 1500 chars; this script writes the full document to disk so an
 * out-of-band review can inspect rate limits, error schemas, parameter
 * constraints, and any capability we haven't discovered yet.
 *
 * Writes to: docs/meteoalarm-openapi-fetched.yaml (gitignored).
 *
 * Usage (from backend/):
 *   npx tsx scripts/fetch-meteoalarm-openapi.ts
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const TOKEN = process.env.METEOALARM_DIRECT_TOKEN;
const SPEC_URL = 'https://api.meteoalarm.org/edr/v1/docs/openapi.yaml';
const OUT_PATH = resolve('..', 'docs', 'meteoalarm-openapi-fetched.yaml');

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_DIRECT_TOKEN not set in .env.');
    process.exit(1);
  }

  console.log(`Fetching ${SPEC_URL} …`);
  const resp = await fetch(SPEC_URL, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'nr-safety-alerts-probe/0.1',
    },
  });
  console.log(`  Status: ${resp.status}  Type: ${resp.headers.get('content-type')}`);
  if (!resp.ok) {
    console.error(`FAIL: HTTP ${resp.status}. Body:`);
    console.error(await resp.text());
    process.exit(1);
  }
  const body = await resp.text();
  console.log(`  Length: ${body.length} bytes`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, body, 'utf8');
  console.log(`  ✓ Written to ${OUT_PATH}`);
  console.log('');
  console.log('The file is gitignored (docs/meteoalarm-openapi-fetched.yaml).');
  console.log('Safe to inspect / paste sections into a Claude session for review.');
}

main().catch((err) => {
  console.error('Fetch failed:', err);
  process.exit(1);
});
