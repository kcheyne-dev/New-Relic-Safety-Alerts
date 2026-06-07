import { XMLParser } from 'fast-xml-parser';
import type { SourceAdapter, RawAndNormalized, NormalizedEvent } from '../types.js';
import { evaluateStateDept } from '../pipeline/thresholds.js';
import { log } from '../log.js';

/**
 * US Department of State — Travel Advisories.
 *
 * Endpoint: https://travel.state.gov/_res/rss/TAsTWs.xml
 * Auth:     none
 * Format:   RSS 2.0 XML
 *
 * Each item has a category like:
 *   "Level 1: Exercise Normal Precautions"
 *   "Level 2: Exercise Increased Caution"
 *   "Level 3: Reconsider Travel"
 *   "Level 4: Do Not Travel"
 *
 * Mapping:
 *   L1 → low, L2 → mod, L3 → high, L4 → ext
 *
 * Country names are in the title; the geocoder resolves them.
 */

const FEED_URL = 'https://travel.state.gov/_res/rss/TAsTWs.xml';
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

interface RssItem {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  guid?: string | { '#text': string };
  category?: string | string[];
}
interface RssFeed {
  rss?: { channel?: { item?: RssItem | RssItem[] } };
}

function countryFromTitle(title: string | undefined): string {
  if (!title) return '';
  // Titles look like "France - Level 2: Exercise Increased Caution"
  return title.split(' - ')[0]!.trim();
}

/** Pull the Level number (1-4) out of the RSS category text. */
function levelFromCategory(category: string | string[] | undefined): number | null {
  const s = Array.isArray(category) ? category.join(' ') : category ?? '';
  const m = s.match(/Level\s*(\d)/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function getGuid(item: RssItem): string {
  if (typeof item.guid === 'string') return item.guid;
  if (item.guid && typeof item.guid === 'object') return item.guid['#text'];
  return item.link ?? item.title ?? Math.random().toString(36);
}

export const stateDeptAdapter: SourceAdapter = {
  id: 'state_dept',
  name: 'US Department of State — Travel Advisories',
  intervalSeconds: 86400,                            // daily — these don't change often

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(FEED_URL, {
      headers: { 'User-Agent': 'nr-safety-alerts/0.1', Accept: 'application/rss+xml,application/xml,text/xml' },
    });
    if (!resp.ok) throw new Error(`State Dept feed returned HTTP ${resp.status}`);
    const text = await resp.text();
    const parsed = xml.parse(text) as RssFeed;
    const itemsRaw = parsed.rss?.channel?.item;
    const list: RssItem[] = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];
    log.debug({ count: list.length }, 'state_dept.fetched');

    const items: RawAndNormalized[] = [];
    let droppedThreshold = 0;
    for (const it of list) {
      // Threshold gate — Level 3+ only, see docs/severity-thresholds.md
      const verdict = evaluateStateDept({ level: levelFromCategory(it.category) });
      if (!verdict.pass) { droppedThreshold++; continue; }

      const country = countryFromTitle(it.title);
      if (!country) continue;

      const normalized: NormalizedEvent = {
        sourceEventId: getGuid(it),
        primarySourceId: 'state_dept',
        title: it.title ?? country,
        summary: (it.description ?? '').replace(/<[^>]+>/g, '').slice(0, 1500) || `Travel advisory for ${country}.`,
        severity: verdict.severity!,
        category: 'travel',
        type: 'travel_advisory',
        location: country,
        lat: 0,                                     // geocoder resolves
        lng: 0,
        radiusKm: 0,                                // travel advisories are country-wide; office matching uses other signals
        issuedAt: it.pubDate ? new Date(it.pubDate) : new Date(),
        expiresAt: null,
        sourceUrl: it.link ?? null,
      };
      items.push({ sourceEventId: normalized.sourceEventId, payload: it, normalized });
    }
    log.debug({ kept: items.length, droppedThreshold, totalSeen: list.length }, 'state_dept.filtered');
    return items;
  },
};
