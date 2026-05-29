import type { SourceAdapter, RawAndNormalized, NormalizedEvent, Severity, Category } from '../types.js';
import { log } from '../log.js';

/**
 * GDACS — Global Disaster Alert and Coordination System.
 *
 * Endpoint: https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH
 *           ?eventlist=EQ;TC;FL;VO;DR;WF&fromdate=YYYY-MM-DD
 * Auth:     none
 * Format:   GeoJSON FeatureCollection
 *
 * GDACS publishes a structured 3-tier severity:
 *   alertlevel: 'Green' | 'Orange' | 'Red'
 *   → mod / high / ext respectively (we treat Green as a notable event still worth showing)
 *
 * Event types (eventtype):
 *   EQ = Earthquake, TC = Tropical Cyclone, FL = Flood, VO = Volcano,
 *   DR = Drought, WF = Wildfire
 */

interface GdacsFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    eventid: number;
    eventtype: 'EQ' | 'TC' | 'FL' | 'VO' | 'DR' | 'WF' | string;
    eventname: string;
    name: string;
    description: string;
    htmldescription: string;
    icon: string;
    iconoverall: string;
    url: { report: string; details: string; geometry: string };
    alertlevel: 'Green' | 'Orange' | 'Red';
    alertscore: number;
    episodealertlevel: string;
    fromdate: string;
    todate: string;
    iso3: string | null;
    country: string;
    severitydata: { severity: number; severitytext: string; severityunit: string };
  };
}
interface GdacsFeed {
  type: 'FeatureCollection';
  features: GdacsFeature[];
}

const TYPE_MAP: Record<string, { type: string; cat: Category }> = {
  EQ: { type: 'earthquake', cat: 'natural' },
  TC: { type: 'tropical_cyclone', cat: 'natural' },
  FL: { type: 'flood', cat: 'natural' },
  VO: { type: 'volcano', cat: 'natural' },
  DR: { type: 'drought', cat: 'natural' },
  WF: { type: 'wildfire', cat: 'natural' },
};

const SEV_MAP: Record<string, Severity> = {
  Green: 'mod',
  Orange: 'high',
  Red: 'ext',
};

function fromDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

const BASE = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';

export const gdacsAdapter: SourceAdapter = {
  id: 'gdacs',
  name: 'Global Disaster Alert and Coordination System',
  intervalSeconds: 600,

  async fetch(): Promise<RawAndNormalized[]> {
    const url = `${BASE}?eventlist=EQ;TC;FL;VO;DR;WF&fromdate=${fromDate(7)}&alertlevel=Green;Orange;Red`;
    const resp = await globalThis.fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`GDACS feed returned HTTP ${resp.status}`);
    const data = (await resp.json()) as GdacsFeed;
    log.debug({ count: data.features?.length ?? 0 }, 'gdacs.fetched');

    const items: RawAndNormalized[] = [];
    for (const f of data.features ?? []) {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const mapped = TYPE_MAP[p.eventtype] ?? { type: p.eventtype.toLowerCase(), cat: 'natural' as Category };
      const sev = SEV_MAP[p.alertlevel] ?? 'mod';

      const country = p.country ?? '';
      const title = `${p.eventname || p.name} ${country ? `— ${country}` : ''}`.trim();
      const summary = (p.description || p.htmldescription || '')
        .replace(/<[^>]+>/g, '')                  // strip HTML
        .slice(0, 1000) ||
        `${mapped.type} alert at ${p.alertlevel} level. Severity ${p.severitydata?.severity ?? '?'} ${p.severitydata?.severityunit ?? ''}.`;

      const normalized: NormalizedEvent = {
        sourceEventId: String(p.eventid),
        primarySourceId: 'gdacs',
        title,
        summary,
        severity: sev,
        category: mapped.cat,
        type: mapped.type,
        location: country || p.eventname || 'unspecified',
        lat,
        lng,
        radiusKm: null,
        issuedAt: new Date(p.fromdate),
        expiresAt: p.todate ? new Date(p.todate) : null,
        sourceUrl: p.url?.report ?? null,
      };
      items.push({ sourceEventId: String(p.eventid), payload: f, normalized });
    }
    return items;
  },
};
