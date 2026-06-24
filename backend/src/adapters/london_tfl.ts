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
 * Disruptions are emitted as events anchored to the LON office coordinates.
 * For a real product we'd plot the actual disrupted segment polyline; for a
 * dashboard view, an office-anchored circle is fine.
 */

const MODES = 'tube,dlr,overground,elizabeth-line';
const LON_LAT = 51.5145;
const LON_LNG = -0.1037;

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

      const normalized: NormalizedEvent = {
        sourceEventId: id,
        primarySourceId: 'london_tfl',
        title: `${line.name} — ${worst.statusSeverityDescription ?? 'Disruption'}`,
        summary: reason.slice(0, 800),
        severity: sev,
        category: 'public_safety',
        type: 'transit_disruption',
        location: `${line.name} (${line.modeName})`,
        lat: LON_LAT,
        lng: LON_LNG,
        radiusKm: 8,                                  // London office reach
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
