/**
 * CLI to create or update a user.
 *
 * Usage:
 *   npm run create-user -- --email=admin@newrelic.com --password=ChangeMe123! --role=admin --name="Admin User"
 *
 * Roles: admin | cmt | office | employee
 */
import { pool } from '../db.js';
import { hashPassword } from '../auth/passwords.js';

interface Args {
  email?:    string;
  password?: string;
  role?:     'admin' | 'cmt' | 'office' | 'employee';
  name?:     string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const arg of argv) {
    const m = arg.match(/^--(email|password|role|name)=(.+)$/);
    if (!m) continue;
    const [, k, v] = m;
    (out as any)[k!] = v;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email || !args.password || !args.role) {
    console.error('Usage: npm run create-user -- --email=<email> --password=<pw> --role=<admin|cmt|office|employee> [--name="Name"]');
    process.exit(1);
  }
  const validRoles = ['admin', 'cmt', 'office', 'employee'] as const;
  if (!validRoles.includes(args.role as any)) {
    console.error(`Invalid role. Use one of: ${validRoles.join(', ')}`);
    process.exit(1);
  }
  const hash = await hashPassword(args.password);
  const name = args.name ?? args.email.split('@')[0];
  await pool.query(
    `INSERT INTO users (email, name, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        role          = EXCLUDED.role,
        name          = EXCLUDED.name,
        enabled       = TRUE`,
    [args.email, name, hash, args.role]
  );
  console.log(`✓ user upserted: ${args.email} (${args.role})`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
