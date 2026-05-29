import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * JWT issuance + verification.
 *
 * In Sprint 5 we issue our own tokens (signed with JWT_SECRET).
 * When you migrate to Okta, set OKTA_ISSUER / OKTA_AUDIENCE / OKTA_JWKS_URI in
 * `.env`. The verifier then switches to verifying Okta-signed tokens via JWKS.
 * The token claim shape stays identical, so the rest of the codebase doesn't change.
 */

export type Role = 'admin' | 'cmt' | 'office' | 'employee';

export interface AuthClaims {
  sub: string;     // user id (uuid)
  email: string;
  name: string;
  role: Role;
}

export interface JwtPayload extends AuthClaims {
  iat: number;
  exp: number;
}

/** Sign a JWT for the given user. Used by the login endpoint. */
export function signToken(claims: AuthClaims): string {
  return jwt.sign(claims, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    issuer: 'nr-safety-alerts',
  });
}

/**
 * Verify a token and return its claims. Throws on invalid/expired.
 *
 * If Okta config is set, this should switch to JWKS-based verification —
 * left as a single-function swap-in. We document it in the README.
 */
export function verifyToken(token: string): JwtPayload {
  if (config.auth.oktaIssuer && config.auth.oktaJwksUri) {
    // Production swap point — wire `jwks-rsa` here when you flip on Okta.
    // For now we treat this case as misconfigured and fail loudly.
    throw new Error('Okta JWKS verification not yet implemented — see auth/jwt.ts');
  }
  return jwt.verify(token, config.auth.jwtSecret, {
    issuer: 'nr-safety-alerts',
  }) as JwtPayload;
}
