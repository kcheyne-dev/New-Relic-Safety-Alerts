import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, type JwtPayload, type Role } from './jwt.js';

/** Augment Fastify's Request with our user shape. */
declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

/** Extract bearer token from Authorization header. */
function extractToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

/**
 * Hook that requires authentication. Add to a route or routes scope:
 *   app.addHook('preHandler', requireAuth);
 *
 * On success: req.user is populated.
 * On failure: 401 with json error.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    reply.code(401).send({ error: 'unauthorized', detail: 'missing bearer token' });
    return;
  }
  try {
    req.user = verifyToken(token);
  } catch (err) {
    reply.code(401).send({
      error: 'unauthorized',
      detail: err instanceof Error ? err.message : 'invalid token',
    });
    return;
  }
}

/**
 * Hook factory to require a minimum role. Roles in increasing privilege:
 *   employee < office < cmt < admin
 *
 * Usage:
 *   app.addHook('preHandler', requireRole('cmt'));
 */
const ROLE_RANK: Record<Role, number> = { employee: 1, office: 2, cmt: 3, admin: 4 };

export function requireRole(min: Role) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (ROLE_RANK[req.user.role] < ROLE_RANK[min]) {
      reply.code(403).send({ error: 'forbidden', detail: `role '${min}' required` });
      return;
    }
  };
}
