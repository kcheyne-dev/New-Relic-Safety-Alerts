import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTx } from '../db.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { audit } from '../audit/log.js';

const createSchema = z.object({
  title:       z.string().min(1).max(500),
  description: z.string().optional(),
  severity:    z.enum(['low','mod','high','ext']),
  offices:     z.array(z.string()).default([]),
  alertId:     z.string().uuid().optional(),
});
const closeSchema = z.object({
  closureNote: z.string().optional(),
});
const messageSchema = z.object({
  template:         z.string().optional(),
  templateName:     z.string().optional(),
  subject:          z.string().optional(),
  body:             z.string().min(1),
  channels:         z.array(z.enum(['slack','email','sms'])).default([]),
  offices:          z.array(z.string()).default([]),
  recipientsCount:  z.number().int().nonnegative().default(0),
  responseRequired: z.boolean().default(false),
  reminderInterval: z.string().optional(),
  attachments:      z.array(z.any()).default([]),
});
const responseSchema = z.object({
  status:       z.enum(['no','ok','help']),
  employeeName: z.string().optional(),
  officeId:     z.string().optional(),
  isTraveler:   z.boolean().default(false),
});
const noteSchema = z.object({
  body:        z.string().min(1),
  attachments: z.array(z.any()).default([]),
});

/** Returns true if the incident with this id exists. Used to 404 cleanly
 *  before attempting sub-resource inserts (which would otherwise blow up
 *  on a foreign-key violation). */
async function incidentExists(id: string): Promise<boolean> {
  const r = await query<{ id: string }>(`SELECT id FROM incidents WHERE id = $1`, [id]);
  return r.rows.length > 0;
}

