import { XMLParser } from 'fast-xml-parser';
import type { SourceAdapter, RawAndNormalized, NormalizedEvent } from '../types.js';
import { evaluateMeteoAlarm } from '../pipeline/thresholds.js';
import { log } from '../log.js';

/**
 * MeteoAlarm — European weather warnings (per-country Atom feeds aggregated
 * to a Europe-wide entry list).
 *
 * Endpoint: https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-europe
 * Auth:     none
 * Format:   Atom XML
 *
 * MeteoAlarm has gone through several API redesigns. The previous endpoints
 * returned 404 or 406:
 *   - feeds.meteoalarm.org/api/v1/warnings/feeds-europe (404 — deprecated)
 *   - With XML Accept headers (406 — JSON-only on that path)
 * The legacy Atom endpoint above is the most stable for read-only consumers.
 *
 * Severity colors map to:
 *   green  → low      (no awareness needed; we keep these out by default)
 *   yellow → mod
 *   orange → high
 *   red    → ext
 *
 * MeteoAlarm doesn't publish lat/lng — only place/area names. We rely on the
 * geocoding layer to resolve them.
 */

const FEED_URL = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-europe';
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

interface AtomEntry {
  id?: string;
  title?: string;
  summary?: string;
  updated?: string;
  link?: { '@_href'?: string } | Array<{ '@_href'?: string }>;
  'cap:areaDesc'?: string;
  'cap:event'?: string;
  'cap:severity'?: string;
  'cap:onset'?: string;
  'cap:expires'?: string;
  'cap:effective'?: string;
  // colors are sometimes embedded in title (e.g. "Yellow" / "Orange")
}
interface AtomFeed {
  feed?: {
    entry?: AtomEntry | AtomEntry[];
    title?: string;
    updated?: string;
  };
}

function firstLink(entry: AtomEntry): string | null {
  const l = entry.link;
  if (!l) return null;
  if (Array.isArray(l)) return l[0]?.['@_href'] ?? null;
  return l['@_href'] ?? null;
}

export const meteoalarmAdapter: SourceAdapter = {
  id: 'meteoalarm',
  name: 'MeteoAlarm — European weather warnings',
  intervalSeconds: 900,

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(FEED_URL, {
      headers: {
        'User-Agent': 'nr-safety-alerts/0.1',
        Accept: 'application/atom+xml,application/xml,text/xml,application/json,*/*',
      },
    });
    if (!resp.ok) throw new Error(`MeteoAlarm feed returned HTTP ${resp.status}`);

    // Handle both XML (legacy Atom feed) and JSON (newer v1 API) responses.
    const ct = resp.headers.get('content-type') || '';
    let list: AtomEntry[] = [];
    if (ct.includes('json')) {
      const json = await resp.json() as { warnings?: any[] };
      const warnings = Array.isArray(json?.warnings) ? json.warnings : [];
      // Map JSON v1 schema → the AtomEntry-like shape the rest of this adapter expects.
      // v1 entries have feedSource + code + country + info[] (per-language).
      list = warnings.flatMap((w: any) => {
        const en = (Array.isArray(w?.info) ? w.info : []).find((i: any) => i?.language === 'en') ?? w?.info?.[0];
        if (!en) return [];
        return [{
          id:               w.identifier ?? `${w.feedSource ?? 'meteoalarm'}-${w.code ?? Math.random().toString(36)}`,
          title:            en.event ?? '',
          summary:          en.description ?? en.headline ?? '',
          updated:          w.sent ?? en.effective ?? '',
          link:             en.web ? { '@_href': en.web } : undefined,
          'cap:areaDesc':   Array.isArray(en.area) ? en.area.map((a: any) => a.areaDesc).filter(Boolean).join(', ') : (en.area?.areaDesc ?? ''),
          'cap:event':      en.event ?? '',
          'cap:severity':   en.severity ?? '',
          'cap:onset':      en.onset ?? '',
          'cap:expires':    en.expires ?? '',
          'cap:effective':  en.effective ?? '',
        }];
      });
    } else {
      const text = await resp.text();
      const parsed = xml.parse(text) as AtomFeed;
      const entries = parsed.feed?.entry;
      list = Array.isArray(entries) ? entries : entries ? [entries] : [];
    }
    log.debug({ count: list.length, format: ct.includes('json') ? 'json' : 'xml' }, 'meteoalarm.fetched');

    const items: RawAndNormalized[] = [];
    let droppedThreshold = 0;
    for (const e of list) {
      if (!e.id) continue;

      // Threshold gate — Orange/Red only, see docs/severity-thresholds.md
      const verdict = evaluateMeteoAlarm({
        capSeverity: e['cap:severity'],
        titleColor: e.title || '',
      });
      if (!verdict.pass) { droppedThreshold++; continue; }

      const area = e['cap:areaDesc'] || e.title || '';
      const eventName = e['cap:event'] || 'Weather warning';

      const normalized: NormalizedEvent = {
        sourceEventId: e.id,
        primarySourceId: 'meteoalarm',
        title: `${eventName} — ${area}`,
        summary: (e.summary || `${eventName} active for ${area}`).replace(/<[^>]+>/g, '').slice(0, 1000),
        severity: verdict.severity!,
        category: 'natural',
        type: eventName.toLowerCase().replace(/\s+/g, '_'),
        location: area,
        lat: 0,                                     // resolved by geocoder
        lng: 0,
        radiusKm: 80,                               // typical regional warning radius
        issuedAt: new Date(e['cap:onset'] || e['cap:effective'] || e.updated || Date.now()),
        expiresAt: e['cap:expires'] ? new Date(e['cap:expires']) : null,
        sourceUrl: firstLink(e),
      };
      items.push({ sourceEventId: e.id, payload: e, normalized });
    }
    log.debug({ kept: items.length, droppedThreshold, totalSeen: list.length }, 'meteoalarm.filtered');
    return items;
  },
};
