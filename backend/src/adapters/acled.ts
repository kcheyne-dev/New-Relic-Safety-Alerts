import type { SourceAdapter, RawAndNormalized, NormalizedEvent, Severity, Category } from '../types.js';
import { log } from '../log.js';
import { config } from '../config.js';

/**
 * ACLED — Armed Conflict Location & Event Data Project.
 *
 * Vetted incidents (vs GDELT's article mentions). Real lat/lng. Fatalities count.
 * Free for personal/academic use; commercial use requires a paid license.
 *
 * Auth: OAuth2 password-flow.
 *   POST https://acleddata.com/oauth/token
 *     { username, password, grant_type: 'password', client_id: 'acled', scope: 'authenticated' }
 *   → { access_token, refresh_token, expires_in, ... }
 *   Subsequent calls use Authorization: Bearer <access_token>.
 *
 * Read endpoint:
 *   GET https://acleddata.com/api/acled/read?event_date=YYYY-MM-DD|YYYY-MM-DD&event_date_where=BETWEEN
 *   Returns { success, count, data: [...] } where each row has:
 *     event_id_cnty, event_date, event_type, sub_event_type, actor1, actor2,
 *     country, region, admin1..admin3, location, latitude, longitude,
 *     notes, fatalities, source, source_scale, ...
 *
 * Filters we apply post-fetch:
 *  - event_type ∈ {Battles, Violence against civilians, Explosions/Remote violence,
 *                  Riots, Strategic developments}
 *    (Skip generic "Protests" — ACLED is liberal about what counts.)
 *  - Severity:
 *      Battles / Explosions / Violence-against-civilians:
 *         5+ fatalities → ext, 1-4 → high, 0 → mod
 *      Riots:
 *         5+ fatalities → high, 1-4 → mod, 0 → low
 *      Strategic developments:
 *         high if fatalities>0 else mod
 */

const TOKEN_URL = 'https://acleddata.com/oauth/token';
const READ_URL  = 'https://acleddata.com/api/acled/read';

const ALLOWED_EVENT_TYPES = new Set([
  'Battles',
  'Violence against civilians',
  'Explosions/Remote violence',
  'Riots',
  'Strategic developments',
]);

const TYPE_TO_NORMALIZED: Record<string, string> = {
  'Battles':                       'armed_conflict',
  'Violence against civilians':    'violence_civilians',
  'Explosions/Remote violence':    'explosion',
  'Riots':                         'riot',
  'Strategic developments':        'strategic_dev',
};

interface AcledRow {
  event_id_cnty: string;
  event_date: string;          // YYYY-MM-DD
  event_type: string;
  sub_event_type?: string;
  actor1?: string;
  actor2?: string;
  country: string;
  region: string;
  admin1?: string;
  admin2?: string;
  location: string;
  latitude: string | number;
  longitude: string | number;
  notes?: string;
  fatalities: string | number;
  source?: string;
  source_scale?: string;
}

interface AcledResponse {
  success?: boolean;
  count?: number;
  data?: AcledRow[];
  error?: { status?: number; message?: string };
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;          // seconds
  refresh_token?: string;
  token_type?: string;
}

// In-process token cache. Refreshes on 401 or near-expiry.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const body = {
    username:   config.sources.acled.email,
    password:   config.sources.acled.password,
    grant_type: 'password',
    client_id:  'acled',
    scope:      'authenticated',
  };
  const resp = await globalThis.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '<no body>');
    throw new Error(`ACLED token request failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  const data = (await resp.json()) as TokenResponse;
  if (!data.access_token) throw new Error('ACLED token response missing access_token');
  const ttlMs = (data.expires_in ?? 3600) * 1000;
  cachedToken = { value: data.access_token, expiresAt: Date.now() + ttlMs };
  log.debug({ ttlSec: data.expires_in }, 'acled.token_refreshed');
  return cachedToken.value;
}

function severityFor(eventType: string, fatalities: number): Severity {
  switch (eventType) {
    case 'Battles':
    case 'Explosions/Remote violence':
    case 'Violence against civilians':
      if (fatalities >= 5) return 'ext';
      if (fatalities >= 1) return 'high';
      return 'mod';
    case 'Riots':
      if (fatalities >= 5) return 'high';
      if (fatalities >= 1) return 'mod';
      return 'low';
    case 'Strategic developments':
      return fatalities > 0 ? 'high' : 'mod';
    default:
      return 'mod';
  }
}

function isoDateNDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);   // YYYY-MM-DD
}

function buildReadUrl(): string {
  const today    = new Date().toISOString().slice(0, 10);
  const lookback = isoDateNDaysAgo(config.sources.acled.lookbackDays);
  const params   = new URLSearchParams({
    event_date:       `${lookback}|${today}`,
    event_date_where: 'BETWEEN',
    limit:            '500',
  });
  return `${READ_URL}?${params.toString()}`;
}

async function fetchOnce(token: string): Promise<AcledResponse> {
  const url = buildReadUrl();
  const resp = await globalThis.fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
    },
  });
  if (resp.status === 401) {
    cachedToken = null;
    throw new Error('ACLED token rejected (401)');
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '<no body>');
    throw new Error(`ACLED read failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as AcledResponse;
}

