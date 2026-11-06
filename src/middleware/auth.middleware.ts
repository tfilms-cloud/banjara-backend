import { NextFunction, Request, Response } from 'express';
import { User } from '../models/User';
import { ProviderProfile } from '../models/ProviderProfile';
import type { UserRole } from '../types/auth.types';
import { AppError } from '../utils/AppError';
import { verifyAccessToken } from '../utils/jwt';
import { isSessionActive } from '../services/session.service';
import { auditAdminChanges } from '../services/audit.service';
import { requireAdminTwoFactor } from './role.middleware';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: UserRole;
    email: string;
    providerId?: string;
    /** This device's session, for sign-out and "this device" in the session list. */
    sessionId?: string;
    twoFactorEnabled?: boolean;
  };
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401);
    }
    const token = header.slice(7);
    const payload = verifyAccessToken(token);
    // A signed-out or revoked device loses access at once, not when its
    // 15-minute access token runs out. (Pre-session tokens carry no sid.)
    if (payload.sid && !(await isSessionActive(payload.sid))) {
      throw new AppError('Session has ended. Please sign in again.', 401);
    }
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') {
      throw new AppError('Invalid or inactive account', 401);
    }

    let providerId: string | undefined;
    if (user.role === 'provider') {
      const profile = await ProviderProfile.findOne({ userId: user._id }).select('_id');
      providerId = profile?._id.toString();
    }

    req.user = {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
      providerId,
      sessionId: payload.sid,
      twoFactorEnabled: Boolean(user.twoFactor?.enabled),
    };

    // Admins reach data through shared routes too (payments, support, bookings), not
    // only /api/admin, so the 2-step rule and the audit trail apply wherever an admin
    // token is used. /api/auth stays open: it is where they sign in and set 2-step up.
    if (user.role === 'admin' && !ADMIN_SETUP_PATH.test(req.originalUrl)) {
      let gate: unknown;
      requireAdminTwoFactor(req, res, (err?: unknown) => {
        gate = err;
      });
      if (gate) throw gate;
      auditAdminChanges(req, res, () => undefined);
    }
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError('Invalid or expired token', 401));
  }
}

/** Sign-in, 2-step setup, sessions and /me: usable before 2-step is on. */
const ADMIN_SETUP_PATH = /^\/api\/auth(\/|\?|$)/;

export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  return authenticate(req, res, (err?: unknown) => {
    // On public routes an admin without 2-step simply browses as a guest.
    if (err instanceof AppError && err.errors?.some((e) => (e as { code?: string }).code === 'TWO_FACTOR_SETUP_REQUIRED')) {
      req.user = undefined;
      return next();
    }
    return next(err as Error | undefined);
  });
}
