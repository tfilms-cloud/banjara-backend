import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as locationService from '../services/location.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { ProviderProfile } from '../models/ProviderProfile';

export async function getMyLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await locationService.getMyBusinessLocation(req.user!.id));
  } catch (error) {
    next(error);
  }
}

export async function saveMyLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await locationService.saveBusinessLocation(req.user!.id, 'me', req.body),
      'Business location saved'
    );
  } catch (error) {
    next(error);
  }
}

export async function getBusinessLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const businessId = String(req.params.businessId);
    if (req.user?.role === 'admin') {
      return sendSuccess(res, await locationService.getBusinessLocation(businessId));
    }

    const owned = await ProviderProfile.findOne({ _id: businessId, userId: req.user!.id });
    if (!owned) {
      throw new AppError('You can only access your own business location', 403);
    }
    return sendSuccess(res, await locationService.getBusinessLocation(businessId));
  } catch (error) {
    next(error);
  }
}

export async function saveBusinessLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const businessId = String(req.params.businessId);
    return sendSuccess(
      res,
      await locationService.saveBusinessLocation(req.user!.id, businessId, req.body),
      'Business location saved'
    );
  } catch (error) {
    next(error);
  }
}

export async function nearby(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await locationService.findNearbyBusinesses(req.query as never));
  } catch (error) {
    next(error);
  }
}

export async function searchPlaces(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const q = String(req.query.q ?? '');
    const limit = Number(req.query.limit ?? 5);
    return sendSuccess(res, await locationService.searchPlaces(q, limit));
  } catch (error) {
    next(error);
  }
}

export async function reverseGeocode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    return sendSuccess(res, await locationService.reverseGeocode(latitude, longitude));
  } catch (error) {
    next(error);
  }
}
