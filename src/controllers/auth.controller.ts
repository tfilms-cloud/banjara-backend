import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as authService from '../services/auth.service';
import { sendSuccess } from '../utils/apiResponse';

export async function register(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await authService.register(req.body);
    return sendSuccess(res, data, 'Registered successfully', 201);
  } catch (error) {
    next(error);
  }
}

export async function login(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await authService.login(req.body);
    return sendSuccess(res, data, 'Logged in successfully');
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await authService.refresh(req.body.refreshToken);
    return sendSuccess(res, data, 'Token refreshed');
  } catch (error) {
    next(error);
  }
}

export async function logout(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await authService.logout(req.user!.id);
    return sendSuccess(res, null, 'Logged out');
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
