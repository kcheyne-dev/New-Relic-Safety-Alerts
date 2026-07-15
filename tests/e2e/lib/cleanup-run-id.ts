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

  // Same match logic as scripts/cleanup-smoke-incidents.sql, scoped to
  // this run's RUN_ID. Cascade delete via ON DELETE CASCADE on
  // crisis_messages / responses / notes / log_entries handles children.
  //
  // We embed the runId into the SQL as a literal because psql -c doesn't
  // parameterize. runId is derived from Date.now() in each spec so it's
  // always a numeric-suffix string — no SQL-injection surface from
  // untrusted input. Defensively strip any single-quote to be safe.
  const safeId = runId.replace(/'/g, '');

  const sql = `
    DELETE FROM incidents
     WHERE title LIKE '${safeId} %'
        OR id IN (
             SELECT DISTINCT incident_id
               FROM crisis_messages
              WHERE incident_id IS NOT NULL
                AND body LIKE '%${safeId}%'
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
