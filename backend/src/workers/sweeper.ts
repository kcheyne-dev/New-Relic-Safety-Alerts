import { pool } from '../db.js';
import { log } from '../log.js';
import { config } from '../config.js';

/**
 * Periodically marks events as `is_stale = true` once they've outlived their
 * usefulness. Stale events are filtered out of /api/events queries by default
 * but remain in the table for audit / replay.
 *
 * Rules (in priority order):
 *   1. expires_at set and past → stale immediately (e.g. tornado warnings end)
 *   2. NWS event with no expiry → stale 24h after issued_at (warnings are short-lived)
 *   3. Any non-travel event with issued_at older than `staleAfterDays`
 *      (default 7 days) → stale. This catches EONET/USGS/EMSC long-tail.
 *
 * Travel advisories are exempt (they're long-lived by nature — typically months).
 *
 * NOTE: We measure age from `issued_at` (when the event happened in the real world),
 *       not `created_at` (when we ingested it). The previous version used created_at,
 *       which meant freshly-ingested historical events stayed "fresh" for 24h.
 */

const SWEEPER_INTERVAL_MS = 30 * 60 * 1000;          // every 30 minutes

async function sweepOnce(): Promise<void> {
  const result = await pool.query<{ id: string }>(`
    UPDATE events SET is_stale = TRUE, updated_at = NOW()
    WHERE NOT is_stale
      AND category <> 'travel'
      AND (
        (expires_at IS NOT NULL AND expires_at < NOW())
        OR
        (primary_source_id = 'nws' AND expires_at IS NULL AND issued_at < NOW() - interval '24 hours')
        OR
        (issued_at < NOW() - interval '${config.quality.staleAfterDays} days')
      )
    RETURNING id
  `);
  if (result.rowCount && result.rowCount > 0) {
    log.info({ marked: result.rowCount }, 'sweeper.marked_stale');
  } else {
    log.debug('sweeper.no_stale');
  }
}

export function startSweeper(): void {
  log.info({ intervalMs: SWEEPER_INTERVAL_MS }, 'sweeper.scheduled');
  // Fire once after a short delay (let other things settle), then on interval
  setTimeout(() => sweepOnce().catch((err) => log.error({ err }, 'sweeper.failed')), 60 * 1000);
  setInterval(() => sweepOnce().catch((err) => log.error({ err }, 'sweeper.failed')), SWEEPER_INTERVAL_MS);
}
