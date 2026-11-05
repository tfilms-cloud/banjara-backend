import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { isSupabaseConfigured, uploadImageBuffer } from '../config/supabase';
import * as providerService from '../services/provider.service';
import * as hotelService from '../services/hotel.service';
import * as vehicleService from '../services/vehicle.service';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';
import * as onboarding from '../services/transportOnboarding.service';
import { transportErrors } from '../utils/transportValidation';

async function syncHotelListing(profile: Awaited<ReturnType<typeof providerService.registerProvider>>) {
  if ((profile.services ?? []).includes('hotel')) {
    await hotelService.upsertHotelFromProviderProfile(profile);
  }
}

async function syncTransportVehicle(
  profile: Awaited<ReturnType<typeof providerService.registerProvider>>
) {
  const services = profile.services ?? [];
  if (!services.includes('transport')) return;
  const details = profile.transportDetails as Record<string, unknown> | undefined;
  if (profile.onboarding?.vehicleId && transportErrors(details).length) return;
  await vehicleService.upsertVehicleFromTransportDetails(profile._id.toString(), details, Boolean(profile.onboarding?.vehicleId));
}

export async function registerProvider(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await User.findByIdAndUpdate(req.user!.id, { role: 'provider' });
    const profile = await providerService.registerProvider(req.user!.id, req.body);
    await syncHotelListing(profile);
    await syncTransportVehicle(profile);
    return sendSuccess(res, await onboarding.providerWithProgress(profile), 'Provider draft saved', 201);
  } catch (error) {
    next(error);
  }
}

export async function getMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await onboarding.providerWithProgress(await providerService.getMyProvider(req.user!.id)));
  } catch (error) {
    next(error);
  }
}

export async function updateMe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const profile = await providerService.updateMyProvider(req.user!.id, req.body);
    await syncHotelListing(profile);
    await syncTransportVehicle(profile);
    return sendSuccess(res, await onboarding.providerWithProgress(profile));
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

export async function onboardingCheckpoint(req: AuthRequest, res: Response, next: NextFunction) {
  try { return sendSuccess(res, await onboarding.checkpoint(req.user!.id, req.body.step, req.body.vehicleId)); }
  catch (error) { next(error); }
}

export async function submitOnboarding(req: AuthRequest, res: Response, next: NextFunction) {
  try { return sendSuccess(res, await onboarding.submitTransportApplication(req.user!.id)); }
  catch (error) { next(error); }
}

export async function dashboard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const profile = await providerService.getMyProvider(req.user!.id);
    const progress = await onboarding.transportProgress(profile);
    if (progress && (!progress.completed || profile.verificationStatus !== 'approved')) {
      throw new AppError('Complete transportation signup and wait for provider approval before opening the dashboard.', 403);
    }
    if (!req.user?.providerId) {
      const profile = await providerService.getMyProvider(req.user!.id);
      return sendSuccess(res, await providerService.getProviderDashboard(profile._id.toString()));
    }
    return sendSuccess(res, await providerService.getProviderDashboard(req.user.providerId));
  } catch (error) {
    next(error);
  }
}

export async function searchCatalog(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const service = typeof req.query.service === 'string' ? req.query.service : undefined;
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    return sendSuccess(res, await providerService.searchProviderCatalog({ service, city, limit }));
  } catch (error) {
    next(error);
  }
}

export async function getPublicProvider(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    return sendSuccess(res, await providerService.getPublicProviderById(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}
