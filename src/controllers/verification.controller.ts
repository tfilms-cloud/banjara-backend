import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { assertImageUpload } from '../middleware/upload.middleware';
import { ProviderProfile } from '../models/ProviderProfile';
import * as cnicVerificationService from '../services/cnicVerification.service';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';
import { cnicVerifyBodySchema } from '../validators/verification.validator';

function requireProviderId(req: AuthRequest) {
  if (!req.user?.providerId) {
    throw new AppError('Provider profile required', 403);
  }
  return req.user.providerId;
}

/** OCR extract from CNIC front — used to prefill the form. */
export async function extractCnic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const providerId = requireProviderId(req);
    const file = assertImageUpload(
      (req.file as Express.Multer.File | undefined) ||
        (req.files as { front?: Express.Multer.File[] } | undefined)?.front?.[0]
    );
    const data = await cnicVerificationService.extractFromCnicImage({
      providerId,
      frontImage: file.buffer,
      mimeType: file.mimetype,
    });
    return sendSuccess(res, data, 'CNIC fields extracted');
  } catch (error) {
    next(error);
  }
}

/** Full verify: entered fields + images → backend matching decision. */
export async function verifyCnic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const providerId = requireProviderId(req);
    const body = cnicVerifyBodySchema.parse(req.body);
    const files = req.files as
      | { front?: Express.Multer.File[]; back?: Express.Multer.File[] }
      | undefined;
    const front = assertImageUpload(files?.front?.[0] ?? (req.file as Express.Multer.File | undefined));
    const back = files?.back?.[0];
    if (!back) {
      throw new AppError('Upload a photo of the back of your CNIC', 400);
    }
    assertImageUpload(back);

    const data = await cnicVerificationService.verifyProviderCnic({
      providerId,
      cnicNumber: body.cnicNumber,
      fatherName: body.fatherName,
      expiryDate: body.expiryDate,
      frontImage: front.buffer,
      backImage: back?.buffer,
      mimeType: front.mimetype,
    });
    return sendSuccess(res, data, 'CNIC verification complete');
  } catch (error) {
    next(error);
  }
}

export async function getCnicStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const providerId = requireProviderId(req);
    const profile = await ProviderProfile.findById(providerId).select('identityVerification');
    return sendSuccess(res, profile?.identityVerification ?? null, 'OK');
  } catch (error) {
    next(error);
  }
}
