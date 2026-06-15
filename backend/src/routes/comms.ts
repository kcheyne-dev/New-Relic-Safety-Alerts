import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { audit } from '../audit/log.js';

/**
 * Standalone Crisis Communications messages — sent from the Compose tab
 * without linking to a specific incident.
 *
 * Persisted into the same `crisis_messages` table used for incident-linked
 * messages (the schema already allows NULL incident_id), so the data layer
 * stays unified. The API split is just for routing clarity:
 *   - /api/incidents/:id/messages   →  incident-linked
 *   - /api/comms                    →  standalone
 *
 * The frontend's Crisis Comms Log tab can show all messages by querying
 * GET /api/comms with no filters; or just the standalone ones via
 * ?incidentId=null.
 */

const sendSchema = z.object({
  template:         z.string().optional(),
  templateName:     z.string().optional(),
  subject:          z.string().optional(),
  body:             z.string().min(1),
  channels:         z.array(z.enum(['slack', 'email', 'sms'])).default([]),
  offices:          z.array(z.string()).default([]),
  recipientsCount:  z.number().int().nonnegative().default(0),
  responseRequired: z.boolean().default(false),
  reminderInterval: z.string().optional(),
  attachments:      z.array(z.any()).default([]),
});

export async function commsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // -------------------- LIST --------------------
  // Query params:
  //   incidentId=null   →  only standalone messages (no incident link)
  //   incidentId=<uuid> →  messages linked to that incident
  //   (omit)            →  all messages, newest first, limit 200
  app.get('/api/comms', async (req) => {
    const incidentIdRaw = (req.query as any)?.incidentId as string | undefined;
    let where = '';
    const params: unknown[] = [];

    if (incidentIdRaw === 'null') {
      where = `WHERE incident_id IS NULL`;
    } else if (incidentIdRaw) {
      params.push(incidentIdRaw);
      where = `WHERE incident_id = $1`;
    }

    const result = await query(
      `SELECT * FROM crisis_messages ${where} ORDER BY sent_at DESC LIMIT 200`,
      params
    );
    return { messages: result.rows };
  });

  // -------------------- SEND STANDALONE --------------------
  app.post('/api/comms', { preHandler: requireRole('cmt') }, async (req, reply) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_body', detail: parsed.error.flatten() };
    }
    const m = parsed.data;
    const result = await query<{ id: string }>(
      `INSERT INTO crisis_messages (
          incident_id, sent_by_user_id, template, template_name, subject, body,
          channels, offices, recipients_count, response_required,
          reminder_interval, attachments
       ) VALUES (NULL, $1, $2, $3, $4, $5, $6::text[], $7::text[], $8, $9, $10, $11::jsonb)
       RETURNING id`,
      [
        req.user!.sub,
        m.template ?? null,
        m.templateName ?? null,
        m.subject ?? null,
        m.body,
        m.channels,
        m.offices,
        m.recipientsCount,
        m.responseRequired,
        m.reminderInterval ?? null,
        JSON.stringify(m.attachments),
      ]
    );
    const messageId = result.rows[0]?.id ?? null;
    await audit(req, {
      action:     'comms.send',
      targetType: 'message',
      targetId:   messageId,
      payload:    { recipientsCount: m.recipientsCount, channels: m.channels, offices: m.offices },
    });
    return { messageId };
  });
}
