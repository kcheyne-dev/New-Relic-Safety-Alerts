import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import type { ApiEvent } from '../types.js';

const listQuerySchema = z.object({
  since:     z.string().datetime().optional(),
  minSev:    z.enum(['low', 'mod', 'high', 'ext']).optional(),
  officeIds: z.string().optional(),     // comma-separated
  limit:     z.coerce.number().min(1).max(500).default(100),
});

// Severity rank for the SQL "minSev" filter
const SEV_RANK = { low: 1, mod: 2, high: 3, ext: 4 } as const;

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/events', async (req, reply) => {
    const parse = listQuerySchema.safeParse(req.query);
    if (!parse.success) {
      reply.code(400);
      return { error: 'invalid_query', detail: parse.error.flatten() };
    }
    const q = parse.data;
    const params: unknown[] = [];
    // NOT is_stale handles age-based pruning; expires_at hides NWS/State-Dept
    // events past their published expiry (e.g., a tornado warning that ended).
    const where: string[] = [
      'NOT is_stale',
      '(expires_at IS NULL OR expires_at > now())',
    ];

    if (q.since) {
      params.push(q.since);
      where.push(`issued_at >= $${params.length}`);
    }
    if (q.minSev) {
      // We use the textual severity; ranking is handled client-side via SEV_RANK,
      // but we filter here using a simple inclusive set.
      const allowed = (Object.keys(SEV_RANK) as Array<keyof typeof SEV_RANK>)
        .filter((k) => SEV_RANK[k] >= SEV_RANK[q.minSev!]);
      params.push(allowed);
      where.push(`severity = ANY($${params.length}::text[])`);
    }
    if (q.officeIds) {
      const ids = q.officeIds.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        params.push(ids);
        where.push(`affected_office_ids && $${params.length}::text[]`);
      }
    }
    params.push(q.limit);

    const sql = `
      SELECT id, title, summary, severity, type, category, primary_source_id,
             location, lat, lng, radius_km, issued_at, source_url,
             affected_office_ids, contributing_sources
      FROM events
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE severity WHEN 'ext' THEN 4 WHEN 'high' THEN 3 WHEN 'mod' THEN 2 ELSE 1 END DESC,
        issued_at DESC
      LIMIT $${params.length}
    `;

    const result = await query(sql, params);
    const events: ApiEvent[] = result.rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      summary: r.summary ?? '',
      sev: r.severity,
      type: r.type ?? '',
      category: r.category ?? '',
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
    }));

    return { events, count: events.length };
  });

  app.get<{ Params: { id: string } }>('/api/events/:id', async (req, reply) => {
    const result = await query(
      `SELECT * FROM events WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return result.rows[0];
  });
}
