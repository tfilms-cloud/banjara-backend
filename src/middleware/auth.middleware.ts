import { NextFunction, Request, Response } from 'express';
import { User } from '../models/User';
import { ProviderProfile } from '../models/ProviderProfile';
import type { UserRole } from '../types/auth.types';
import { AppError } from '../utils/AppError';
import { verifyAccessToken } from '../utils/jwt';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: UserRole;
    email: string;
    providerId?: string;
  };
}

export async function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401);
    }
    const token = header.slice(7);
    const payload = verifyAccessToken(token);
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
    };
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError('Invalid or expired token', 401));
  }
}

export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  return authenticate(req, res, next);
}
