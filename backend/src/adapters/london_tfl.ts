import type { SourceAdapter, RawAndNormalized, NormalizedEvent } from '../types.js';
import { evaluateLondonTfl } from '../pipeline/thresholds.js';
import { log } from '../log.js';

/**
 * Transport for London — line status / disruption feed.
 *
 * Endpoint: https://api.tfl.gov.uk/Line/Mode/{modes}/Status?detail=true
 * Auth:     none for low-volume use; commercial use requires a free API key
 *           (set TFL_APP_KEY env var to pass it as ?app_key=...)
 * Format:   JSON array of Line objects
 *
 * Mode list is rail-only — bus disruptions flooded the feed without adding
 * actionable signal for an office dashboard, and TfL's older `tflrail` mode
 * was renamed to `elizabeth-line` (sending the old name produces HTTP 400).
 *
 * CMT-RELEVANCE BAR (2026-06-20, after operational tuning):
 *
 *   TfL's 1-20 scale measures service health, not danger. Routine signal
 *   failures + leaves-on-the-line easily clear severity 6 ("Severe Delays")
 *   without any real CMT relevance. Operator feedback on 2026-06-20 was
 *   that LON's alert feed was being flooded with these.
 *
 *   New gate: drop at ingest unless `reason` or `statusSeverityDescription`
 *   contains a CMT incident keyword (police / fire / evacuation / etc.).
 *   For matched events, severity follows the original mapping:
 *     1-3 (Closed/Suspended/Part Suspended)        → ext
 *     4-6 (Planned Closure / Severe Delays)        → high
 *
 *   See `evaluateLondonTfl` in pipeline/thresholds.ts for the keyword regex
 *   and the full rationale. Drop reasons are logged at debug level so we
 *   can audit the cut later.
 *
 * GEOMETRY (2026-06-29 fix): events are plotted at the approximate
 * centroid of the affected LINE rather than at the LON office. Pre-fix,
 * all TfL events hardcoded `lat: LON_LAT, lng: LON_LNG` which made every
 * single event look "Direct" relative to the office regardless of where
 * on the London transit network it actually happened — operator
 * observation on 2026-06-29: a "casualty on track" event on the south-
 * London Overground Windrush Line was tagged Direct/LON despite being
 * ~10-15 miles south of the office.
 *
 * Per-line centroids are static (lines don't move). Lines that pass
 * through central London (Circle, Hammersmith & City, Elizabeth,
 * District, Bakerloo, Central, Northern, Victoria) plot near the office
 * naturally. Outer-London lines (Windrush, East-London Overground,
 * Lioness, Mildmay, Suffragette, Weaver) plot at their actual centroids.
 * Lines we don't have a centroid for fall back to LON_LAT/LON_LNG so
 * coverage isn't lost; that's a TODO for completeness.
 *
 * Radius reduced from 8km → 5km. Pre-fix radius was 8km because the
 * event was office-anchored and we wanted the event to "touch" the
 * office. With actual line-centroid plotting, 5km is enough to capture
 * the line's neighborhood; the relevance-tier classification correctly
 * handles whether the office is within reach.
 */

const MODES = 'tube,dlr,overground,elizabeth-line';
const LON_LAT = 51.5145;
const LON_LNG = -0.1037;

/**
 * Approximate centroid for each TfL line. Hand-curated from the line's
 * geographic span — not the GIS centroid of the polyline, but the
 * approximate middle of where the line runs. For lines that span north-
 * south or east-west, the centroid is near central London naturally;
 * for outer lines (Windrush, Lioness, Suffragette), it's at the line's
 * actual geographic center.
 *
 * Keys are TfL line `id` values (lowercase, hyphenated).
 *
 * Source: hand-checked against the TfL Tube map and Overground / Elizabeth
 * line geographies as of 2026-06-29. If TfL renames or restructures lines,
 * this table needs updating.
 */
const LINE_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  // ── Tube ────────────────────────────────────────────────────────────
  'bakerloo':       { lat: 51.5300, lng: -0.1700 },  // Paddington-Elephant
  'central':        { lat: 51.5160, lng: -0.1100 },  // West Ruislip-Epping
  'circle':         { lat: 51.5145, lng: -0.1037 },  // central London loop
  'district':       { lat: 51.5070, lng: -0.2400 },  // Wimbledon-Upminster (east-west across central)
  'hammersmith-city': { lat: 51.5290, lng: -0.1500 },  // Hammersmith-Barking
  'jubilee':        { lat: 51.5100, lng: -0.1200 },  // Stanmore-Stratford
  'metropolitan':   { lat: 51.5800, lng: -0.4200 },  // northwest London suburbs
  'northern':       { lat: 51.5150, lng: -0.1300 },  // Edgware-Morden
  'piccadilly':     { lat: 51.5050, lng: -0.1400 },  // Heathrow-Cockfosters
  'victoria':       { lat: 51.5250, lng: -0.1300 },  // Brixton-Walthamstow
  'waterloo-city':  { lat: 51.5050, lng: -0.0950 },  // Waterloo-Bank shuttle
  // ── DLR ─────────────────────────────────────────────────────────────
  'dlr':            { lat: 51.5060, lng: -0.0140 },  // Docklands, east London
  // ── Overground (renamed per-line 2024) ──────────────────────────────
  'windrush':       { lat: 51.4500, lng: -0.0600 },  // Sydenham-Croydon (south London)
  'suffragette':    { lat: 51.5700, lng: 0.0000 },   // Gospel Oak-Barking
  'mildmay':        { lat: 51.5400, lng: -0.1500 },  // Stratford-Richmond
  'lioness':        { lat: 51.6200, lng: -0.3500 },  // Watford-Euston
  'weaver':         { lat: 51.5800, lng: -0.0500 },  // North-east London
  'liberty':        { lat: 51.5500, lng:  0.1000 },  // East London
  // ── Elizabeth ───────────────────────────────────────────────────────
  'elizabeth-line': { lat: 51.5140, lng: -0.0700 },  // Reading-Shenfield (east-west across central)
};

