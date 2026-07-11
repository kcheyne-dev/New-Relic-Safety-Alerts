/**
 * Direct MeteoAlarm API — Round 3 probe (Swagger UI extraction).
 *
 * Round 2 established EDR-swap viability but two loose ends remained:
 *   - OpenAPI spec 404'd at /edr/v1/docs/openapi (the URL /api advertised).
 *   - Metadata API's real routes are hidden behind a LiveView portal that
 *     only exposes /changelog.
 *
 * Both APIs have Swagger UI pages at /edr/v1/docs and /metadata/v1/docs
 * (per Round 1's /api response). Swagger UI is a self-contained HTML that
 * loads its OpenAPI spec via JavaScript — the spec URL is embedded in the
 * page (typically as `SwaggerUIBundle({url: '...'})` or a
 * `<script id="swagger-ui-config">` block). Extract those URLs, follow
 * them, print the results.
 *
 * If we find the spec, we get every endpoint for both APIs, plus
 * documented rate limits, error schemas, and parameter constraints.
 *
 * Usage (from backend/):
 *   npx tsx scripts/probe-meteoalarm-direct-round3.ts
 */

import 'dotenv/config';

const TOKEN = process.env.METEOALARM_DIRECT_TOKEN;

async function fetchText(url: string): Promise<{ status: number; ctype: string; body: string; ok: boolean }> {
  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN!}`,
        'User-Agent': 'nr-safety-alerts-probe/0.1',
      },
    });
    return {
      status: resp.status,
      ctype: resp.headers.get('content-type') ?? '',
      body: await resp.text(),
      ok: resp.ok,
    };
  } catch (err) {
    return {
      status: -1,
      ctype: '',
      body: `FETCH_ERROR: ${(err as Error).message}`,
      ok: false,
    };
  }
}

/**
 * Given a Swagger UI page HTML, extract candidate OpenAPI spec URLs.
 * Swagger UI can be configured multiple ways; we cover the common ones:
 *   1. `url: "/path/to/openapi.json"` inside a SwaggerUIBundle({...}) call
 *   2. `<script id="swagger-ui-config">` or `<script id="swagger-config">`
 *      with a JSON blob containing `url` or `spec`
 *   3. Redoc: `<redoc spec-url="/path" />` element
 *   4. Direct `spec-url` attribute anywhere in the page
 * Returns absolute URLs; relative paths are resolved against the fetched
 * page's origin.
 */
function extractSpecUrls(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /url:\s*['"]([^'"]+)['"]/g,             // SwaggerUIBundle({ url: "..." })
    /spec-url=['"]([^'"]+)['"]/g,           // <redoc spec-url="...">
    /\bconfigUrl:\s*['"]([^'"]+)['"]/g,     // SwaggerUIBundle({ configUrl: "..." })
    /\burls:\s*\[\s*\{\s*url:\s*['"]([^'"]+)['"]/g,   // multi-spec form
    /"openapi_url"\s*:\s*"([^"]+)"/g,       // FastAPI-style config
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const url = m[1];
      if (!url) continue;
      try {
        // Resolve relative to the Swagger UI page URL.
        const abs = new URL(url, baseUrl).toString();
        // Filter to plausible spec URLs (openapi.json/.yaml, swagger.json, .yaml).
        if (abs.match(/\.(json|ya?ml)(\?|$)/i) || abs.includes('openapi') || abs.includes('swagger')) {
          out.add(abs);
        }
      } catch {
        /* skip malformed URLs */
      }
    }
  }
  return [...out];
}

async function probeSwaggerUi(swaggerUrl: string): Promise<void> {
  console.log('\n---');
  console.log(`Swagger UI page: ${swaggerUrl}`);
  const page = await fetchText(swaggerUrl);
  console.log(`  Status: ${page.status}  Type: ${page.ctype}  Length: ${page.body.length}`);
  if (!page.ok) {
    console.log(`  → skipping (page not reachable)`);
    return;
  }
  const specs = extractSpecUrls(page.body, swaggerUrl);
  if (specs.length === 0) {
    console.log(`  ✗ No OpenAPI spec URLs found in HTML. Snippet:`);
    // Print the middle 500 chars where the config typically lives — <head>
    // has boilerplate, footer is empty.
    const mid = Math.floor(page.body.length / 2);
    console.log('    ' + page.body.slice(Math.max(0, mid - 250), mid + 250).replace(/\n/g, '\n    '));
    return;
  }
  console.log(`  ✓ Found ${specs.length} candidate spec URL(s):`);
  for (const s of specs) console.log(`    ${s}`);

  // Fetch each candidate and print status + first line.
  for (const s of specs) {
    console.log('');
    console.log(`  Fetching ${s} …`);
    const r = await fetchText(s);
    console.log(`    Status: ${r.status}  Type: ${r.ctype}  Length: ${r.body.length}`);
    if (r.ok) {
      // Print the first bit — should reveal OpenAPI version + title + paths.
      const snippet = r.body.slice(0, 1500).replace(/\n/g, '\n      ');
      console.log('    Body:');
      console.log('      ' + snippet);
      // Enumerate top-level paths if it parses as JSON.
      try {
        const parsed = JSON.parse(r.body);
        if (parsed?.paths && typeof parsed.paths === 'object') {
          const paths = Object.keys(parsed.paths).sort();
          console.log(`    → OpenAPI version: ${parsed.openapi ?? parsed.swagger ?? '?'}`);
          console.log(`    → Title: ${parsed.info?.title ?? '?'}`);
          console.log(`    → ${paths.length} paths defined:`);
          paths.forEach(p => console.log(`        ${p}`));
        }
      } catch {
        /* Not JSON (probably YAML) — the snippet is enough */
      }
    }
  }
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_DIRECT_TOKEN not set in .env.');
    process.exit(1);
  }

  console.log('MeteoAlarm direct API probe — ROUND 3 (Swagger UI extraction).');

  await probeSwaggerUi('https://api.meteoalarm.org/edr/v1/docs');
  await probeSwaggerUi('https://api.meteoalarm.org/metadata/v1/docs');

  console.log('');
  console.log('---');
  console.log('Round 3 complete.');
  console.log('If specs were fetched: paste output back so real Metadata API routes');
  console.log('can be catalogued in docs/meteoalarm-direct-vs-meteogate.md.');
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
