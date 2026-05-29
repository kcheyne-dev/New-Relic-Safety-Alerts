import { pool } from '../db.js';
import { log } from '../log.js';
import { notify } from '../notifications/webhook.js';

/**
 * Monitors source health and sends webhook notifications:
 *   - Fires "down" alert when a source hasn't had a successful fetch in >30 min
 *   - Fires "recovered" alert when it comes back
 *   - Throttled per source — won't spam the same notification on every check
 *
 * Uses the `source_alert_state` table to remember which sources we've already
 * notified about, so we don't fire on every 5-min sweep.
 */

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;       // every 5 minutes
const STALE_THRESHOLD_MIN = 30;

interface SourceRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  last_ok_at: Date | null;
  last_error: string | null;
  alerted_at: Date | null;
  recovered_at: Date | null;
}

async function checkOnce(): Promise<void> {
  const result = await pool.query<SourceRow>(`
    SELECT s.id, s.name, s.url, s.enabled, s.last_ok_at, s.last_error,
           a.alerted_at, a.recovered_at
    FROM sources s
    LEFT JOIN source_alert_state a ON a.source_id = s.id
    WHERE s.enabled = TRUE
  `);

  const now = Date.now();

  for (const s of result.rows) {
    const lastOkMs = s.last_ok_at ? new Date(s.last_ok_at).getTime() : 0;
    const ageMin = lastOkMs ? (now - lastOkMs) / 60000 : Infinity;
    const isDown = ageMin > STALE_THRESHOLD_MIN;
    const wasAlerted = !!s.alerted_at && (!s.recovered_at || s.alerted_at > s.recovered_at);

    if (isDown && !wasAlerted) {
      // Fire DOWN alert
      await notify({
        title: `📡 Source down: ${s.name}`,
        body: `No successful fetch in ${ageMin === Infinity ? 'ever' : Math.round(ageMin) + ' min'}. Last error: ${s.last_error ?? 'none recorded'}`,
        severity: 'warning',
        dedupKey: `source-down-${s.id}`,
      });
      await pool.query(
        `INSERT INTO source_alert_state (source_id, alerted_at)
         VALUES ($1, NOW())
         ON CONFLICT (source_id) DO UPDATE SET alerted_at = NOW()`,
        [s.id]
      );
      log.warn({ source: s.id, ageMin: Math.round(ageMin) }, 'source.down.notified');
    } else if (!isDown && wasAlerted) {
      // Fire RECOVERY alert
      await notify({
        title: `✓ Source recovered: ${s.name}`,
        body: `Last successful fetch: ${s.last_ok_at?.toString()}`,
        severity: 'info',
        dedupKey: `source-recovery-${s.id}`,
      });
      await pool.query(
        `UPDATE source_alert_state SET recovered_at = NOW() WHERE source_id = $1`,
        [s.id]
      );
      log.info({ source: s.id }, 'source.recovered.notified');
    }
  }
}

export function startHealthCheck(): void {
  log.info({ intervalMs: HEALTH_CHECK_INTERVAL_MS }, 'health_check.scheduled');
  setTimeout(() => checkOnce().catch((err) => log.error({ err }, 'health_check.failed')), 90 * 1000);
  setInterval(() => checkOnce().catch((err) => log.error({ err }, 'health_check.failed')), HEALTH_CHECK_INTERVAL_MS);
}
