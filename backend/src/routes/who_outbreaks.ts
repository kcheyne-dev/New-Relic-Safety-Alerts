import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';

/** GET /api/who-outbreaks
 *
 * Returns active (non-stale) WHO Disease Outbreak News entries for the
 * Risk Profile modal's outbreak detail rows. Frontend caches per-session;
 * polling cadence is loose since WHO updates infrequently.
 *
 * Response shape:
 *   { outbreaks: Array<{ country, disease, severity, cases, since, link, summary }>,
 *     count: number }
 *
 * Schema mirrors WHO_OUTBREAKS_MOCK on the frontend so swap-in is data-only.
 */
export async function whoOutbreaksRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/who-outbreaks', async () => {
    const result = await query(
      `SELECT country, disease, severity, cases,
              issued_at::text AS since, link, summary
       FROM who_outbreaks
       WHERE NOT is_stale
       ORDER BY
         CASE severity WHEN 'ext' THEN 4 WHEN 'high' THEN 3 WHEN 'mod' THEN 2 ELSE 1 END DESC,
         issued_at DESC
       LIMIT 200`
    );
    const outbreaks = result.rows.map((r: any) => ({
      country:  r.country,
      disease:  r.disease,
      severity: r.severity,
      cases:    r.cases == null ? null : Number(r.cases),
      // Convert to YYYY-MM-DD for the frontend (matches WHO_OUTBREAKS_MOCK)
      since:    typeof r.since === 'string' ? r.since.slice(0, 10) : null,
      link:     r.link ?? null,
      summary:  r.summary ?? '',
    }));
    return { outbreaks, count: outbreaks.length };
  });
}
