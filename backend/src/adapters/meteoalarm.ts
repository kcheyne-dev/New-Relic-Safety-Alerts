import { XMLParser } from 'fast-xml-parser';
import type { SourceAdapter, RawAndNormalized, NormalizedEvent } from '../types.js';
import { evaluateMeteoAlarm } from '../pipeline/thresholds.js';
import { log } from '../log.js';

/**
 * MeteoAlarm — European weather warnings (per-country Atom + CAP 1.2).
 *
 * STATUS (2026-06-24, after URL-shape investigation): LIVE again after
 * being disabled 2026-06-11 on URL-404/406. The europe-wide aggregate
 * endpoint is permanently gone, but per-country legacy Atom feeds are
 * alive, fresh, and unchanged in shape. We fetch per-country in parallel
 * and union the results.
 *
 * URL HISTORY:
 *   2026-06-11  feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-europe → 404
 *   2026-06-24  Investigation confirmed (a) europe-wide is permanently
 *               retired, (b) per-country legacy paths are alive with
 *               the same Atom+CAP1.2 schema, (c) the modern
 *               hub.meteoalarm.org/api/v1 CAP10 endpoint advertised in
 *               meteoalarm.org's homepage HTML returns 404 in practice.
 *               Net: per-country is the working answer.
 *
 * COUNTRIES FETCHED: see COUNTRY_SLUGS below. Covers our two EMEA offices
 * (BCN=Spain, DUB=Ireland) plus COUNTRY_PRESENCE entries with active or
 * likely traveler exposure (Germany, France, Italy, Netherlands,
 * Switzerland). UK is not in MeteoAlarm — the Met Office runs its own
 * warning system and pulled UK out of the MeteoAlarm feed. LON weather
 * warnings need a separate UK Met Office adapter (queued in
 * docs/action-plan-2026-06-19.md) or defer to Factal.
 *
 * LICENSE: each feed entry is CC BY 4.0, with additional requirements
 * for redistributing described in MeteoAlarm's Terms and Conditions.
 * Author tag `meteoalarm.org` is preserved on each event via the
 * sourceUrl + dashboard rendering. Internal CMT use only; no public
 * redistribution implied by the dashboard's bare GitHub Pages deploy
 * (which serves mock data, not live MeteoAlarm content).
 *
 * Severity mapping (in pipeline/thresholds.ts → evaluateMeteoAlarm):
 *   green  → low      (no awareness needed; filtered out)
 *   yellow → mod      (filtered out by default in feed)
 *   orange → high
 *   red    → ext
 *
 * MeteoAlarm doesn't publish lat/lng — only place/area names. We rely
 * on the geocoding layer to resolve them.
 */

const COUNTRY_SLUGS = [
  'spain',         // BCN office
  'ireland',       // DUB office
  // COUNTRY_PRESENCE entries with likely traveler exposure:
  'germany',
  'france',
  'italy',
  'netherlands',
  'switzerland',
] as const;

type CountrySlug = typeof COUNTRY_SLUGS[number];

/**
 * Human-readable country names for the location field. MeteoAlarm's
 * cap:areaDesc is just the regional name (e.g. "Ortenaukreis", "Litoral
 * cántabro") — Nominatim can't reliably geocode those without country
 * context, and the persist pipeline ends up caching a NULL/NULL miss
 * which then plots every event at Null Island in the Gulf of Guinea
 * (this happened 2026-06-24 with the German Ortenaukreis warning).
 *
 * Appending the country name turns "Ortenaukreis" into "Ortenaukreis,
 * Germany" — Nominatim resolves that cleanly to (48.5°N, 7.8°E).
 */
const COUNTRY_NAMES: Record<CountrySlug, string> = {
  spain:        'Spain',
  ireland:      'Ireland',
  germany:      'Germany',
  france:       'France',
  italy:        'Italy',
  netherlands:  'Netherlands',
  switzerland:  'Switzerland',
};

const FEED_URL_BASE = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-';

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
  'cap:identifier'?: string;
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

