import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Delete Postgres rows this smoke run created, scoped to the specific
 * RUN_ID passed in. Called from spec-level `test.afterAll` hooks so each
 * run cleans up its own artifacts. Prevents the "75 open incidents"
 * accumulation issue observed 2026-07-13 after ~8 test runs in one day.
 *
 * Match patterns (mirror scripts/cleanup-smoke-incidents.sql):
 *   (a) title LIKE '<RUN_ID> %'         — BCI declaration incidents
 *   (b) crisis_messages.body LIKE       — real-send + test-send incidents
 *       '%<RUN_ID>%'                      (tagged in the message body)
 *
 * Scoped to ONE run's RUN_ID so a failed prior run's artifacts aren't
 * accidentally cleaned up mid-flight (there's a separate manual cleanup
 * script for that). Idempotent — deleting zero rows is a no-op.
 *
 * Failure mode: if psql isn't available, or DB is down, we log a warning
 * and swallow the error rather than fail the test. Cleanup is
 * best-effort; the manual `npm run cleanup` script is the fallback.
 *
 * Env: DATABASE_URL — defaults to the local dev DB. Override to point
 * at a different instance if the tests run against a shared backend.
 */
export async function cleanupRunId(runId: string): Promise<void> {
  if (!runId) return;
  const db = process.env.DATABASE_URL || 'postgres://nrsa:nrsa@localhost:5432/nrsa';

  // Strict-shape guard on runId. Every current caller sets
  // `${prefix}-${Date.now()}` (prefix is 'smoke' or 'outbox'), so runIds
  // are always [A-Za-z]+-[0-9]+. If a future spec passes a runId with
  // '%' or '_' or '\', those act as SQL LIKE wildcards and would OVER-
  // delete. Fail loud instead of silently over-matching.
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(runId)) {
    // eslint-disable-next-line no-console
    console.warn(`⚠ afterAll cleanup skipped: runId '${runId}' contains chars outside [A-Za-z0-9-]. Add explicit escaping if you need them.`);
    return;
  }

  // Two-step delete matching scripts/cleanup-smoke-incidents.sql's logic
  // plus a standalone-messages sweep for specs (e.g. outbox.spec.ts)
  // that post directly to /api/comms with responseRequired=false —
  // those crisis_messages rows have incident_id IS NULL and won't cascade
  // from any incident delete.
  //
  //   1. Delete standalone crisis_messages tagged with this runId.
  //   2. Delete incidents whose title or child-message body carries the
  //      runId. ON DELETE CASCADE on crisis_messages / responses / notes /
  //      log_entries handles children.
  //
  // psql -c doesn't parameterize; embed the (now validated) runId as a
  // literal. Order matters: standalone message delete first, then incident
  // delete — the incident delete cascades to child messages, so if we
  // reversed the order, the cascade would already have taken any parented
  // messages with the runId in body, leaving just standalones for step 1
  // (still correct, just an ordering nit).
  const sql = `
    DELETE FROM crisis_messages
     WHERE incident_id IS NULL
       AND body LIKE '%${runId}%';

    DELETE FROM incidents
     WHERE title LIKE '${runId} %'
        OR id IN (
             SELECT DISTINCT incident_id
               FROM crisis_messages
              WHERE incident_id IS NOT NULL
                AND body LIKE '%${runId}%'
           );
  `;

  try {
    const { stdout, stderr } = await execFileAsync('psql', [db, '-c', sql, '-tA'], {
      timeout: 15_000,
    });
    // -tA gives us "DELETE N" on stdout. Log it for the smoke output so
    // operators can see cleanup happened.
    const trimmed = (stdout || '').trim();
    if (trimmed) {
      // eslint-disable-next-line no-console
      console.log(`✓ afterAll cleanup: ${trimmed} for RUN_ID=${runId}`);
    }
    if (stderr) {
      // eslint-disable-next-line no-console
      console.warn(`  psql stderr: ${stderr.trim()}`);
    }
  } catch (err) {
    // Best-effort cleanup — don't fail the test if psql isn't reachable.
    // Operator can always run `npm run cleanup` manually.
    // eslint-disable-next-line no-console
    console.warn(`⚠ afterAll cleanup skipped (psql failed): ${(err as Error).message}`);
    console.warn(`  Manual cleanup: cd tests && npm run cleanup`);
  }
}
