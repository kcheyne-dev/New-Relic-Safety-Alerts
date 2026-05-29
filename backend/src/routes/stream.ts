import type { FastifyInstance } from 'fastify';
import { bus } from '../events_bus.js';
import { query } from '../db.js';
import { verifyToken } from '../auth/jwt.js';

/**
 * Server-Sent Events stream. Dashboard subscribes via:
 *   const es = new EventSource(`${API}/api/events/stream?token=${jwt}`);
 *   es.addEventListener('event', (e) => { const msg = JSON.parse(e.data); ... });
 *
 * AUTH: EventSource doesn't support custom headers, so the token is passed as
 * a query parameter (`?token=...`) instead of `Authorization: Bearer`. We
 * accept either; the header takes precedence when both are sent.
 *
 * Format: SSE 2.x. Each message has `event: event` and `data: {json}`.
 * The browser EventSource auto-reconnects on disconnect.
 */
export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/events/stream', async (req, reply) => {
    // 1. Auth — required. Accept token from header OR ?token= query.
    let token: string | null = null;
    const auth = req.headers.authorization;
    if (auth) {
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) token = m[1] ?? null;
    }
    if (!token && typeof (req.query as any)?.token === 'string') {
      token = String((req.query as any).token);
    }
    if (!token) {
      reply.code(401).send({ error: 'unauthorized', detail: 'missing token (use Authorization header or ?token=)' });
      return;
    }
    try {
      verifyToken(token);
    } catch (err) {
      reply.code(401).send({
        error: 'unauthorized',
        detail: err instanceof Error ? err.message : 'invalid token',
      });
      return;
    }

    // 2. Open the SSE channel.
    reply.raw.writeHead(200, {
      'Content-Type':                'text/event-stream',
      'Cache-Control':               'no-cache, no-transform',
      Connection:                    'keep-alive',
      'X-Accel-Buffering':           'no',                // hint to Nginx not to buffer
      'Access-Control-Allow-Origin': '*',
    });
    // Initial comment so the browser knows the connection is open
    reply.raw.write(': connected\n\n');

    // Per-connection subscriber. We hydrate "new" events from DB (the persist
    // pipeline only emits ids for inserts to keep the message small).
    const onEvent = async (msg: any) => {
      try {
        let payload = msg;
        if (msg?.kind === 'new' && msg.eventId) {
          const r = await query(
            `SELECT id, title, summary, severity, type, primary_source_id, location,
                    lat, lng, radius_km, issued_at, source_url, affected_office_ids, contributing_sources
             FROM events WHERE id = $1`,
            [msg.eventId]
          );
          if (r.rows[0]) {
            const e: any = r.rows[0];
            payload = {
              kind: 'new',
              event: {
                id: e.id,
                title: e.title,
                summary: e.summary ?? '',
                sev: e.severity,
                type: e.type ?? '',
                source: e.primary_source_id,
                location: e.location ?? '',
                lat: Number(e.lat),
                lng: Number(e.lng),
                radiusKm: e.radius_km == null ? null : Number(e.radius_km),
                issued: e.issued_at instanceof Date ? e.issued_at.toISOString() : String(e.issued_at),
                officeId: (e.affected_office_ids?.[0] ?? null) as string | null,
                affectedOfficeIds: (e.affected_office_ids ?? []) as string[],
                sourceUrl: e.source_url ?? null,
                contributingSources: (e.contributing_sources ?? []) as string[],
              },
            };
          }
        }
        reply.raw.write(`event: event\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch (err) {
        // Don't crash the stream on a single bad row
        app.log.warn({ err }, 'sse.write_failed');
      }
    };

    bus.on('event', onEvent);

    // Heartbeat every 25s so proxies don't kill the connection as idle
    const heartbeat = setInterval(() => {
      reply.raw.write(`: ping ${Date.now()}\n\n`);
    }, 25000);

    // Cleanup on disconnect
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      bus.off('event', onEvent);
    });

    // Keep the request open — Fastify will not auto-respond once we wrote headers
    return reply;
  });
}
