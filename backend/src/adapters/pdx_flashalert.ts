import { XMLParser } from 'fast-xml-parser';
import type { SourceAdapter, RawAndNormalized, NormalizedEvent, Severity } from '../types.js';
import { log } from '../log.js';

/**
 * Portland / Oregon FlashAlert Network.
 *
 * STATUS (2026-06-20): DEAD AS A DATA SOURCE. Adapter retained for
 * historical context + in case FlashAlert ever re-exposes RSS. Keep
 * PDX_FLASHALERT_DISABLED=true in `.env` — do not flip without
 * verifying the URL+format situation has changed.
 *
 * Endpoint: https://www.flashalert.net/news.xml
 * Auth:     none
 * Format:   RSS 2.0 XML (legacy — see status below)
 *
 * URL HISTORY:
 *   - flashalert.net/api/messages.xml — 404 (deprecated)
 *   - flashalertportland.net/news.xml — DNS lookup failed (subdomain gone)
 *   - flashalert.net/news.xml — 404 since 2026-06-11
 *
 * INVESTIGATION (2026-06-20): The flashalert.net homepage now serves a
 * marketing page for "FlashAlert - Instant Press Releases & Emergency
 * Alerts," a paid B2B SaaS for press-release distribution. Title text:
 * "Send professional press releases and emergency alerts to media outlets
 * and your community instantly." The "community" referenced is the
 * OUTBOUND distribution list (recipients), not data consumers. They have
 * zero commercial incentive to expose free public RSS — the entire
 * business model now gates that data behind paid distribution.
 *
 * Conclusion: the free public RSS feed this adapter was built against
 * has been retired in favor of a paid platform. No replacement URL exists
 * because the data isn't being made public anymore. The adapter is dead
 * not because we have the URL wrong — because the SOURCE no longer
 * exists in the shape we need.
 *
 * WHAT TO DO INSTEAD:
 *
 *   - Short-term: leave the adapter disabled. PDX office covered by NWS
 *     (weather/CAP alerts) but lacks real-time police/fire/missing-person
 *     coverage. Accept the gap.
 *
 *   - Long-term: replace with a paid feed (Factal recommended in the
 *     2026-06-20 lens review — see docs/action-plan-2026-06-19.md +
 *     docs/project-status-2026-06-19.md). Factal's analyst-curated
 *     stream covers PDX as a side effect of covering everywhere else,
 *     and crucially fills the real-time gap that no free source can.
 *
 *   - Avoided: scraping portland.gov / multco.us / OPB. These are all
 *     possible but produce minutes-to-an-hour lag for a single-office
 *     source, which is meaningful engineering effort for marginal value
 *     once Factal lands. Not worth it.
 *
 * The code below remains structurally correct (parser, severity inference,
 * geocoding to PDX office) so if FlashAlert ever returns a working RSS
 * URL, only the FEED_URL constant + this docblock need updating. But
 * that's a low-probability outcome — see 2026-06-20 investigation above.
 *
 * Severity inferred from message keywords. The Portland office (PDX)
 * lat/lng is hard-coded as the location since most messages are
 * agency-level (not incident-level) and don't carry coordinates.
 */

const FEED_URL = 'https://www.flashalert.net/news.xml';
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
      // flashalert.net/news.xml is multi-region (OR/WA/ID); filter to
      // Portland-area orgs only.
      const org = (m.organization || '').toLowerCase();
      const title = m.title ?? '';
      const isPortlandRelated = /portland|multnomah|tri-met|trimet|psp|oregon state police|or-emergency|odot|opb/.test(
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
