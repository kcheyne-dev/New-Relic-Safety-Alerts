/**
 * MeteoGate /warnings probe — stage 2.
 *
 * Stage-1 sweep (probe-meteoalarm.ts) confirmed:
 *   - api.meteogate.eu auth is solid (apikey header)
 *   - /health returns 200 {"message":"OK"}
 *   - /warnings returns 406 Not Acceptable when Accept: application/json
 *
 * 406 means the route EXISTS but doesn't speak JSON. Same pattern as the
 * MeteoAlarm legacy Atom feed (2026-06-24 fix: drop Accept header, server
 * 406s anything but the wildcard). Here we try several Accept headers in
 * turn and report which one the server accepts plus a sample of the body
 * so we can see whether it's CAP XML, plain XML, JSON, NDJSON, etc.
 *
 * Usage (from backend/):
 *   npx tsx scripts/probe-meteogate-warnings.ts
 */

import 'dotenv/config';

const TOKEN = process.env.METEOALARM_API_KEY;
const API_BASE = 'https://api.meteogate.eu';
const ROUTE = '/warnings';

const ACCEPT_HEADERS = [
  '*/*',
  'application/cap+xml',
  'application/xml',
  'application/atom+xml',
  'text/xml',
  'application/cap+xml,application/xml;q=0.9,*/*;q=0.8',
];

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_API_KEY not set.');
    process.exit(1);
  }
  console.log(`probing ${API_BASE}${ROUTE} with various Accept headers`);
  console.log(`(token is set, ${TOKEN.length} chars; value NOT printed)`);
  console.log('');

  let winner: { accept: string; resp: Response } | null = null;

  for (const accept of ACCEPT_HEADERS) {
    // Some servers also distinguish on the absence of Accept entirely.
    // We always send one here — to test "no Accept", we'd need a separate
    // fetch with no Accept key. Skip that for now; */* should be equivalent.
    const resp = await fetch(`${API_BASE}${ROUTE}`, {
      headers: {
        apikey: TOKEN,
        Accept: accept,
        'User-Agent': 'nr-safety-alerts-probe/0.1',
      },
    });
    const ctype = resp.headers.get('content-type') ?? '(none)';
    const marker = resp.ok ? '✓' : (resp.status === 401 ? '✗' : '·');
    console.log(`  ${marker} ${String(resp.status).padStart(3)}  Accept: ${accept.padEnd(60)} → ${ctype}`);
    if (resp.ok && !winner) {
      winner = { accept, resp };
    }
  }
  console.log('');

  // Also try with NO Accept header at all (rare but possible).
  {
    const resp = await fetch(`${API_BASE}${ROUTE}`, {
      headers: {
        apikey: TOKEN,
        'User-Agent': 'nr-safety-alerts-probe/0.1',
      },
    });
    const ctype = resp.headers.get('content-type') ?? '(none)';
    const marker = resp.ok ? '✓' : '·';
    console.log(`  ${marker} ${String(resp.status).padStart(3)}  (no Accept header)                                              → ${ctype}`);
    if (resp.ok && !winner) {
      winner = { accept: '(no Accept header)', resp };
    }
  }
  console.log('');

  if (!winner) {
    console.error('No Accept header produced a 2xx response. /warnings may need extra query params.');
    process.exit(2);
  }

  console.log(`✓ /warnings accepts: ${winner.accept}`);
  console.log(`  content-type: ${winner.resp.headers.get('content-type')}`);
  console.log('');
  const body = await winner.resp.text();
  console.log(`Body length: ${body.length} chars`);
  console.log('First 1500 chars:');
  console.log('─'.repeat(70));
  console.log(body.slice(0, 1500));
  console.log('─'.repeat(70));

  // Guess at body format
  const trimmed = body.trimStart();
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) {
    console.log('');
    console.log('Body looks like XML (CAP / Atom / generic). XML parser needed.');
  } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    console.log('');
    console.log('Body looks like JSON.');
  } else {
    console.log('');
    console.log(`Body format unclear; starts with: "${trimmed.slice(0, 40)}"`);
  }
}

main().catch((err: unknown) => {
  console.error('Probe failed:', err);
  process.exit(3);
});
