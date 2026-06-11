import { XMLParser } from 'fast-xml-parser';
import { pool } from '../db.js';
import { log } from '../log.js';

/**
 * WHO Disease Outbreak News (DON) — vetted disease outbreak reports.
 *
 * This adapter is structurally different from the others: it persists
 * to its own table (`who_outbreaks`) rather than `events`, because WHO
 * data is contextual (5-30 day publication lag), not real-time alerting.
 * The Risk Profile modal consumes it via the dedicated /api/who-outbreaks
 * route.
 *
 * Endpoint: WHO's Sitecore-backed JSON news API. This is the closest thing
 * to a public DON feed — WHO deprecated their public RSS feeds during the
 * 2018+ site redesign. The URL below uses the documented sf_provider /
 * sf_culture parameters that the WHO website itself uses.
 *
 *   https://www.who.int/api/news/diseaseoutbreaknews?sf_provider=dynamicProvider372&sf_culture=en
 *
 * If WHO changes their CMS again and this 404s, alternatives:
 *   - Scrape https://www.who.int/emergencies/disease-outbreak-news/ HTML
 *   - Use third-party aggregators (FluTrackers, ProMED-mail)
 *   - Manual entry via an operator UI
 *
 * Severity heuristic: derived from the disease name since WHO doesn't
 * publish a severity field. High-fatality pathogens (Ebola, Marburg,
 * H5N1, plague) → high; common-but-serious (Cholera, Measles, Mpox,
 * Polio) → mod; routine (Dengue, food-borne) → low. Volumes >5,000 cases
 * bump the severity one tier.
 */

const FEED_URL = 'https://www.who.int/api/news/diseaseoutbreaknews?sf_provider=dynamicProvider372&sf_culture=en&%24format=json&%24top=100&%24orderby=PublicationDateAndTime%20desc';
// WHO Disease Outbreak News is contextual data — an active outbreak (Ebola,
// cholera, mpox) is relevant to CMT travel planning long after the news entry
// is published. WHO's own API only returns ~100 most-recent entries anyway,
// so anything older than a year is no longer in the feed and effectively
// already "stale" by virtue of not being refreshed. 365 days captures every
// entry currently in WHO's feed without dropping any.
const STALE_AFTER_DAYS = 365;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

interface RssItem {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  guid?: string | { '#text': string };
}
interface RssFeed {
  rss?: { channel?: { item?: RssItem | RssItem[] } };
}

function getGuid(it: RssItem): string {
  if (typeof it.guid === 'string') return it.guid;
  if (it.guid && typeof it.guid === 'object') return it.guid['#text'];
  return it.link ?? it.title ?? Math.random().toString(36);
}

/** WHO DON titles use a few common shapes. Regional and global entries
 *  describe activity across many countries, so they don't fit the
 *  Risk Profile modal's per-country lookup model and are dropped here.
 *  Future: surface them in a separate "Regional / Global" panel by
 *  retaining the entry and tagging it with a scope field. */
const NON_COUNTRY_MARKERS = [
  'multi-country',
  'multi country',
  'global situation',
  'global update',
  'global response',
  'african region',         // (AFRO)
  'european region',        // (EURO)
  'eastern mediterranean',  // (EMRO)
  'south-east asia',        // (SEARO)
  'western pacific',        // (WPRO)
  'region of the americas', // (PAHO/AMRO)
  '(afro)', '(emro)', '(searo)', '(wpro)', '(euro)', '(paho)', '(amro)',
];

function parseTitleParts(title: string | undefined): { disease: string; country: string } {
  if (!title) return { disease: '', country: '' };
  // Try em-dash first, fall back to hyphen-with-spaces
  const parts = title.split(/\s+[–-]\s+/);
  if (parts.length < 2) return { disease: title.trim(), country: '' };
  const disease = parts[0]!.trim();
  // Country may itself include a parenthetical region; keep the full tail
  const country = parts.slice(1).join(' - ').trim();

  // Drop regional / multi-country / global entries — return a blank country so
  // the upstream caller skips them.
  const lowered = country.toLowerCase();
  if (NON_COUNTRY_MARKERS.some(m => lowered.includes(m))) {
    return { disease, country: '' };
  }

  return { disease, country };
}

