import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import type { SourceHealth } from '../types.js';

export async function sourcesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sources/health', async () => {
    const result = await query(
      `SELECT id, name, kind, url, enabled, last_ok_at, last_error_at, last_error
       FROM sources ORDER BY id`
    );
    const sources: SourceHealth[] = result.rows.map((r: any) => {
      const lastOk = r.last_ok_at as Date | null;
      const ageMin = lastOk ? (Date.now() - new Date(lastOk).getTime()) / 60000 : Infinity;
      let status: SourceHealth['status'] = 'ok';
      if (!r.enabled) status = 'error';
      else if (r.last_error && (!lastOk || ageMin > 30)) status = 'error';
      else if (ageMin > 30) status = 'stale';

      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        url: r.url,
        enabled: r.enabled,
        status,
        lastOkAt: lastOk ? lastOk.toISOString() : null,
        lastErrorAt: r.last_error_at instanceof Date ? r.last_error_at.toISOString() : null,
        lastError: r.last_error ?? null,
      };
    });
    return { sources };
  });
}
