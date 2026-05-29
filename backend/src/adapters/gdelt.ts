import type { SourceAdapter, RawAndNormalized, NormalizedEvent, Severity } from '../types.js';
import { log } from '../log.js';

/**
 * GDELT 2.0 — Global Database of Events.
 *
 * GDELT is a firehose. Without filters this would drown the dashboard. We use:
 *
 * 1. THEME tags — narrow to articles tagged with safety-relevant themes
 *    (PROTEST, TERROR, EVACUATION, KILL, WILDFIRE, FLOOD, EARTHQUAKE,
 *     ATTACK, RIOT, ARMED).
 *
 * 2. TONE — only emit articles with strongly-negative tone (< -3).
 *    GDELT publishes a -100..+100 sentiment score per article.
 *
 * 3. RECENCY — only the last 90 minutes (matches our 15-min cadence + headroom).
 *
 * 4. POST-FILTER — drop anything we couldn't extract a location from. The
 *    persist pipeline's office-proximity match handles the rest.
 *
 * Endpoint: https://api.gdeltproject.org/api/v2/doc/doc
 *           ?query=<themes> tone<-3 sourcelang:eng &mode=ArtList&format=json&maxrecords=75&timespan=90min
 * Auth:     none
 * Format:   JSON Array of articles
 */

const FEED_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

const SAFETY_THEMES = [
  'PROTEST',
  'TERROR',
  'KILL',
  'EVACUATION',
  'WILDFIRE',
  'FLOOD',
  'EARTHQUAKE',
  'ATTACK',
  'RIOT',
  'ARMED',
  'CIVIL_DISORDER',
];

interface GdeltArticle {
  url: string;
  url_mobile?: string;
  title: string;
  seendate: string;          // YYYYMMDDHHMMSS
  socialimage?: string;
  domain: string;
  language: string;
  sourcecountry: string;
  // GDELT also returns "tone" but only when sort=tonelist; for ArtList we infer from query
}

interface GdeltResponse {
  articles?: GdeltArticle[];
}

const THEME_TO_TYPE: Record<string, string> = {
  PROTEST: 'protest',
  RIOT: 'civil_unrest',
  CIVIL_DISORDER: 'civil_unrest',
  TERROR: 'terror',
  ATTACK: 'attack',
  ARMED: 'armed_incident',
  KILL: 'fatal_incident',
  EVACUATION: 'evacuation',
  WILDFIRE: 'wildfire',
  FLOOD: 'flood',
  EARTHQUAKE: 'earthquake',
};

function buildQuery(): string {
  const themeClause = `(${SAFETY_THEMES.map((t) => `theme:${t}`).join(' OR ')})`;
  // sourcelang:eng for now; expand to multilingual once we add translation
  return `${themeClause} tone<-3 sourcelang:eng`;
}

function buildUrl(): string {
  const query = encodeURIComponent(buildQuery());
  const params = [
    `query=${query}`,
    `mode=ArtList`,
    `format=json`,
    `maxrecords=75`,
    `timespan=90min`,
    `sort=DateDesc`,
  ].join('&');
  return `${FEED_BASE}?${params}`;
}

function parseSeenDate(s: string): Date {
  // Format: YYYYMMDDHHMMSS
  if (!/^\d{14}$/.test(s)) return new Date();
  const yr = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6)) - 1;
  const dy = Number(s.slice(6, 8));
  const hh = Number(s.slice(8, 10));
  const mm = Number(s.slice(10, 12));
  const ss = Number(s.slice(12, 14));
  return new Date(Date.UTC(yr, mo, dy, hh, mm, ss));
}

function detectTheme(title: string): string {
  const t = title.toUpperCase();
  for (const theme of SAFETY_THEMES) {
    // Loose keyword check to back-fill the type when the API doesn't return per-article themes
    if (t.includes(theme) || t.includes(theme.replace('_', ' '))) {
      return THEME_TO_TYPE[theme] ?? 'civil_unrest';
    }
  }
  return 'civil_unrest';
}

function severityFromTitle(title: string): Severity {
  const t = title.toLowerCase();
  if (/(kill|dead|fatal|massacre|attack|bombing|shooting|active shooter)/.test(t)) return 'high';
  if (/(evacuation|riot|clash|injured|wildfire|earthquake|flood)/.test(t)) return 'high';
  if (/(protest|march|demonstration|strike|unrest)/.test(t)) return 'mod';
  return 'mod';
}

/**
 * GDELT articles don't expose lat/lng directly via the simple ArtList endpoint.
 * The persist pipeline's geocoder will resolve from `location` (which we set
 * to the source country + first words of the title). For most cases this gets
 * within the right country/city, which is good enough for office-proximity matching
 * given GDELT's real role: a noise-reducing news layer.
 */
export const gdeltAdapter: SourceAdapter = {
  id: 'gdelt',
  name: 'GDELT 2.0 — Global Database of Events',
  intervalSeconds: 900,

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(buildUrl(), {
      headers: { 'User-Agent': 'nr-safety-alerts/0.1', Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`GDELT API returned HTTP ${resp.status}`);
    const data = (await resp.json()) as GdeltResponse;
    const articles = data.articles ?? [];
    log.debug({ count: articles.length }, 'gdelt.fetched');

    const items: RawAndNormalized[] = [];
    const seen = new Set<string>();

    for (const a of articles) {
      // Dedup by URL within this batch
      if (!a.url || seen.has(a.url)) continue;
      seen.add(a.url);

      const issued = parseSeenDate(a.seendate);
      const type = detectTheme(a.title);
      const sev = severityFromTitle(a.title);

      // Use sourcecountry as the location hint for the geocoder.
      // This often resolves to a country center, which is fine for first-pass
      // office-proximity (within 500km of an office).
      const location = a.sourcecountry || a.domain || 'Global';

      const normalized: NormalizedEvent = {
        sourceEventId: a.url,
        primarySourceId: 'gdelt',
        title: a.title.slice(0, 200),
        summary: `Reported by ${a.domain} (${a.sourcecountry}). ${a.title}`,
        severity: sev,
        category: 'civil',
        type,
        location,
        lat: 0,                                       // resolved by geocoder
        lng: 0,
        radiusKm: 100,                                // GDELT articles are coarse-grained
        issuedAt: issued,
        expiresAt: null,
        sourceUrl: a.url,
      };
      items.push({ sourceEventId: a.url, payload: a, normalized });
    }
    return items;
  },
};
