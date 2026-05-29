import { XMLParser } from 'fast-xml-parser';
import type { SourceAdapter, RawAndNormalized, NormalizedEvent, Severity } from '../types.js';
import { fromCap, fromMeteoAlarmColor } from '../pipeline/severity.js';
import { log } from '../log.js';

/**
 * MeteoAlarm — European weather warnings (per-country Atom feeds aggregated
 * to a Europe-wide entry list).
 *
 * Endpoint: https://feeds.meteoalarm.org/api/v1/warnings/feeds-europe
 * Auth:     none
 * Format:   Atom XML; each <entry> has CAP-style severity color and area names
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

const FEED_URL = 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-europe';
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

function severityFor(entry: AtomEntry): Severity {
  // Try cap:severity first (CAP standard: Minor/Moderate/Severe/Extreme)
  const cap = entry['cap:severity'];
  if (cap) return fromCap(cap);
  // Fall back: scan the title for color words
  return fromMeteoAlarmColor(entry.title || '');
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
      headers: { 'User-Agent': 'nr-safety-alerts/0.1', Accept: 'application/atom+xml,application/xml,text/xml' },
    });
    if (!resp.ok) throw new Error(`MeteoAlarm feed returned HTTP ${resp.status}`);
    const text = await resp.text();
    const parsed = xml.parse(text) as AtomFeed;
    const entries = parsed.feed?.entry;
    const list: AtomEntry[] = Array.isArray(entries) ? entries : entries ? [entries] : [];
    log.debug({ count: list.length }, 'meteoalarm.fetched');

    const items: RawAndNormalized[] = [];
    for (const e of list) {
      const sev = severityFor(e);
      if (sev === 'low') continue;                  // skip green (informational)
      if (!e.id) continue;

      const area = e['cap:areaDesc'] || e.title || '';
      const eventName = e['cap:event'] || 'Weather warning';

      const normalized: NormalizedEvent = {
        sourceEventId: e.id,
        primarySourceId: 'meteoalarm',
        title: `${eventName} — ${area}`,
        summary: (e.summary || `${eventName} active for ${area}`).replace(/<[^>]+>/g, '').slice(0, 1000),
        severity: sev,
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
    return items;
  },
};
