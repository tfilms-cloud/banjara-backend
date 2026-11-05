import { NextFunction, Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as authService from '../services/auth.service';
import * as mfaService from '../services/mfa.service';
import * as sessionService from '../services/session.service';
import type { SessionContext } from '../types/auth.types';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { verifyAccessToken } from '../utils/jwt';
import { clearRefreshCookie, deliverTokens, readRefreshCookie, sessionScope } from '../utils/authCookie';

/** Which device is signing in, recorded on its session. */
function sessionContext(req: Request): SessionContext {
  const scope = sessionScope(req);
  const ua = req.headers['user-agent'];
  return {
    client: scope === 'admin' ? 'web-admin' : scope === 'site' ? 'web-site' : 'mobile',
    userAgent: typeof ua === 'string' ? ua : undefined,
    ip: req.ip,
  };
}

/** Refresh token from the body (mobile, one-time web migration) or the cookie (web). */
function presentedRefreshToken(req: Request): string | undefined {
  const scope = sessionScope(req);
  const fromBody = req.body?.refreshToken as string | undefined;
  return fromBody ?? (scope ? readRefreshCookie(req, scope) : undefined);
}

export async function register(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await authService.register(req.body, sessionContext(req));
    return sendSuccess(res, deliverTokens(req, res, data), 'Registered successfully', 201);
  } catch (error) {
    next(error);
  }
}

export async function login(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await authService.login(req.body, sessionContext(req));
    if ('mfaRequired' in data) {
      // No session yet: the client asks for the 2-step code and calls /login/2fa.
      return sendSuccess(res, data, 'Enter your 2-step verification code');
    }
    return sendSuccess(res, deliverTokens(req, res, data), 'Logged in successfully');
  } catch (error) {
    next(error);
  }
}

export async function loginMfa(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await authService.completeMfaLogin(req.body.mfaToken, req.body.code, sessionContext(req));
    return sendSuccess(res, deliverTokens(req, res, data), 'Logged in successfully');
  } catch (error) {
    next(error);
  }
}

function auditMeta(req: Request) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : undefined };
}

export async function twoFactorStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await mfaService.status(req.user!.id));
  } catch (error) {
    next(error);
  }
}

export async function twoFactorSetup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    return sendSuccess(res, await mfaService.beginSetup(req.user!.id));
  } catch (error) {
    next(error);
  }
}

export async function twoFactorEnable(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const data = await mfaService.enable(req.user!.id, req.body.code, auditMeta(req));
    return sendSuccess(res, data, '2-step verification is on');
  } catch (error) {
    next(error);
  }
}

export async function twoFactorDisable(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await mfaService.disable(req.user!.id, req.body.password, req.body.code, auditMeta(req));
    return sendSuccess(res, data, '2-step verification is off');
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: AuthRequest, res: Response, next: NextFunction) {
  const scope = sessionScope(req);
  try {
    const token = presentedRefreshToken(req);
    if (!token) throw new AppError('Not signed in', 401);
    const data = await authService.refresh(token, sessionContext(req));
    return sendSuccess(res, deliverTokens(req, res, data), 'Token refreshed');
  } catch (error) {
    // Drop the cookie only when the token itself is bad, never on a server/database
    // error, or a brief outage would sign everyone out.
    const name = (error as { name?: string })?.name;
    const invalidToken =
      (error instanceof AppError && error.statusCode === 401) ||
      name === 'JsonWebTokenError' ||
      name === 'TokenExpiredError';
    if (scope && invalidToken) clearRefreshCookie(res, scope);
    next(error);
  }
}

/**
 * Ends this device's session. It must work even when the access token has already
 * expired, otherwise a browser could be left holding a live refresh cookie, so the
 * session is identified from the access token if valid, else from the refresh token.
 */
export async function logout(req: AuthRequest, res: Response, next: NextFunction) {
  const scope = sessionScope(req);
  try {
    let who: { userId: string; sessionId?: string } | null = null;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = verifyAccessToken(header.slice(7));
        who = { userId: payload.sub, sessionId: payload.sid };
      } catch {
        // expired or invalid: fall through to the refresh token
      }
    }
    const refreshToken = presentedRefreshToken(req);
    if (!who && refreshToken) who = await authService.identifyRefreshToken(refreshToken);
    if (!who && !scope) throw new AppError('Authentication required', 401);
    if (who) await authService.logout(who.sessionId, who.userId);
    if (scope) clearRefreshCookie(res, scope);
    return sendSuccess(res, null, 'Logged out');
  } catch (error) {
    next(error);
  }
}

/** Ends every session of the signed-in user, this one included. */
export async function logoutAll(req: AuthRequest, res: Response, next: NextFunction) {
  const scope = sessionScope(req);
  try {
    const data = await authService.logoutAll(req.user!.id);
    if (scope) clearRefreshCookie(res, scope);
    return sendSuccess(res, data, 'Signed out on all devices');
  } catch (error) {
    next(error);
  }
}

export async function listSessions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await sessionService.listSessions(req.user!.id, req.user!.sessionId));
  } catch (error) {
    next(error);
  }
}

/** Signs out one of the user's own devices. */
export async function revokeSession(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id);
    const revoked = await sessionService.revokeSession(id, 'revoked', req.user!.id);
    if (!revoked) throw new AppError('Session not found', 404);
    return sendSuccess(res, { id, current: id === req.user!.sessionId }, 'Device signed out');
  } catch (error) {
    next(error);
  }
}

export async function me(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await authService.me(req.user!.id);
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await authService.forgotPassword(req.body.email);
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await authService.resetPassword(req.body.email, req.body.code, req.body.newPassword);
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}
