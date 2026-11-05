import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { AuthTokens } from '../types/auth.types';

/**
 * Browser sessions keep the refresh token in an httpOnly cookie, so page scripts
 * (and any injected script) can never read it. The website opts in by sending
 * `X-Session-Scope`; the mobile app does not, and keeps receiving tokens in the body.
 *
 * The header doubles as CSRF protection: a cross-site form cannot set custom headers,
 * and a cross-site fetch that does triggers a CORS preflight, which only allowed
 * origins pass. The cookie is also scoped to /api/auth, so it never rides along on
 * any other API call.
 */
export const SESSION_SCOPES = ['admin', 'site'] as const;
export type SessionScope = (typeof SESSION_SCOPES)[number];

const COOKIE_PATH = '/api/auth';

export function sessionScope(req: Request): SessionScope | null {
  const value = req.headers['x-session-scope'];
  return typeof value === 'string' && (SESSION_SCOPES as readonly string[]).includes(value)
    ? (value as SessionScope)
    : null;
}

export function refreshCookieName(scope: SessionScope) {
  return `banjara_rt_${scope}`;
}

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: COOKIE_PATH,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function readRefreshCookie(req: Request, scope: SessionScope): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[refreshCookieName(scope)];
  return typeof value === 'string' && value ? value : undefined;
}

export function setRefreshCookie(res: Response, scope: SessionScope, refreshToken: string) {
  const exp = (jwt.decode(refreshToken) as { exp?: number } | null)?.exp;
  const maxAge = exp ? Math.max(0, exp * 1000 - Date.now()) : undefined;
  res.cookie(refreshCookieName(scope), refreshToken, { ...baseOptions(), maxAge });
}

export function clearRefreshCookie(res: Response, scope: SessionScope) {
  res.clearCookie(refreshCookieName(scope), baseOptions());
}

/**
 * For a browser session: set the cookie and drop the refresh token from the body.
 * For other clients: return the data unchanged.
 */
export function deliverTokens<T extends { tokens: AuthTokens }>(req: Request, res: Response, data: T) {
  const scope = sessionScope(req);
  if (!scope) return data;
  setRefreshCookie(res, scope, data.tokens.refreshToken);
  res.setHeader('Cache-Control', 'no-store');
  return { ...data, tokens: { accessToken: data.tokens.accessToken } };
}
