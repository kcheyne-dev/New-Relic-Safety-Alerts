import { withTx, pool } from '../db.js';
import type { RawAndNormalized } from '../types.js';
import { log } from '../log.js';
import { ensureCoords } from './geocode.js';
import { findClusterMatch, mergeIntoCluster } from './cluster.js';
import { bus } from '../events_bus.js';

/**
 * Insert raw + normalized events. Idempotent on (source, source_event_id).
 *
 * Pipeline per item:
 *   1. Geocode if missing coords
 *   2. Upsert raw_events (audit log of every payload)
 *   3. Find offices in proximity (PostGIS ST_DWithin)
 *   3b.Threshold proximity gate — drop borderline mid-sev events that
 *      have no office within their requiresProximityKm radius. See
 *      pipeline/thresholds.ts and docs/severity-thresholds.md.
 *   4. Cluster check — does an event from a different source already exist
 *      that matches this one in time/space/topic?
 *      - YES → merge into that cluster (no new row)
 *      - NO  → insert new event with its own cluster_id
 *   5. Publish to event bus so SSE subscribers get pushed updates
 */

export interface IngestStats {
  fetched:      number;
  inserted:     number;     // brand new events
  updated:      number;     // same-source re-upsert (e.g. quake details revised)
  merged:       number;     // cross-source: this source contributed to an existing cluster
  skipped:      number;
}

const DEFAULT_PROXIMITY_KM = {
  natural:       100,
  civil:          25,
  public_safety:  10,
  travel:        500,    // travel advisories are country-wide; office matching looser
  health:        200,
} as const;

