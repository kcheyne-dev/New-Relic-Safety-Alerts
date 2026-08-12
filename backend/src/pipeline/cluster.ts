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
  affected_office_ids: string[];
  location: string | null;
  radius_km: number | null;
  issued_at: Date;
  source_url: string | null;
  raw_event_ids?: number[] | null;
}

/**
 * Merged-event row shape suitable for feeding directly to rowToApi / the SSE
 * publish path. mergeIntoCluster returns this so persist.ts doesn't need a
 * follow-up SELECT to hydrate the updated row.
 */
export interface MergedRow {
  id: string;
  title: string;
  summary: string | null;
  severity: Severity;
  type: string | null;
  primary_source_id: string;
  location: string | null;
  lat: number;
  lng: number;
  radius_km: number | null;
  issued_at: Date;
  source_url: string | null;
  affected_office_ids: string[];
  contributing_sources: string[];
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
    SELECT id, cluster_id, primary_source_id, severity, contributing_sources,
           affected_office_ids, location, radius_km, issued_at, source_url
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
 *
 * Returns { wasNewContributor, mergedRow }. The mergedRow lets callers publish
 * the updated event to SSE subscribers without a follow-up SELECT.
 *
 * Dedup for contributing_sources + affected_office_ids happens in JS via Sets
 * (2026-08-06, health review item #8). The prior implementation used
 * `ARRAY(SELECT DISTINCT unnest(a || $b::text[]))` twice per UPDATE, which
 * ran two subquery-based set operations on every merge — noise for the
 * planner on hot cross-source clusters (e.g. a Tokyo quake landing via USGS
 * + EMSC + GDACS in the same window). Both source arrays are already in
 * memory, so JS Set-based dedup is O(n) with no query overhead.
 */
export async function mergeIntoCluster(
  client: PoolClient,
  match: ClusterMatch,
  e: NormalizedEvent,
  rawId: number | null,
  officeIds: string[]
): Promise<{ wasNewContributor: boolean; mergedRow: MergedRow }> {
  const wasNewContributor = !match.contributing_sources.includes(e.primarySourceId);
  const merged = chooseMergedPrimary(
    { primary_source_id: match.primary_source_id, severity: match.severity },
    { primary_source_id: e.primarySourceId, severity: e.severity }
  );

  // Dedup in JS. Sets preserve insertion order which is what the DB's
  // DISTINCT unnest gave us anyway (implementation-defined but stable),
  // and both source arrays are small (~1-4 entries).
  const contributingSources = [...new Set([...match.contributing_sources, e.primarySourceId])];
  const affectedOffices     = [...new Set([...match.affected_office_ids, ...officeIds])];

  // Primary-source-conditional fields: only if this incoming event is (or
  // becomes) the primary source do we overwrite title/summary/source_url.
  const becomesPrimary = merged.primary_source_id === e.primarySourceId;
  const finalTitle     = becomesPrimary ? e.title : /* keep existing — mergedRow gets it below */ null;
  const finalSummary   = becomesPrimary ? e.summary : null;
  const finalSourceUrl = becomesPrimary ? (e.sourceUrl ?? match.source_url) : match.source_url;
  const finalRadiusKm  = e.radiusKm ?? match.radius_km;

  const updated = await client.query<{ title: string; summary: string | null; lat: number; lng: number; type: string | null }>(
    `
    UPDATE events SET
      primary_source_id    = $2,
      severity             = $3,
      contributing_sources = $4::text[],
      affected_office_ids  = $5::text[],
      title                = CASE WHEN $6::boolean THEN $7 ELSE title END,
      summary              = CASE WHEN $6::boolean THEN $8 ELSE summary END,
      source_url           = COALESCE($9, source_url),
      radius_km            = COALESCE($10, radius_km),
      expires_at           = COALESCE($11, expires_at),
      raw_event_id         = COALESCE(raw_event_id, $12),
      updated_at           = NOW()
    WHERE id = $1
    RETURNING title, summary, lat, lng, type
    `,
    [
      match.id,
      merged.primary_source_id,
      merged.severity,
      contributingSources,
      affectedOffices,
      becomesPrimary,
      finalTitle,
      finalSummary,
      finalSourceUrl,
      finalRadiusKm,
      e.expiresAt,
      rawId,
    ]
  );

  const row = updated.rows[0];
  const mergedRow: MergedRow = {
    id:                   match.id,
    title:                row?.title ?? e.title,
    summary:              row?.summary ?? e.summary,
    severity:             merged.severity,
    type:                 row?.type ?? e.type,
    primary_source_id:    merged.primary_source_id,
    location:             match.location,
    lat:                  Number(row?.lat ?? e.lat),
    lng:                  Number(row?.lng ?? e.lng),
    radius_km:            finalRadiusKm,
    issued_at:            match.issued_at,
    source_url:           finalSourceUrl,
    affected_office_ids:  affectedOffices,
    contributing_sources: contributingSources,
  };

  return { wasNewContributor, mergedRow };
}