/** Pull a "X cases" or "X new cases" integer out of the RSS description. */
function parseCases(desc: string | undefined): number | null {
  if (!desc) return null;
  // Strip HTML tags first; description often has <p> wrappers
  const plain = desc.replace(/<[^>]+>/g, ' ');
  // Look for "X,XXX cases" / "X confirmed cases" / "a total of X cases"
  const m = plain.match(/(\d{1,3}(?:,\d{3})+|\d{2,})\s+(?:confirmed |suspected |new |reported )?cases/i);
  if (!m) return null;
  const n = parseInt(m[1]!.replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Heuristic severity by disease name. WHO doesn't publish severity. */
function deriveSeverity(disease: string, cases: number | null): 'low' | 'mod' | 'high' | 'ext' {
  const d = disease.toLowerCase();

  // Extreme: high-fatality pathogens with mass-casualty potential
  if (/ebola|marburg|smallpox|plague|anthrax|lassa|crimean.congo|nipah/.test(d))
    return 'ext';

  // High: serious outbreaks that warrant operational attention
  if (/cholera|mpox|monkeypox|h5n1|h7n9|avian influenza|rabies|mers|sars|polio|yellow fever/.test(d))
    return 'high';

  // Moderate: common outbreaks; mod by default
  if (/measles|dengue|chikungunya|zika|leishmaniasis|legionnaires|hepatitis|meningococ/.test(d))
    return 'mod';

  // Volume bump: ≥5k cases promotes one tier (mod → high)
  if (cases && cases >= 5000) return 'high';
  if (cases && cases >= 1000) return 'mod';

  return 'low';
}

interface PersistStats {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

async function persistOutbreak(item: {
  sourceEventId: string;
  country: string;
  disease: string;
  severity: 'low' | 'mod' | 'high' | 'ext';
  cases: number | null;
  issuedAt: Date;
  link: string | null;
  summary: string;
  raw: unknown;
}): Promise<'inserted' | 'updated'> {
  const res = await pool.query<{ was_new: boolean }>(
    `INSERT INTO who_outbreaks (
        source_event_id, country, disease, severity, cases,
        issued_at, link, summary, raw_payload, is_stale
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
     ON CONFLICT (source_event_id) DO UPDATE SET
        country     = EXCLUDED.country,
        disease     = EXCLUDED.disease,
        severity    = EXCLUDED.severity,
        cases       = EXCLUDED.cases,
        issued_at   = EXCLUDED.issued_at,
        link        = EXCLUDED.link,
        summary     = EXCLUDED.summary,
        raw_payload = EXCLUDED.raw_payload,
        is_stale    = FALSE
     RETURNING (xmax = 0) AS was_new`,
    [
      item.sourceEventId,
      item.country,
      item.disease,
      item.severity,
      item.cases,
      item.issuedAt,
      item.link,
      item.summary,
      JSON.stringify(item.raw),
    ]
  );
  return res.rows[0]?.was_new ? 'inserted' : 'updated';
}

/** Sweep WHO entries older than STALE_AFTER_DAYS. Mirrors the events sweeper
 *  but on its own table. STALE_AFTER_DAYS is hardcoded today, but pass it as
 *  a parameter so the query stays safe if it later becomes config-driven. */
async function sweepStale(): Promise<number> {
  const res = await pool.query(
    `UPDATE who_outbreaks SET is_stale = TRUE
     WHERE NOT is_stale AND issued_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [STALE_AFTER_DAYS]
  );
  return res.rowCount ?? 0;
}

export const whoDonAdapter = {
  id: 'who_don' as const,
  name: 'WHO — Disease Outbreak News',
  intervalSeconds: 21600,   // 6 hours

  async run(): Promise<PersistStats> {
    const stats: PersistStats = { fetched: 0, inserted: 0, updated: 0, skipped: 0 };

    const resp = await globalThis.fetch(FEED_URL, {
      headers: {
        'User-Agent': 'nr-safety-alerts/0.1 (cmt-dashboard)',
        Accept: 'application/json',
      },
    });
    if (!resp.ok) throw new Error(`WHO DON feed returned HTTP ${resp.status}`);

    // WHO's Sitecore CMS returns JSON like { value: [{ Title, ItemDefaultUrl,
    // PublicationDateAndTime, FormatedDate, ... }, ...] }. Fall back to RSS
    // parsing if WHO changes the response format again.
    const ct = resp.headers.get('content-type') || '';
    let list: RssItem[] = [];
    if (ct.includes('json')) {
      const json = await resp.json() as { value?: any[] };
      const value = Array.isArray(json?.value) ? json.value : [];
      // Map WHO CMS schema to RssItem-like shape so the rest of the function
      // can stay generic.
      // ItemDefaultUrl is the DON slug (e.g. "/2026-DON593"). The public WHO
      // site serves DON entries at /emergencies/disease-outbreak-news/item/<slug>,
      // not at the root. Build the canonical URL by prepending that path when
      // ItemDefaultUrl looks like a bare slug.
      const canonicalDonUrl = (rawUrl: string): string => {
        if (!rawUrl) return '';
        if (rawUrl.startsWith('http')) return rawUrl;
        if (rawUrl.startsWith('/emergencies/disease-outbreak-news/'))
          return `https://www.who.int${rawUrl}`;
        // Bare slug like "/2026-DON593" — prepend the DON path
        return `https://www.who.int/emergencies/disease-outbreak-news/item${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
      };
      list = value.map((v: any) => ({
        title:       v.Title ?? v.title ?? '',
        description: v.Summary ?? v.summary ?? v.HtmlBody ?? v.PlainText ?? '',
        link:        canonicalDonUrl(v.ItemDefaultUrl ?? v.url ?? ''),
        pubDate:     v.PublicationDateAndTime ?? v.publishedAt ?? v.publicationDate ?? null,
        guid:        String(v.Id ?? v.id ?? v.ItemDefaultUrl ?? v.Title ?? ''),
      }));
    } else {
      const text = await resp.text();
      const parsed = xml.parse(text) as RssFeed;
      const itemsRaw = parsed.rss?.channel?.item;
      list = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];
    }
    stats.fetched = list.length;
    log.debug({ count: list.length, format: ct.includes('json') ? 'json' : 'xml' }, 'who_don.fetched');

    for (const it of list) {
      const { disease, country } = parseTitleParts(it.title);
      if (!disease || !country) {
        // Title didn't parse — skip rather than persist an unintelligible row
        stats.skipped++;
        continue;
      }
      const cases = parseCases(it.description);
      const severity = deriveSeverity(disease, cases);
      const summary = (it.description ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 1000)
        || `${disease} outbreak reported in ${country}.`;

      // pubDate is normally always present, but if WHO ever ships a malformed
      // entry, fall back to a date well in the past rather than `new Date()` —
      // an entry timestamped "now" would mislead the operator about freshness.
      let issuedAt: Date;
      if (it.pubDate) {
        issuedAt = new Date(it.pubDate);
        if (isNaN(issuedAt.getTime())) {
          log.warn({ title: it.title, pubDate: it.pubDate }, 'who_don.bad_pubdate');
          issuedAt = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        }
      } else {
        log.warn({ title: it.title }, 'who_don.missing_pubdate');
        issuedAt = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      }

      const result = await persistOutbreak({
        sourceEventId: getGuid(it),
        country,
        disease,
        severity,
        cases,
        issuedAt,
        link: it.link ?? null,
        summary,
        raw: it,
      });
      if (result === 'inserted') stats.inserted++;
      else stats.updated++;
    }

    // Mark old entries stale; safe to do on every poll since it's a UPDATE
    // bounded by an indexed predicate.
    const stale = await sweepStale();
    if (stale > 0) log.info({ marked: stale }, 'who_don.swept_stale');

    log.info(stats, 'who_don.persisted');
    return stats;
  },
};

export type WhoOutbreakRow = {
  id: number;
  source_event_id: string;
  country: string;
  disease: string;
  severity: 'low' | 'mod' | 'high' | 'ext';
  cases: number | null;
  issued_at: Date | string;
  link: string | null;
  summary: string;
  is_stale: boolean;
};
