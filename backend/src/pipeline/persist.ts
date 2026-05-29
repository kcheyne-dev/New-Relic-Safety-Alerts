import { withTx } from '../db.js';
import type { RawAndNormalized, NormalizedEvent } from '../types.js';
import { log } from '../log.js';

/**
 * Insert raw + normalized events. Idempotent on (source, source_event_id).
 * Office matching happens here too — anything within a per-source default
 * radius of any office gets stamped with that office's id.
 *
 * Returns counts so the worker can log what happened.
 */
export interface IngestStats {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

const DEFAULT_PROXIMITY_KM = {
  natural: 100,        // earthquakes/storms have wide felt radius
  civil: 25,           // protests, unrest — local
  public_safety: 25,   // local incidents
  travel: 0,           // travel advisories don't have a fixed proximity
  health: 200,         // outbreaks have wider relevance
} as const;

export async function persistBatch(
  sourceId: string,
  items: RawAndNormalized[]
): Promise<IngestStats> {
  const stats: IngestStats = { fetched: items.length, inserted: 0, updated: 0, skipped: 0 };
  if (items.length === 0) return stats;

  await withTx(async (client) => {
    for (const item of items) {
      // 1. Upsert raw_events (returns the row's id whether new or existing)
      const rawRes = await client.query<{ id: string }>(
        `INSERT INTO raw_events (source_id, source_event_id, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (source_id, source_event_id) DO UPDATE
           SET payload = EXCLUDED.payload, fetched_at = NOW()
         RETURNING id`,
        [sourceId, item.sourceEventId, JSON.stringify(item.payload)]
      );
      const rawId = rawRes.rows[0]?.id;

      // 2. Find offices in proximity (PostGIS distance query)
      const n = item.normalized;
      const radiusForCategory =
        n.radiusKm ?? DEFAULT_PROXIMITY_KM[n.category] ?? 100;

      let officeIds: string[] = [];
      if (radiusForCategory > 0 && Number.isFinite(n.lat) && Number.isFinite(n.lng)) {
        const officeRes = await client.query<{ id: string }>(
          `SELECT id FROM offices
           WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
          [n.lng, n.lat, radiusForCategory * 1000]
        );
        officeIds = officeRes.rows.map((r) => r.id);
      }

      // 3. Upsert normalized event keyed on (primary_source_id, source_url, issued_at).
      //    For sources without a stable URL, fallback synthesizes one.
      const sourceUrl = n.sourceUrl ?? `urn:${sourceId}:${item.sourceEventId}`;
      const upsertRes = await client.query<{ id: string; was_new: boolean }>(
        `INSERT INTO events (
            title, summary, severity, category, type, location,
            lat, lng, radius_km, issued_at, expires_at,
            primary_source_id, contributing_sources, source_url,
            affected_office_ids, raw_event_id
         ) VALUES (
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
      if (upsertRes.rows[0]?.was_new) stats.inserted++;
      else stats.updated++;
    }
  });

  log.info(stats, `${sourceId}.persisted`);
  return stats;
}

export async function markSourceOk(sourceId: string): Promise<void> {
  const { pool } = await import('../db.js');
  await pool.query(
    `UPDATE sources SET last_ok_at = NOW(), last_error = NULL WHERE id = $1`,
    [sourceId]
  );
}
export async function markSourceError(sourceId: string, msg: string): Promise<void> {
  const { pool } = await import('../db.js');
  await pool.query(
    `UPDATE sources SET last_error_at = NOW(), last_error = $2 WHERE id = $1`,
    [sourceId, msg.slice(0, 500)]
  );
}
