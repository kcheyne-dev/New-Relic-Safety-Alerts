import { XMLParser } from 'fast-xml-parser';
import type { SourceAdapter, RawAndNormalized, NormalizedEvent, Severity } from '../types.js';
import { log } from '../log.js';

/**
 * Portland / Oregon FlashAlert Network.
 *
 * Endpoint: https://www.flashalert.net/api/messages.xml
 * Auth:     none
 * Format:   custom RSS-like XML
 *
 * Severity inferred from message keywords. The Portland office (PDX) lat/lng
 * is hard-coded as the location since most messages are agency-level (not
 * incident-level) and don't carry coordinates.
 */

const FEED_URL = 'https://www.flashalert.net/api/messages.xml';
const PDX_LAT = 45.5152;
const PDX_LNG = -122.6784;
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

interface FlashAlertMessage {
  id?: string | number;
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  category?: string;
  organization?: string;
}

function severityFor(text: string): Severity {
  const t = text.toLowerCase();
  if (/(active shooter|fatal|homicide|major fire|hazmat|explosion|evacuation)/.test(t)) return 'ext';
  if (/(structure fire|crash|injury|standoff|barricade|missing|hostage|robbery)/.test(t)) return 'high';
  if (/(arrest|investigation|theft|burglary|disturbance|protest|crash)/.test(t)) return 'mod';
  return 'low';
}

export const pdxFlashalertAdapter: SourceAdapter = {
  id: 'pdx_flashalert',
  name: 'Portland / Oregon — FlashAlert Network',
  intervalSeconds: 600,

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(FEED_URL, {
      headers: { 'User-Agent': 'nr-safety-alerts/0.1', Accept: 'application/xml,text/xml' },
    });
    if (!resp.ok) throw new Error(`FlashAlert returned HTTP ${resp.status}`);
    const text = await resp.text();
    const parsed = xml.parse(text) as { rss?: { channel?: { item?: FlashAlertMessage | FlashAlertMessage[] } } };
    const itemsRaw = parsed.rss?.channel?.item;
    const list: FlashAlertMessage[] = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];
    log.debug({ count: list.length }, 'pdx_flashalert.fetched');

    const items: RawAndNormalized[] = [];
    for (const m of list) {
      // Filter to Portland-area orgs only (FlashAlert covers all of OR/WA/ID)
      const org = (m.organization || '').toLowerCase();
      const title = m.title ?? '';
      const isPortlandRelated = /portland|multnomah|tri-met|trimet|psp|oregon state police|or-emergency/.test(
        `${org} ${title}`.toLowerCase()
      );
      if (!isPortlandRelated) continue;

      const sev = severityFor(`${title} ${m.description ?? ''}`);
      if (sev === 'low') continue;

      const id = String(m.id ?? `${m.pubDate}-${title}`.slice(0, 80));
      const summary = (m.description ?? '').replace(/<[^>]+>/g, '').slice(0, 800);

      const normalized: NormalizedEvent = {
        sourceEventId: id,
        primarySourceId: 'pdx_flashalert',
        title: title || 'Portland incident',
        summary: summary || title,
        severity: sev,
        category: 'public_safety',
        type: (m.category ?? 'public_safety').toLowerCase().replace(/\s+/g, '_'),
        location: m.organization ?? 'Portland',
        lat: PDX_LAT,
        lng: PDX_LNG,
        radiusKm: 5,
        issuedAt: m.pubDate ? new Date(m.pubDate) : new Date(),
        expiresAt: null,
        sourceUrl: m.link ?? null,
      };
      items.push({ sourceEventId: id, payload: m, normalized });
    }
    return items;
  },
};
