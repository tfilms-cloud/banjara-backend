import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { isSupabaseConfigured, uploadImageBuffer } from '../config/supabase';
import * as providerService from '../services/provider.service';
import * as hotelService from '../services/hotel.service';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';

async function syncHotelListing(profile: Awaited<ReturnType<typeof providerService.registerProvider>>) {
  if ((profile.services ?? []).includes('hotel')) {
    await hotelService.upsertHotelFromProviderProfile(profile);
  }
}

export async function registerProvider(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await User.findByIdAndUpdate(req.user!.id, { role: 'provider' });
    const profile = await providerService.registerProvider(req.user!.id, req.body);
    await syncHotelListing(profile);
    return sendSuccess(res, profile, 'Provider application submitted', 201);
  } catch (error) {
    next(error);
  }
}

export async function getMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await providerService.getMyProvider(req.user!.id));
  } catch (error) {
    next(error);
  }
}

export async function updateMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const profile = await providerService.updateMyProvider(req.user!.id, req.body);
    await syncHotelListing(profile);
    return sendSuccess(res, profile);
  } catch (error) {
    next(error);
  }
}

export async function updateLogo(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    let logoUrl =
      (typeof req.body?.logo === 'string' && req.body.logo) ||
      (typeof req.body?.logoUrl === 'string' && req.body.logoUrl) ||
      '';

    if (req.file) {
      if (!isSupabaseConfigured()) {
        throw new AppError('Supabase Storage is not configured on the server', 503);
      }
      const uploaded = await uploadImageBuffer({
        buffer: req.file.buffer,
        mime: req.file.mimetype,
        folder: 'logos',
        userId: req.user!.id,
        originalName: req.file.originalname,
      });
      logoUrl = uploaded.url;
    }

    if (!logoUrl) {
      throw new AppError('Logo file or logo URL is required', 422);
    }

    return sendSuccess(
      res,
      await providerService.updateMyProvider(req.user!.id, { logo: logoUrl }),
      'Logo updated'
    );
  } catch (error) {
    next(error);
  }
}

export async function getStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await providerService.getProviderStatus(req.user!.id));
  } catch (error) {
    next(error);
  }
}

export async function dashboard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.providerId) {
      const profile = await providerService.getMyProvider(req.user!.id);
      return sendSuccess(res, await providerService.getProviderDashboard(profile._id.toString()));
    }
    return sendSuccess(res, await providerService.getProviderDashboard(req.user.providerId));
  } catch (error) {
    next(error);
  }
}
