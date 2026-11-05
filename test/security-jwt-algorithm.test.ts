import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { signTokenPair, verifyAccessToken, verifyRefreshToken } from '../src/utils/jwt';

const payload = { sub: '507f1f77bcf86cd799439011', role: 'customer' as const, email: 'a@b.co' };

function unsigned(body: object) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(body)}.`;
}

describe('Security — JWT algorithm is pinned to HS256', () => {
  it('issues HS256 tokens that verify', () => {
    const { accessToken, refreshToken } = signTokenPair(payload);
    expect(jwt.decode(accessToken, { complete: true })?.header.alg).toBe('HS256');
    expect(verifyAccessToken(accessToken).sub).toBe(payload.sub);
    expect(verifyRefreshToken(refreshToken).sub).toBe(payload.sub);
  });

  it('rejects a token signed with the right secret but another HMAC algorithm', () => {
    const forged = jwt.sign(payload, env.JWT_ACCESS_SECRET, { algorithm: 'HS512' });
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it('rejects an unsigned (alg: none) token', () => {
    expect(() => verifyAccessToken(unsigned({ ...payload, role: 'admin' }))).toThrow();
  });

  it('does not accept an access token as a refresh token', () => {
    const { accessToken } = signTokenPair(payload);
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });
});
