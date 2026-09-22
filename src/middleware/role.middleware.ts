import { NextFunction, Response } from 'express';
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

export function requireApprovedProvider(req: AuthRequest, _res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'provider') {
    return next(new AppError('Provider access required', 403));
  }
  if (!req.user.providerId) {
    return next(new AppError('Provider profile not found', 403));
  }
  next();
}