/**
 * Fetch one country's Atom feed. Returns its entry list (possibly empty).
 * Errors are logged + swallowed at the country level so one bad country
 * (404, 5xx) doesn't kill the whole poll.
 */
interface AtomEntryWithCountry extends AtomEntry {
  /** Injected by fetchCountry so the normalize step can build a geocoder-friendly location string. */
  _countrySlug: CountrySlug;
}

async function fetchCountry(slug: CountrySlug): Promise<AtomEntryWithCountry[]> {
  const url = `${FEED_URL_BASE}${slug}`;
  try {
    // No explicit Accept header — MeteoAlarm's content negotiation rejects
    // specific XML Accept values with 406 even though the per-country path
    // serves Atom+CAP1.2. Node's fetch sends `Accept: */*` by default which
    // is what curl's default sends, and what we tested working on 2026-06-24.
    // User-Agent is kept; MeteoAlarm tolerates any UA but having one
    // identifies us in their logs.
    const resp = await globalThis.fetch(url, {
      headers: {
        'User-Agent': 'nr-safety-alerts/0.1',
      },
    });
    if (!resp.ok) {
      log.warn({ country: slug, status: resp.status }, 'meteoalarm.country.failed');
      return [];
    }
    const text = await resp.text();
    const parsed = xml.parse(text) as AtomFeed;
    const entries = parsed.feed?.entry;
    const arr = Array.isArray(entries) ? entries : entries ? [entries] : [];
    return arr.map(e => ({ ...e, _countrySlug: slug }));
  } catch (err) {
    log.warn({ country: slug, err: (err as Error).message }, 'meteoalarm.country.error');
    return [];
  }
}

export const meteoalarmAdapter: SourceAdapter = {
  id: 'meteoalarm',
  name: 'MeteoAlarm — European weather warnings',
  intervalSeconds: 900,

  async fetch(): Promise<RawAndNormalized[]> {
    // Parallel per-country fetches. Promise.all with the per-country swallow
    // means the slowest country sets the cycle time, ~3-8s typically.
    const perCountry = await Promise.all(COUNTRY_SLUGS.map(fetchCountry));
    const allEntries = perCountry.flat();

    // Dedupe by cap:identifier (or fall back to entry id) in case the same
    // warning surfaces in multiple country feeds at a border region.
    const seen = new Set<string>();
    const list: AtomEntryWithCountry[] = [];
    for (const e of allEntries) {
      const key = e['cap:identifier'] || e.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push(e);
    }

    log.debug(
      { countries: COUNTRY_SLUGS.length, totalEntries: allEntries.length, deduped: list.length },
      'meteoalarm.fetched',
    );

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
      const countryName = COUNTRY_NAMES[e._countrySlug];

      // Geocoder-friendly location: "Ortenaukreis, Germany" not bare "Ortenaukreis".
      // See COUNTRY_NAMES docblock above — Nominatim caches a NULL/NULL miss
      // for bare regional names, which then plots every event at Null Island.
      const locationForGeocode = area ? `${area}, ${countryName}` : countryName;

      const normalized: NormalizedEvent = {
        sourceEventId: e['cap:identifier'] || e.id,
        primarySourceId: 'meteoalarm',
        title: `${eventName} — ${area}`,
        summary: (e.summary || `${eventName} active for ${area}`).replace(/<[^>]+>/g, '').slice(0, 1000),
        severity: verdict.severity!,
        category: 'natural',
        type: eventName.toLowerCase().replace(/\s+/g, '_'),
        location: locationForGeocode,
        lat: 0,                                     // resolved by geocoder
        lng: 0,
        radiusKm: 80,                               // typical regional warning radius
        issuedAt: new Date(e['cap:onset'] || e['cap:effective'] || e.updated || Date.now()),
        expiresAt: e['cap:expires'] ? new Date(e['cap:expires']) : null,
        sourceUrl: firstLink(e),
      };
      items.push({ sourceEventId: normalized.sourceEventId, payload: e, normalized });
    }
    log.info(
      { kept: items.length, droppedThreshold, totalSeen: list.length, countries: COUNTRY_SLUGS.length },
      'meteoalarm.filtered',
    );
    return items;
  },
};
