import { NextFunction, Response } from 'express';
import { ProviderProfile } from '../models/ProviderProfile';
import type { UserRole } from '../types/auth.types';
import { AppError } from '../utils/AppError';
import type { AuthRequest } from './auth.middleware';

export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    next();
  };
}

export const requireRoles = requireRole;

/**
 * Allows only providers whose profile is `approved`.
 *
 * `requireRole('provider')` answers "is this a provider?", never "is this provider
 * approved?". This resolves the profile (a User id is not a ProviderProfile id) and
 * checks the verification status.
 *
 * NOTE: this middleware is intentionally not attached to any route yet — which
 * provider-mutating routes require approval is the repo owner's decision.
 */
export async function requireApprovedProvider(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!req.user || req.user.role !== 'provider') {
      return next(new AppError('Provider access required', 403));
    }
    const profile = await ProviderProfile.findOne({ userId: req.user.id }).select('verificationStatus');
    if (!profile) {
      return next(new AppError('Provider profile not found', 403));
    }
    if (profile.verificationStatus !== 'approved') {
      return next(new AppError('Provider must be approved before managing services', 403));
    }
    next();
  } catch (error) {
    next(error);
  }
}
