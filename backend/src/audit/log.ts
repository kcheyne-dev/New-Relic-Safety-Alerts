import type { FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import { log } from '../log.js';

/**
 * Append-only audit log. Every authenticated mutation should call audit().
 * Failures are logged but never thrown — the audit log isn't allowed to break
 * the user's request.
 *
 * For SOC2 / similar compliance, you'd add: write also to an external log sink
 * (e.g. CloudWatch, Datadog), retain for N years, etc.
 */
export interface AuditEntry {
  action:      string;                 // 'incident.create', 'message.send', 'login', 'response.update'
  targetType?: string;                 // 'incident' | 'message' | 'user' | 'response' | 'note'
  targetId?:   string;
  payload?:    unknown;                // anything JSON-serializable; will be stringified
}

export async function audit(req: FastifyRequest, entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, action, target_type, target_id, ip, user_agent, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user?.sub ?? null,
        entry.action,
        entry.targetType ?? null,
        entry.targetId ?? null,
        req.ip ?? null,
        req.headers['user-agent']?.toString().slice(0, 500) ?? null,
        entry.payload ? JSON.stringify(entry.payload) : null,
      ]
    );
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'audit.write_failed');
  }
}