export const acledAdapter: SourceAdapter = {
  id: 'acled',
  name: 'ACLED — Armed Conflict Location & Event Data',
  intervalSeconds: config.sources.acled.intervalSeconds,

  async fetch(): Promise<RawAndNormalized[]> {
    if (!config.sources.acled.email || !config.sources.acled.password) {
      throw new Error('ACLED_EMAIL and ACLED_PASSWORD must be set in .env');
    }

    let token = await getToken();
    let resp: AcledResponse;
    try {
      resp = await fetchOnce(token);
    } catch (err) {
      // One retry after token refresh
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401')) {
        token = await getToken();
        resp  = await fetchOnce(token);
      } else {
        throw err;
      }
    }

    if (resp.error?.status) {
      throw new Error(`ACLED API error: ${resp.error.message ?? JSON.stringify(resp.error)}`);
    }

    const rows = resp.data ?? [];
    log.debug({ count: rows.length }, 'acled.fetched');

    const items: RawAndNormalized[] = [];
    let droppedType = 0, droppedGeo = 0;
    for (const r of rows) {
      if (!ALLOWED_EVENT_TYPES.has(r.event_type)) { droppedType++; continue; }

      const lat = typeof r.latitude  === 'number' ? r.latitude  : parseFloat(String(r.latitude));
      const lng = typeof r.longitude === 'number' ? r.longitude : parseFloat(String(r.longitude));
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
        droppedGeo++;
        continue;
      }

      const fatalities = typeof r.fatalities === 'number' ? r.fatalities : parseInt(String(r.fatalities ?? 0), 10) || 0;
      const sev: Severity   = severityFor(r.event_type, fatalities);
      const type            = TYPE_TO_NORMALIZED[r.event_type] ?? 'civil_unrest';
      const issuedAt        = new Date(`${r.event_date}T12:00:00Z`);          // ACLED publishes date only

      const titleParts = [
        r.event_type,
        r.sub_event_type && r.sub_event_type !== r.event_type ? `(${r.sub_event_type})` : '',
        '—',
        [r.location, r.admin1, r.country].filter(Boolean).join(', '),
      ].filter(Boolean);
      const title = titleParts.join(' ');

      const summary = [
        fatalities > 0 ? `${fatalities} fatalit${fatalities === 1 ? 'y' : 'ies'} reported.` : null,
        r.actor1 ? `Actor: ${r.actor1}${r.actor2 ? ` vs ${r.actor2}` : ''}.` : null,
        r.notes ? r.notes.trim() : null,
      ].filter(Boolean).join(' ');

      const normalized: NormalizedEvent = {
        sourceEventId:   r.event_id_cnty,
        primarySourceId: 'acled',
        title:           title.slice(0, 200),
        summary:         summary.slice(0, 1000) || `${r.event_type} in ${r.country}.`,
        severity:        sev,
        category:        'civil',
        type,
        location:        [r.location, r.admin1, r.country].filter(Boolean).join(', '),
        lat,
        lng,
        radiusKm:        25,                                    // ACLED locations are typically town/city precision
        issuedAt,
        expiresAt:       null,
        sourceUrl:       r.source ? r.source : `https://acleddata.com/dashboard/`,
      };
      items.push({ sourceEventId: r.event_id_cnty, payload: r, normalized });
    }
    log.info({ kept: items.length, droppedType, droppedGeo, totalSeen: rows.length }, 'acled.filtered');
    return items;
  },
};