function coordsForLine(lineId: string): { lat: number; lng: number } {
  return LINE_CENTROIDS[lineId] ?? { lat: LON_LAT, lng: LON_LNG };
}

function buildFeedUrl(): string {
  const url = `https://api.tfl.gov.uk/Line/Mode/${MODES}/Status?detail=true`;
  if (process.env.TFL_APP_KEY) {
    return `${url}&app_key=${encodeURIComponent(process.env.TFL_APP_KEY)}`;
  }
  return url;
}

interface TflLineStatus {
  statusSeverity?: number;
  statusSeverityDescription?: string;
  reason?: string;
  validityPeriods?: Array<{ fromDate: string; toDate: string; isNow: boolean }>;
}
interface TflLine {
  id: string;
  name: string;
  modeName: string;
  lineStatuses?: TflLineStatus[];
  disruptions?: unknown[];
}

export const londonTflAdapter: SourceAdapter = {
  id: 'london_tfl',
  name: 'Transport for London — disruption feed',
  intervalSeconds: 600,

  async fetch(): Promise<RawAndNormalized[]> {
    const resp = await globalThis.fetch(buildFeedUrl(), {
      headers: { Accept: 'application/json', 'User-Agent': 'nr-safety-alerts/0.1' },
    });
    if (!resp.ok) throw new Error(`TfL returned HTTP ${resp.status}`);
    const data = (await resp.json()) as TflLine[];
    log.debug({ count: data.length }, 'london_tfl.fetched');

    const items: RawAndNormalized[] = [];
    const now = Date.now();
    let droppedNoKeyword = 0;
    let droppedSeverity  = 0;
    for (const line of data) {
      const statuses = line.lineStatuses ?? [];
      // Pick the worst (lowest severity number = worst)
      const worst = statuses
        .filter((s) => typeof s.statusSeverity === 'number')
        .sort((a, b) => (a.statusSeverity! - b.statusSeverity!))[0];
      if (!worst) continue;

      // CMT-relevance gate: drop unless reason/description contains an
      // incident keyword. See evaluateLondonTfl for the rationale and the
      // keyword regex. Severity is also computed here for matched events.
      const verdict = evaluateLondonTfl({
        statusSeverity: worst.statusSeverity!,
        reason:         worst.reason ?? '',
        description:    worst.statusSeverityDescription ?? '',
      });
      if (!verdict.pass) {
        if (/keyword/.test(verdict.reason)) droppedNoKeyword++;
        else                                droppedSeverity++;
        log.debug({ lineId: line.id, statusSeverity: worst.statusSeverity, reason: verdict.reason },
                  'london_tfl.dropped');
        continue;
      }
      const sev = verdict.severity!;

      // Filter to currently-active disruptions
      const active = (worst.validityPeriods ?? []).find((p) => p.isNow) ??
                     (worst.validityPeriods ?? [])[0];
      const fromDate = active?.fromDate ? new Date(active.fromDate) : new Date(now);
      const toDate = active?.toDate ? new Date(active.toDate) : null;

      const reason = (worst.reason ?? worst.statusSeverityDescription ?? 'Service disruption').replace(/\s+/g, ' ').trim();
      const id = `${line.id}::${worst.statusSeverity}::${active?.fromDate ?? now}`;

      // Plot at the affected line's approximate centroid (see LINE_CENTROIDS).
      // Pre-2026-06-29 we hardcoded LON_LAT/LON_LNG which made everything look
      // Direct relative to the office regardless of where on the network the
      // disruption was. Now a Windrush Line casualty in south London plots in
      // south London, not at Strand.
      const coords = coordsForLine(line.id);

      const normalized: NormalizedEvent = {
        sourceEventId: id,
        primarySourceId: 'london_tfl',
        title: `${line.name} — ${worst.statusSeverityDescription ?? 'Disruption'}`,
        summary: reason.slice(0, 800),
        severity: sev,
        category: 'public_safety',
        type: 'transit_disruption',
        location: `${line.name} (${line.modeName})`,
        lat: coords.lat,
        lng: coords.lng,
        radiusKm: 5,                                  // line-neighborhood; relevance-tier handles office reach
        issuedAt: fromDate,
        expiresAt: toDate,
        sourceUrl: `https://tfl.gov.uk/${line.modeName}/route/${encodeURIComponent(line.id)}`,
      };
      items.push({ sourceEventId: id, payload: line, normalized });
    }
    log.info(
      { kept: items.length, droppedNoKeyword, droppedSeverity },
      'london_tfl.filtered',
    );
    return items;
  },
};
