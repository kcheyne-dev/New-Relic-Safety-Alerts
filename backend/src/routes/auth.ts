import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { verifyPassword } from '../auth/passwords.js';
import { signToken, type Role } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';
import { audit } from '../audit/log.js';

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  role: Role;
  enabled: boolean;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_body', detail: parsed.error.flatten() };
    }
    const { email, password } = parsed.data;

    const result = await query<UserRow>(
      `SELECT id, email, name, password_hash, role, enabled FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !user.enabled || !user.password_hash) {
      reply.code(401);
      return { error: 'invalid_credentials' };
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      reply.code(401);
      return { error: 'invalid_credentials' };
    }

    await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

    const token = signToken({ sub: user.id, email: user.email, name: user.name, role: user.role });

    await audit(req, { action: 'login', targetType: 'user', targetId: user.id });

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  });

  // Returns the current user's profile from their token. Useful for the
  // dashboard to display "Logged in as" without re-fetching.
  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    return { user: req.user };
  });
}