export async function persistBatch(
  sourceId: string,
  items: RawAndNormalized[]
): Promise<IngestStats> {
  const stats: IngestStats = { fetched: items.length, inserted: 0, updated: 0, merged: 0, skipped: 0 };
  if (items.length === 0) return stats;

  // Pre-pass: geocode any items missing coordinates. Done outside the transaction
  // so a slow Nominatim call doesn't hold a DB connection.
  for (const item of items) {
    const ok = await ensureCoords(item.normalized);
    if (!ok) {
      log.warn({ source: sourceId, id: item.sourceEventId, loc: item.normalized.location }, 'geocode.unresolved');
    }
  }

  // Defensive guard: drop any event still at (0, 0) after geocoding. Without
  // this, unresolved events plot at Null Island in the Gulf of Guinea — see
  // the 2026-06-24 MeteoAlarm Ortenaukreis incident. The geocode.unresolved
  // warn above tells operators that resolution failed; better to drop than
  // to plot at a misleading location. Counted as `skipped` so it shows up
  // in the per-poll stats.
  const persistable = items.filter(item => {
    const n = item.normalized;
    if (n.lat === 0 && n.lng === 0) {
      stats.skipped++;
      log.warn(
        { source: sourceId, id: item.sourceEventId, loc: n.location },
        'persist.dropped.null_island',
      );
      return false;
    }
    return true;
  });

  if (persistable.length === 0) {
    return stats;
  }

  const publishQueue: unknown[] = [];

  await withTx(async (client) => {
    for (const item of persistable) {
      const n = item.normalized;
      // --- 1. Upsert raw_events ---
      const rawRes = await client.query<{ id: number }>(
        `INSERT INTO raw_events (source_id, source_event_id, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (source_id, source_event_id) DO UPDATE
           SET payload = EXCLUDED.payload, fetched_at = NOW()
         RETURNING id`,
        [sourceId, item.sourceEventId, JSON.stringify(item.payload)]
      );
      const rawId = rawRes.rows[0]?.id ?? null;

      // --- 2. Office proximity match ---
      const radiusForCategory = n.radiusKm ?? DEFAULT_PROXIMITY_KM[n.category] ?? 100;
      let officeIds: string[] = [];
      if (radiusForCategory > 0 && Number.isFinite(n.lat) && Number.isFinite(n.lng)) {
        const officeRes = await client.query<{ id: string }>(
          `SELECT id FROM offices
           WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
          [n.lng, n.lat, radiusForCategory * 1000]
        );
        officeIds = officeRes.rows.map((r) => r.id);
      }

      // --- 2b. Threshold proximity gate ---
      // Some adapter rules (e.g. M5+ earthquake, ACLED 0-fat battle, EONET
      // wildfire) only clear the bar when an office is reasonably close.
      // requiresProximityKm is set by pipeline/thresholds.ts when the
      // adapter's verdict was "keep, but only if near an office".
      const requiresProximityKm = item.thresholds?.requiresProximityKm;
      if (requiresProximityKm && officeIds.length === 0
          && Number.isFinite(n.lat) && Number.isFinite(n.lng)) {
        const proxRes = await client.query<{ exists: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM offices
             WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
           ) AS exists`,
          [n.lng, n.lat, requiresProximityKm * 1000]
        );
        if (!proxRes.rows[0]?.exists) {
          log.debug(
            { source: sourceId, id: item.sourceEventId, requiresProximityKm },
            'threshold.proximity.dropped'
          );
          stats.skipped++;
          continue;
        }
      }

      // --- 3. Cluster check: does an existing event match in time/space/type? ---
      const match = await findClusterMatch(client, n);

      if (match && match.primary_source_id !== sourceId) {
        // Cross-source cluster hit — fold this source into the existing event
        const { wasNewContributor } = await mergeIntoCluster(client, match, n, rawId, officeIds);
        if (wasNewContributor) stats.merged++;
        else stats.updated++;

        // Push the now-updated event to subscribers
        const updated = await client.query(
          `SELECT id, title, summary, severity, type, primary_source_id, location,
                  lat, lng, radius_km, issued_at, source_url, affected_office_ids, contributing_sources
           FROM events WHERE id = $1`,
          [match.id]
        );
        if (updated.rows[0]) publishQueue.push({ kind: 'updated', event: rowToApi(updated.rows[0]) });
        continue;
      }

      // --- 4. No cluster match — insert as new event (or update same-source dup) ---
      const sourceUrl = n.sourceUrl ?? `urn:${sourceId}:${item.sourceEventId}`;
      const upsertRes = await client.query<{ id: string; was_new: boolean }>(
        `INSERT INTO events (
            id, cluster_id, title, summary, severity, category, type, location,
            lat, lng, radius_km, issued_at, expires_at,
            primary_source_id, contributing_sources, source_url,
            affected_office_ids, raw_event_id
         ) VALUES (
            uuid_generate_v4(), uuid_generate_v4(),
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, ARRAY[$12], $13,
            $14::text[], $15
         )
         ON CONFLICT (primary_source_id, source_url, issued_at) DO UPDATE SET
            title = EXCLUDED.title,
            summary = EXCLUDED.summary,
            severity = EXCLUDED.severity,
            radius_km = EXCLUDED.radius_km,
            expires_at = EXCLUDED.expires_at,
            affected_office_ids = EXCLUDED.affected_office_ids,
            updated_at = NOW()
         RETURNING id, (xmax = 0) AS was_new`,
        [
          n.title, n.summary, n.severity, n.category, n.type, n.location,
          n.lat, n.lng, n.radiusKm, n.issuedAt, n.expiresAt,
          n.primarySourceId, sourceUrl,
          officeIds, rawId,
        ]
      );
      if (upsertRes.rows[0]?.was_new) {
        stats.inserted++;
        publishQueue.push({ kind: 'new', eventId: upsertRes.rows[0].id });
      } else {
        stats.updated++;
        publishQueue.push({ kind: 'updated', eventId: upsertRes.rows[0]?.id });
      }
    }
  });

  // Hydrate "new" events from DB (they were created above) and publish all queued updates
  for (const msg of publishQueue) {
    bus.publish('event', msg);
  }

  log.info(stats, `${sourceId}.persisted`);
  return stats;
}

/** Map a raw DB row to the same shape the REST API returns. */
function rowToApi(r: any) {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary ?? '',
    sev: r.severity,
    type: r.type ?? '',
    source: r.primary_source_id,
    location: r.location ?? '',
    lat: Number(r.lat),
    lng: Number(r.lng),
    radiusKm: r.radius_km == null ? null : Number(r.radius_km),
    issued: r.issued_at instanceof Date ? r.issued_at.toISOString() : String(r.issued_at),
    officeId: (r.affected_office_ids?.[0] ?? null) as string | null,
    affectedOfficeIds: (r.affected_office_ids ?? []) as string[],
    sourceUrl: r.source_url ?? null,
    contributingSources: (r.contributing_sources ?? []) as string[],
  };
}

export async function markSourceOk(sourceId: string): Promise<void> {
  await pool.query(
    `UPDATE sources SET last_ok_at = NOW(), last_error = NULL WHERE id = $1`,
    [sourceId]
  );
}
export async function markSourceError(sourceId: string, msg: string): Promise<void> {
  await pool.query(
    `UPDATE sources SET last_error_at = NOW(), last_error = $2 WHERE id = $1`,
    [sourceId, msg.slice(0, 500)]
  );
}
