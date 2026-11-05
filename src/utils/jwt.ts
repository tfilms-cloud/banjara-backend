import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { AuthTokens, JwtPayload } from '../types/auth.types';

// Pin the algorithm on both sides so a token can never pick its own (e.g. `none`
// or an asymmetric alg confused with our HMAC secret).
const ALGORITHM = 'HS256' as const;

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    algorithm: ALGORITHM,
    // Unique per token, so two refresh tokens issued in the same second never collide.
    jwtid: randomUUID(),
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function signTokenPair(payload: JwtPayload): AuthTokens {
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALGORITHM] }) as JwtPayload;
}

/**
 * Proof that a password was correct, waiting for the 2-step code. Its own key and
 * audience mean it can never pass as an access or refresh token.
 */
const MFA_AUDIENCE = 'banjara-mfa';
function mfaKey() {
  return `${env.JWT_ACCESS_SECRET}:mfa-pending`;
}

export function signMfaToken(userId: string): string {
  return jwt.sign({ sub: userId }, mfaKey(), { algorithm: ALGORITHM, audience: MFA_AUDIENCE, expiresIn: '5m' });
}

export function verifyMfaToken(token: string): { sub: string } {
  return jwt.verify(token, mfaKey(), { algorithms: [ALGORITHM], audience: MFA_AUDIENCE }) as { sub: string };
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: [ALGORITHM] }) as JwtPayload;
}
