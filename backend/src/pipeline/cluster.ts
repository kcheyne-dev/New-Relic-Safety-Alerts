import type { PoolClient } from 'pg';
import type { NormalizedEvent, Severity } from '../types.js';
import { SEV_RANK } from './severity.js';

/**
 * Cross-source clustering.
 *
 * When USGS, EMSC, and GDACS all publish news of the same Tokyo earthquake
 * within a few minutes, we want ONE event in our `events` table — not three.
 *
 * A new normalized event is considered the same as an existing one if all of:
 *   1. Same `type` (e.g. 'earthquake')
 *   2. issued_at within ±30 minutes
 *   3. Within 25 km (PostGIS ST_DWithin)
 *
 * The lowest-numbered (oldest) event in the cluster keeps its id; subsequent
 * events from other sources get folded in: their source_id is appended to
 * `contributing_sources`, and if their severity is higher, the cluster's
 * severity is bumped up. The cluster always keeps a stable cluster_id.
 */

/** Window for cross-source clustering (±30 min). */
const CLUSTER_TIME_WINDOW_SEC = 30 * 60;

/** Max distance for cluster match (25 km). */
const CLUSTER_DISTANCE_KM = 25;

export interface ClusterMatch {
  id: string;
  cluster_id: string | null;
  primary_source_id: string;
  severity: Severity;
  contributing_sources: string[];
  raw_event_ids?: number[] | null;
}

/**
 * Look up an existing event that should be merged with this one.
 * Returns null if no cluster found — caller should insert a fresh row.
 */
export async function findClusterMatch(
  client: PoolClient,
  e: NormalizedEvent
): Promise<ClusterMatch | null> {
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng)) return null;

  const result = await client.query<ClusterMatch>(
    `
    SELECT id, cluster_id, primary_source_id, severity, contributing_sources
    FROM events
    WHERE type = $1
      AND NOT is_stale
      AND issued_at BETWEEN $2::timestamptz - make_interval(secs => $3)
                        AND $2::timestamptz + make_interval(secs => $3)
      AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6)
    ORDER BY ABS(EXTRACT(EPOCH FROM (issued_at - $2::timestamptz)))
    LIMIT 1
    `,
    [
      e.type,
      e.issuedAt,
      CLUSTER_TIME_WINDOW_SEC,
      e.lng, e.lat,
      CLUSTER_DISTANCE_KM * 1000,
    ]
  );
  return result.rows[0] ?? null;
}

/**
 * Decide the merged primary source. We keep the source whose severity is
 * highest; ties broken by the existing primary (stability).
 */
export function chooseMergedPrimary(
  current: { primary_source_id: string; severity: Severity },
  incoming: { primary_source_id: string; severity: Severity }
): { primary_source_id: string; severity: Severity } {
  if (SEV_RANK[incoming.severity] > SEV_RANK[current.severity]) {
    return incoming;
  }
  return current;
}

/**
 * Update an existing event when a new contributing source arrives.
 * - Adds the new source_id to `contributing_sources` (if not present).
 * - May bump severity / change primary_source_id if this source is more severe.
 * - Always extends `affected_office_ids` if new offices match.
 */
export async function mergeIntoCluster(
  client: PoolClient,
  match: ClusterMatch,
  e: NormalizedEvent,
  rawId: number | null,
  officeIds: string[]
): Promise<{ wasNewContributor: boolean }> {
  const wasNewContributor = !match.contributing_sources.includes(e.primarySourceId);
  const merged = chooseMergedPrimary(
    { primary_source_id: match.primary_source_id, severity: match.severity },
    { primary_source_id: e.primarySourceId, severity: e.severity }
  );

  await client.query(
    `
    UPDATE events SET
      primary_source_id    = $2,
      severity             = $3,
      contributing_sources = ARRAY(SELECT DISTINCT unnest(contributing_sources || $4::text[])),
      affected_office_ids  = ARRAY(SELECT DISTINCT unnest(affected_office_ids || $5::text[])),
      title                = CASE WHEN $2 = $6 THEN $7 ELSE title END,
      summary              = CASE WHEN $2 = $6 THEN $8 ELSE summary END,
      source_url           = CASE WHEN $2 = $6 THEN COALESCE($9, source_url) ELSE source_url END,
      radius_km            = COALESCE($10, radius_km),
      expires_at           = COALESCE($11, expires_at),
      raw_event_id         = COALESCE(raw_event_id, $12),
      updated_at           = NOW()
    WHERE id = $1
    `,
    [
      match.id,
      merged.primary_source_id,
      merged.severity,
      [e.primarySourceId],
      officeIds,
      e.primarySourceId,            // condition operand for the title/summary update
      e.title,
      e.summary,
      e.sourceUrl,
      e.radiusKm,
      e.expiresAt,
      rawId,
    ]
  );
  return { wasNewContributor };
}
