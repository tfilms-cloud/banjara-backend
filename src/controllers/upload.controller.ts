import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { assertImageUpload } from '../middleware/upload.middleware';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';
import {
  isSupabaseConfigured,
  uploadImageBuffer,
  UPLOAD_FOLDERS,
  type UploadFolder,
} from '../config/supabase';

function parseFolder(raw: unknown): UploadFolder {
  const folder = String(raw ?? 'misc');
  if (!UPLOAD_FOLDERS.includes(folder as UploadFolder)) {
    throw new AppError(
      `Invalid folder. Allowed: ${UPLOAD_FOLDERS.join(', ')}`,
      422
    );
  }
  return folder as UploadFolder;
}

export async function uploadSingle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isSupabaseConfigured()) {
      throw new AppError('Supabase Storage is not configured on the server', 503);
    }
    const file = assertImageUpload(req.file);
    const folder = parseFolder(req.body?.folder);
    const result = await uploadImageBuffer({
      buffer: file.buffer,
      mime: file.mimetype,
      folder,
      userId: req.user!.id,
      originalName: file.originalname,
    });
    return sendSuccess(res, result, 'Image uploaded', 201);
  } catch (error) {
    next(error);
  }
}

export async function uploadMultiple(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isSupabaseConfigured()) {
      throw new AppError('Supabase Storage is not configured on the server', 503);
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new AppError('At least one image file is required', 400);
    if (files.length > 8) throw new AppError('Maximum 8 images per upload', 422);

    const folder = parseFolder(req.body?.folder);
    const items = [];
    for (const file of files) {
      items.push(
        await uploadImageBuffer({
          buffer: file.buffer,
          mime: file.mimetype,
          folder,
          userId: req.user!.id,
          originalName: file.originalname,
        })
      );
    }
    return sendSuccess(res, { items, urls: items.map((item) => item.url) }, 'Images uploaded', 201);
  } catch (error) {
    next(error);
  }
}