export async function incidentRoutes(app: FastifyInstance): Promise<void> {
  // All incident routes require authentication.
  app.addHook('preHandler', requireAuth);

  // -------------------- LIST --------------------
  app.get('/api/incidents', async (req) => {
    const status = (req.query as any)?.status as string | undefined;
    const params: unknown[] = [];
    let where = '';
    if (status === 'open' || status === 'closed') {
      params.push(status);
      where = `WHERE status = $1`;
    }
    const result = await query(
      `SELECT * FROM incidents ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    return { incidents: result.rows };
  });

  // -------------------- CREATE (CMT+) --------------------
  app.post('/api/incidents', { preHandler: requireRole('cmt') }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: 'invalid_body', detail: parsed.error.flatten() }; }
    const c = parsed.data;
    const result = await query<{ id: string }>(
      `INSERT INTO incidents (title, description, severity, offices, alert_id, created_by_user_id)
       VALUES ($1, $2, $3, $4::text[], $5, $6)
       RETURNING *`,
      [c.title, c.description ?? '', c.severity, c.offices, c.alertId ?? null, req.user!.sub]
    );
    const inc = result.rows[0]!;
    await query(
      `INSERT INTO incident_log (incident_id, kind, body, by_user_id) VALUES ($1, 'create', $2, $3)`,
      [(inc as any).id, `Incident "${c.title}" opened.`, req.user!.sub]
    );
    await audit(req, { action: 'incident.create', targetType: 'incident', targetId: (inc as any).id, payload: c });
    return { incident: inc };
  });

  // -------------------- DETAIL (with all sub-resources) --------------------
  app.get<{ Params: { id: string } }>('/api/incidents/:id', async (req, reply) => {
    const id = req.params.id;
    const inc = await query(`SELECT * FROM incidents WHERE id = $1`, [id]);
    if (!inc.rows[0]) { reply.code(404); return { error: 'not_found' }; }
    const [messages, responses, notes, logRows] = await Promise.all([
      query(`SELECT * FROM crisis_messages WHERE incident_id = $1 ORDER BY sent_at`, [id]),
      query(`SELECT * FROM responses WHERE incident_id = $1`, [id]),
      query(`SELECT * FROM incident_notes WHERE incident_id = $1 ORDER BY added_at DESC`, [id]),
      query(`SELECT * FROM incident_log WHERE incident_id = $1 ORDER BY at`, [id]),
    ]);
    return {
      incident: inc.rows[0],
      messages: messages.rows,
      responses: responses.rows,
      notes: notes.rows,
      log: logRows.rows,
    };
  });

  // -------------------- CLOSE --------------------
  app.post<{ Params: { id: string } }>('/api/incidents/:id/close',
    { preHandler: requireRole('cmt') },
    async (req, reply) => {
      const id = req.params.id;
      const parsed = closeSchema.safeParse(req.body ?? {});
      const note = parsed.success ? parsed.data.closureNote ?? null : null;
      const r = await query(
        `UPDATE incidents SET status='closed', closed_note=$2, closed_at=NOW() WHERE id=$1 RETURNING id`,
        [id, note]
      );
      if (!r.rows[0]) { reply.code(404); return { error: 'not_found' }; }
      await query(
        `INSERT INTO incident_log (incident_id, kind, body, by_user_id) VALUES ($1,'close',$2,$3)`,
        [id, `Incident closed. ${note ?? ''}`.trim(), req.user!.sub]
      );
      await audit(req, { action: 'incident.close', targetType: 'incident', targetId: id, payload: { note } });
      return { ok: true };
    }
  );

  // -------------------- REOPEN --------------------
  app.post<{ Params: { id: string } }>('/api/incidents/:id/reopen',
    { preHandler: requireRole('cmt') },
    async (req, reply) => {
      const id = req.params.id;
      const r = await query(
        `UPDATE incidents
         SET status='open', closed_at=NULL,
             reopens = reopens || jsonb_build_array(jsonb_build_object('when', NOW(), 'by_user_id', $2::text))
         WHERE id=$1 RETURNING id`,
        [id, req.user!.sub]
      );
      if (!r.rows[0]) { reply.code(404); return { error: 'not_found' }; }
      await query(
        `INSERT INTO incident_log (incident_id, kind, body, by_user_id) VALUES ($1,'reopen','Incident reopened.',$2)`,
        [id, req.user!.sub]
      );
      await audit(req, { action: 'incident.reopen', targetType: 'incident', targetId: id });
      return { ok: true };
    }
  );

  // -------------------- SEND CRISIS MESSAGE --------------------
  app.post<{ Params: { id: string } }>('/api/incidents/:id/messages',
    { preHandler: requireRole('cmt') },
    async (req, reply) => {
      const id = req.params.id;
      if (!(await incidentExists(id))) { reply.code(404); return { error: 'not_found' }; }
      const parsed = messageSchema.safeParse(req.body);
      if (!parsed.success) { reply.code(400); return { error: 'invalid_body', detail: parsed.error.flatten() }; }
      const m = parsed.data;
      const result = await withTx(async (client) => {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO crisis_messages (
              incident_id, sent_by_user_id, template, template_name, subject, body,
              channels, offices, recipients_count, response_required, reminder_interval, attachments
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8::text[],$9,$10,$11,$12::jsonb)
           RETURNING id`,
          [id, req.user!.sub, m.template ?? null, m.templateName ?? null, m.subject ?? null, m.body,
           m.channels, m.offices, m.recipientsCount, m.responseRequired, m.reminderInterval ?? null, JSON.stringify(m.attachments)]
        );
        await client.query(
          `INSERT INTO incident_log (incident_id, kind, body, by_user_id) VALUES ($1,'comm',$2,$3)`,
          [id, `Sent <b>${m.templateName ?? 'Custom'}</b> via ${m.channels.join(', ')} to ${m.recipientsCount} recipients.`, req.user!.sub]
        );
        return ins.rows[0]!.id;
      });
      await audit(req, { action: 'message.send', targetType: 'message', targetId: result, payload: { incidentId: id, recipientsCount: m.recipientsCount, channels: m.channels } });
      return { messageId: result };
    }
  );

  // -------------------- UPDATE PER-EMPLOYEE RESPONSE --------------------
  app.put<{ Params: { id: string; employeeId: string } }>(
    '/api/incidents/:id/responses/:employeeId',
    { preHandler: requireRole('office') },     // Office Manager + CMT + Admin can log responses
    async (req, reply) => {
      const { id, employeeId } = req.params;
      if (!(await incidentExists(id))) { reply.code(404); return { error: 'not_found' }; }
      const parsed = responseSchema.safeParse(req.body);
      if (!parsed.success) { reply.code(400); return { error: 'invalid_body', detail: parsed.error.flatten() }; }
      const r = parsed.data;
      await query(
        `INSERT INTO responses (incident_id, employee_id, employee_name, office_id, is_traveler, status, status_set_at, status_set_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)
         ON CONFLICT (incident_id, employee_id) DO UPDATE SET
            status = EXCLUDED.status,
            status_set_at = NOW(),
            status_set_by_user_id = EXCLUDED.status_set_by_user_id,
            employee_name = COALESCE(EXCLUDED.employee_name, responses.employee_name),
            office_id     = COALESCE(EXCLUDED.office_id,     responses.office_id),
            is_traveler   = EXCLUDED.is_traveler`,
        [id, employeeId, r.employeeName ?? null, r.officeId ?? null, r.isTraveler, r.status, req.user!.sub]
      );
      await query(
        `INSERT INTO incident_log (incident_id, kind, body, by_user_id) VALUES ($1,'msg',$2,$3)`,
        [id, `Status logged for <b>${employeeId}</b>: ${r.status}`, req.user!.sub]
      );
      await audit(req, { action: 'response.update', targetType: 'response', targetId: `${id}/${employeeId}`, payload: { status: r.status } });
      return { ok: true };
    }
  );

  // -------------------- ADD NOTE --------------------
  app.post<{ Params: { id: string } }>('/api/incidents/:id/notes',
    async (req, reply) => {
      const id = req.params.id;
      if (!(await incidentExists(id))) { reply.code(404); return { error: 'not_found' }; }
      const parsed = noteSchema.safeParse(req.body);
      if (!parsed.success) { reply.code(400); return { error: 'invalid_body', detail: parsed.error.flatten() }; }
      const n = parsed.data;
      const result = await query<{ id: string }>(
        `INSERT INTO incident_notes (incident_id, body, attachments, added_by_user_id)
         VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
        [id, n.body, JSON.stringify(n.attachments), req.user!.sub]
      );
      await query(
        `INSERT INTO incident_log (incident_id, kind, body, by_user_id) VALUES ($1,'note',$2,$3)`,
        [id, `Note added: ${n.body.slice(0, 80)}${n.body.length > 80 ? '…' : ''}`, req.user!.sub]
      );
      await audit(req, { action: 'note.create', targetType: 'note', targetId: result.rows[0]?.id ?? null });
      return { noteId: result.rows[0]?.id };
    }
  );
}
