import bcrypt from 'bcrypt';

/** Cost factor for bcrypt. 12 ≈ 200ms per hash on modern hardware. */
const SALT_ROUNDS = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plaintext, hash);
}
