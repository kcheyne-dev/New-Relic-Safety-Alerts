/**
 * MeteoGate (MeteoAlarm OGC EDR) collections probe — stage 5, the real one.
 *
 * Confirmed routes (per portal landing page):
 *   /warnings                  — landing
 *   /warnings/api              — OpenAPI spec
 *   /warnings/conformance      — OGC conformance classes
 *   /warnings/collections      — list of data collections (what we want)
 *   /warnings/authentication   — auth docs
 *
 * Provider: MeteoAlarm via geosphere.at. The data is European weather
 * warnings, served as OGC EDR JSON — the modern replacement for the legacy
 * per-country CAP Atom feed our existing adapter reads.
 *
 * This probe hits /warnings/collections to enumerate what's available, then
 * inspects /warnings/api for the schema.
 *
 * Usage (from backend/):
 *   npx tsx scripts/probe-meteogate-collections.ts
 */

import 'dotenv/config';

const TOKEN = process.env.METEOALARM_API_KEY;
const API_BASE = 'https://api.meteogate.eu';

interface EdrCollection {
  id?: string;
  title?: string;
  description?: string;
  links?: Array<{ href: string; rel: string; type?: string; title?: string }>;
  extent?: unknown;
  parameter_names?: Record<string, unknown>;
  data_queries?: Record<string, unknown>;
}

/**
 * Fetch with `?f=json` query-param format override and NO Accept header.
 * Stage-5a discovered the server returns 406 when Accept: application/json
 * is sent on these routes — content negotiation insists on HTML unless told
 * otherwise via the OGC `?f=` query param. Sending no Accept (defaulting to
 * the server's choice via `?f=json`) is the cleanest way to ask for JSON.
 */
async function fetchJson(path: string): Promise<{ ok: boolean; status: number; ctype: string; body: string }> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}${path}${sep}f=json`;
  const resp = await fetch(url, {
    headers: {
      apikey: TOKEN!,
      'User-Agent': 'nr-safety-alerts-probe/0.1',
      // Deliberately NO Accept header — server 406s on application/json.
    },
  });
  return {
    ok: resp.ok,
    status: resp.status,
    ctype: resp.headers.get('content-type') ?? '',
    body: await resp.text(),
  };
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_API_KEY not set.');
    process.exit(1);
  }
  console.log(`probing MeteoGate OGC EDR routes on ${API_BASE}`);
  console.log(`(token is set, ${TOKEN.length} chars; value NOT printed)`);
  console.log('');

  // 1. Landing — confirm it returns JSON when asked correctly
  console.log('1. /warnings (landing, format via ?f=json from helper)');
  const landing = await fetchJson('/warnings');
  console.log(`   HTTP ${landing.status}  ${landing.ctype}`);
  if (!landing.ok) {
    console.error('   landing failed; bailing');
    console.error(landing.body.slice(0, 300));
    process.exit(2);
  }
  console.log('');

  // 2. Conformance — quick sanity check on OGC classes
  console.log('2. /warnings/conformance');
  const conf = await fetchJson('/warnings/conformance');
  console.log(`   HTTP ${conf.status}  ${conf.ctype}`);
  if (conf.ok) {
    try {
      const j = JSON.parse(conf.body);
      const classes = (j as { conformsTo?: string[] }).conformsTo ?? [];
      console.log(`   ${classes.length} conformance classes:`);
      classes.slice(0, 8).forEach((c) => console.log(`     - ${c}`));
      if (classes.length > 8) console.log(`     ... and ${classes.length - 8} more`);
    } catch (e) {
      console.log(`   parse error: ${(e as Error).message}`);
    }
  }
  console.log('');

  // 3. Collections — the main course
  console.log('3. /warnings/collections (THE DATA ENTRYPOINT)');
  const cols = await fetchJson('/warnings/collections');
  console.log(`   HTTP ${cols.status}  ${cols.ctype}`);
  console.log('');
  if (!cols.ok) {
    console.error('   collections fetch failed:');
    console.error(cols.body.slice(0, 500));
    process.exit(2);
  }
  let collectionsJson: { collections?: EdrCollection[] };
  try {
    collectionsJson = JSON.parse(cols.body);
  } catch (e) {
    console.error('   collections body is not JSON:');
    console.error(cols.body.slice(0, 500));
    process.exit(3);
  }
  const collections = collectionsJson.collections ?? [];
  console.log(`   ${collections.length} collection(s) available:`);
  console.log('');
  for (const c of collections) {
    console.log(`   ▶ ${c.id ?? '(no id)'}`);
    if (c.title) console.log(`     title: ${c.title}`);
    if (c.description) console.log(`     desc:  ${c.description.slice(0, 100)}${c.description.length > 100 ? '…' : ''}`);
    if (c.parameter_names) {
      const params = Object.keys(c.parameter_names);
      console.log(`     params (${params.length}): ${params.slice(0, 6).join(', ')}${params.length > 6 ? '…' : ''}`);
    }
    if (c.data_queries) {
      const queries = Object.keys(c.data_queries);
      console.log(`     queries: ${queries.join(', ')}`);
    }
    if (c.links) {
      const selfLink = c.links.find((l) => l.rel === 'self');
      if (selfLink) console.log(`     self:  ${selfLink.href}`);
    }
    console.log('');
  }

  // 4. Dump first collection in full for shape reference
  if (collections.length > 0) {
    console.log('4. First collection full JSON (first 2500 chars):');
    console.log('─'.repeat(70));
    console.log(JSON.stringify(collections[0], null, 2).slice(0, 2500));
    console.log('─'.repeat(70));
  }
}

main().catch((err: unknown) => {
  console.error('Probe failed:', err);
  process.exit(3);
});
