/**
 * MeteoGate location-data probe — stage 7.
 *
 * Stage-6 revealed /warnings/collections/warnings/locations is the *list of
 * queryable locations* (returns 40 region polygons), NOT the warning data
 * itself. To fetch actual warning data, hit /locations/{locationId} per OGC
 * EDR locations query convention.
 *
 * This probe:
 *   1. Lists all 40 location IDs + titles
 *   2. Queries /locations/ALL?awareness_level=3,4&active=<now-window> to fetch
 *      currently-active orange+red warnings across Europe
 *   3. Dumps the first warning Feature.properties so we can map onto
 *      NormalizedEvent
 *
 * Usage (from backend/):
 *   npx tsx scripts/probe-meteogate-data.ts
 */

import 'dotenv/config';

const TOKEN = process.env.METEOALARM_API_KEY;
const API_BASE = 'https://api.meteogate.eu';

interface GeoJsonFeature {
  type: 'Feature';
  id?: string | number;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}
interface FeatureCollection {
  type: string;
  features?: GeoJsonFeature[];
  numberMatched?: number;
  numberReturned?: number;
  links?: Array<{ href: string; rel: string; title?: string }>;
  timeStamp?: string;
}

async function fetchFeatureCollection(path: string): Promise<{ status: number; ctype: string; fc?: FeatureCollection; raw: string }> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { apikey: TOKEN!, 'User-Agent': 'nr-safety-alerts-probe/0.1' },
  });
  const raw = await resp.text();
  const ctype = resp.headers.get('content-type') ?? '';
  if (!resp.ok) return { status: resp.status, ctype, raw };
  try {
    return { status: resp.status, ctype, fc: JSON.parse(raw), raw };
  } catch {
    return { status: resp.status, ctype, raw };
  }
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('FAIL: METEOALARM_API_KEY not set.');
    process.exit(1);
  }

  // 1. Location listing — full 40 regions
  console.log('1. /warnings/collections/warnings/locations  (full location list)');
  const list = await fetchFeatureCollection('/warnings/collections/warnings/locations?f=json');
  console.log(`   HTTP ${list.status}  ${list.ctype}`);
  if (!list.fc) {
    console.error('   list fetch failed:', list.raw.slice(0, 500));
    process.exit(2);
  }
  const locs = list.fc.features ?? [];
  console.log(`   ${locs.length} locations:`);
  for (const l of locs) {
    const id = l.id ?? '(no id)';
    const title = (l.properties as { title?: string } | null)?.title ?? '(no title)';
    console.log(`     ${String(id).padEnd(10)} ${title}`);
  }
  console.log('');

  // 2. Fetch active orange+red warnings via the ALL location
  // Note: `active` filter — use a wide window. The collection extent showed
  // intervals going back to 2024 so the API treats this as a time filter
  // on warning validity. Try without `active` first (default) and report.
  console.log('2. Querying for any warnings in the last 23h (relaxing filters)');
  // Server constraints learned the hard way:
  //   - `datetime` must be a CLOSED RANGE (start/end), never a single instant
  //   - Range MUST be less than 24 hours wide
  //   - Field is named `sent_range` internally → filters by when warnings
  //     were ISSUED, not when they're effective.
  // Walk down progressively-relaxed filters until we get features back, so
  // we can see Feature.properties shape regardless of current weather.
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMinus23h = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();
  const datetimeRange = `${nowMinus23h}/${nowIso}`;

  const attempts = [
    { label: 'ALL, orange+red',  loc: 'ALL', extra: { awareness_level: '3,4' } },
    { label: 'ALL, all levels',  loc: 'ALL', extra: {} },
    { label: 'DE, all levels',   loc: 'DE',  extra: {} },
    { label: 'IT, all levels',   loc: 'IT',  extra: {} },
    { label: 'ES, all levels',   loc: 'ES',  extra: {} },
    { label: 'NO, all levels',   loc: 'NO',  extra: {} },
    { label: 'AT, all levels',   loc: 'AT',  extra: {} },
  ];
  let dataResp: Awaited<ReturnType<typeof fetchFeatureCollection>> | null = null;
  let winLabel = '';
  for (const a of attempts) {
    const params = new URLSearchParams({
      f: 'json',
      language: 'en',
      datetime: datetimeRange,
      ...a.extra,
    });
    const r = await fetchFeatureCollection(`/warnings/collections/warnings/locations/${a.loc}?${params}`);
    const nf = r.fc?.features?.length ?? 0;
    console.log(`   ${a.label.padEnd(22)} → HTTP ${r.status}  features=${nf}`);
    if (r.fc && nf > 0) {
      dataResp = r;
      winLabel = a.label;
      break;
    }
  }
  console.log('');
  if (!dataResp || !dataResp.fc) {
    console.error('All attempts returned 204 or empty.');
    console.error('Likely Europe is genuinely quiet right now. Retry later in the day or after a weather front moves through.');
    process.exit(2);
  }
  console.log(`   ✓ first non-empty: ${winLabel}`);
  console.log(`   window: ${nowMinus23h}  →  ${nowIso}`);
  const warnings = dataResp.fc.features ?? [];
  console.log(`   Feature count: ${warnings.length}`);
  if (dataResp.fc.numberMatched !== undefined) {
    console.log(`   numberMatched (total): ${dataResp.fc.numberMatched}`);
  }
  if (dataResp.fc.timeStamp) {
    console.log(`   timeStamp: ${dataResp.fc.timeStamp}`);
  }
  console.log('');

  if (warnings.length === 0) {
    console.log('   No warnings active right now in ALL. Try a specific country location or drop awareness_level filter.');
    return;
  }

  // 3. Find a NON-SUPERSEDED feature and dump its full structure (including links)
  const activeFeatures = warnings.filter((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    return !props.supersededByAlertId && !props.supersededAt;
  });
  console.log(`=== ${activeFeatures.length}/${warnings.length} features are non-superseded (active) ===`);
  console.log('');

  // Dump first active feature in FULL — every top-level key, not just geometry+properties
  const target = activeFeatures[0] ?? warnings[0];
  const isFirstSuperseded = activeFeatures.length === 0;
  console.log(isFirstSuperseded
    ? '=== No active features found — dumping first superseded for structure reference ==='
    : '=== First ACTIVE feature (full structure) ===');
  console.log(JSON.stringify(target, null, 2).slice(0, 4000));
  console.log('');

  // 4. Tally distribution — properties don't include awareness_level (that's
  //    in the CAP XML); use what we DO have: country and supersede status.
  const countryTally = new Map<string, number>();
  let activeCount = 0;
  let supersededCount = 0;
  for (const f of warnings) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const ctry = String(props.countryCode ?? '?');
    countryTally.set(ctry, (countryTally.get(ctry) ?? 0) + 1);
    if (props.supersededByAlertId || props.supersededAt) supersededCount++;
    else activeCount++;
  }
  console.log('=== Tallies (page 1) ===');
  console.log(`active vs superseded: ${activeCount} active / ${supersededCount} superseded`);
  console.log('by countryCode:');
  for (const [k, v] of [...countryTally.entries()].sort()) console.log(`  ${k}: ${v}`);

  // 5. If we have an active feature with a hubLink, fetch the CAP XML to confirm shape
  if (activeFeatures.length > 0) {
    const active = activeFeatures[0];
    const props = (active.properties ?? {}) as Record<string, unknown>;
    const hubLink = props.hubLink as string | undefined;
    if (hubLink) {
      console.log('');
      console.log('=== Fetching CAP XML for first active feature ===');
      console.log(`hubLink: ${hubLink.slice(0, 100)}…`);
      // hubLink is a presigned DigitalOcean Spaces URL — no apikey needed.
      const capResp = await fetch(hubLink, { headers: { 'User-Agent': 'nr-safety-alerts-probe/0.1' } });
      console.log(`HTTP ${capResp.status}  ${capResp.headers.get('content-type')}`);
      if (capResp.ok) {
        const xml = await capResp.text();
        console.log(`CAP XML length: ${xml.length} chars`);
        console.log('First 1500 chars of CAP:');
        console.log('─'.repeat(70));
        console.log(xml.slice(0, 1500));
        console.log('─'.repeat(70));
      }
    }
  }

  // Pagination hint
  if (dataResp.fc.links) {
    const next = dataResp.fc.links.find((l) => l.rel === 'next');
    if (next) console.log(`\nNext page: ${next.href}`);
  }
}

main().catch((err: unknown) => {
  console.error('Probe failed:', err);
  process.exit(3);
});
