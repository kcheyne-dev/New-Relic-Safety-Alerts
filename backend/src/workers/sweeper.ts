import { pool } from '../db.js';
import { log } from '../log.js';

/**
 * Periodically marks events as `is_stale = true` once they've outlived their
 * usefulness. Stale events are filtered out of /api/events queries by default
 * but remain in the table for audit / replay.
 *
 * Rules:
 *   - If `expires_at` is set and now() > expires_at  → stale immediately
 *   - Otherwise, default 24h after `created_at`     → stale
 *
 * Travel advisories are exempt (they're long-lived by nature).
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
        (expires_at IS NULL AND created_at < NOW() - interval '24 hours')
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
