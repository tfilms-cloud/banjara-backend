import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as userService from '../services/user.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { isSupabaseConfigured, uploadImageBuffer } from '../config/supabase';

export async function getMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await userService.getMe(req.user!.id));
  } catch (error) {
    next(error);
  }
}

export async function updateMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await userService.updateMe(req.user!.id, req.body), 'Profile updated');
  } catch (error) {
    next(error);
  }
}

export async function updatePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await userService.updatePassword(
      req.user!.id,
      req.body.currentPassword,
      req.body.newPassword
    );
    return sendSuccess(res, data);
  } catch (error) {
    next(error);
  }
}

export async function updateAvatar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    let avatarUrl =
      (typeof req.body?.avatarUrl === 'string' && req.body.avatarUrl) ||
      (typeof req.body?.avatar === 'string' && req.body.avatar) ||
      '';

    if (req.file) {
      if (!isSupabaseConfigured()) {
        throw new AppError('Supabase Storage is not configured on the server', 503);
      }
      const uploaded = await uploadImageBuffer({
        buffer: req.file.buffer,
        mime: req.file.mimetype,
        folder: 'avatars',
        userId: req.user!.id,
        originalName: req.file.originalname,
      });
      avatarUrl = uploaded.url;
    }

    if (!avatarUrl) {
      throw new AppError('Avatar file or avatar URL is required', 422);
    }

    return sendSuccess(res, await userService.updateAvatar(req.user!.id, avatarUrl), 'Avatar updated');
  } catch (error) {
    next(error);
  }
}
