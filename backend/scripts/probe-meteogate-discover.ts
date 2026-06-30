/**
 * MeteoGate route discovery — stage 3.
 *
 * Stage-2 (probe-meteogate-warnings.ts) revealed that `/warnings` returns
 * HTML for the "MeteoAlarm API Portal" web app (built in Phoenix LiveView).
 * That means most paths on api.meteogate.eu are UI routes, not API routes.
 *
 * Strategy here: fetch the portal HTML, extract every internal href/src
 * path, then probe each one with apikey auth and report which ones return
 * JSON (real API) vs HTML (more UI) vs 4xx.
 *
 * Usage (from backend/):
 *   npx tsx scripts/probe-meteogate-discover.ts
 */

import 'dotenv/config';

const TOKEN = process.env.METEOALARM_API_KEY;
const API_BASE = 'https://api.meteogate.eu';

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_API_KEY not set.');
    process.exit(1);
  }

  // Step 1: fetch the portal landing
  console.log(`fetching portal landing ${API_BASE}/`);
  const landing = await fetch(`${API_BASE}/`, {
    headers: { apikey: TOKEN, 'User-Agent': 'nr-safety-alerts-probe/0.1' },
  });
  console.log(`  → HTTP ${landing.status} ${landing.headers.get('content-type') ?? ''}`);
  let html = await landing.text();

  // Also fetch /warnings — different page might link to different routes
  const warnings = await fetch(`${API_BASE}/warnings`, {
    headers: { apikey: TOKEN, 'User-Agent': 'nr-safety-alerts-probe/0.1' },
  });
  if (warnings.ok) {
    html += '\n' + (await warnings.text());
  }

  // Step 2: extract every internal path
  const paths = new Set<string>();

  // href="/something"  or  href='/something'
  const hrefRe = /\bhref=["']([^"'#?]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    if (m[1].startsWith('/') && !m[1].startsWith('//')) {
      paths.add(m[1].split('?')[0]);
    }
  }
  // src="/something"
  const srcRe = /\bsrc=["']([^"'#?]+)["']/g;
  while ((m = srcRe.exec(html)) !== null) {
    if (m[1].startsWith('/') && !m[1].startsWith('//')) {
      paths.add(m[1].split('?')[0]);
    }
  }
  // Phoenix LiveView often has data-phx-link="/path"
  const dataRe = /\bdata-[a-z-]+=["'](\/[^"'#?]+)["']/g;
  while ((m = dataRe.exec(html)) !== null) {
    paths.add(m[1].split('?')[0]);
  }

  // Filter to plausible routes — drop static assets
  const filtered = [...paths]
    .filter((p) => !p.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|map)$/i))
    .filter((p) => !p.startsWith('/assets/'))
    .filter((p) => !p.startsWith('/images/'))
    .sort();

  console.log('');
  console.log(`Found ${filtered.length} internal paths to probe:`);
  filtered.forEach((p) => console.log(`  ${p}`));
  console.log('');

  if (filtered.length === 0) {
    console.error('No internal paths found in portal HTML.');
    console.error('Best next step: open https://api.meteogate.eu/ in a browser, look at');
    console.error('the navigation, and tell the assistant what routes are listed.');
    process.exit(0);
  }

  // Step 3: probe each one with apikey auth, look for JSON
  console.log('Probing each path (apikey header, Accept: application/json):');
  console.log('');
  const apiHits: string[] = [];
  for (const path of filtered) {
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
    console.log(`  ${marker} ${String(r.status).padStart(3)} ${path.padEnd(40)} ${ctype}`);
    if (r.ok && isJson) {
      apiHits.push(path);
    }
  }
  console.log('');
  console.log('Legend: J=JSON, H=HTML, ·=4xx, ✗=401');
  console.log('');

  if (apiHits.length === 0) {
    console.log('No path returned JSON.');
    console.log('Most likely: API routes are namespaced (e.g. under /api/v1/...) and not');
    console.log('linked from the portal landing. Open the portal in a browser and look');
    console.log('for a "Routes", "API Docs", or "Swagger" link in the navigation.');
    return;
  }

  console.log(`✓ JSON-returning routes:`);
  for (const path of apiHits) {
    console.log(`  ${path}`);
  }
  console.log('');
  console.log('Sample response from first JSON route:');
  const r = await fetch(`${API_BASE}${apiHits[0]}`, {
    headers: { apikey: TOKEN, Accept: 'application/json', 'User-Agent': 'nr-safety-alerts-probe/0.1' },
  });
  const body = await r.text();
  console.log('─'.repeat(70));
  console.log(body.slice(0, 1500));
  console.log('─'.repeat(70));
}

main().catch((err: unknown) => {
  console.error('Discovery failed:', err);
  process.exit(3);
});
