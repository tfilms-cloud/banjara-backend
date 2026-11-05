import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as guideService from '../services/guide.service';
import { AppError } from '../utils/AppError';
import mongoose from 'mongoose';

function requireProviderId(req: AuthRequest) {
  const providerId = String(req.user?.providerId ?? '').trim();
  if (!providerId || !mongoose.isValidObjectId(providerId)) {
    throw new AppError(
      'Provider profile required. Complete location setup before editing your guide profile.',
      400
    );
  }
  return providerId;
}

export async function searchGuides(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await guideService.searchGuides({
      destination: req.query.destination ? String(req.query.destination) : undefined,
      date: req.query.date ? String(req.query.date) : undefined,
      guests: req.query.guests != null ? Number(req.query.guests) : undefined,
      guideType: req.query.guideType ? String(req.query.guideType) : undefined,
      language: req.query.language ? String(req.query.language) : undefined,
      minPrice: req.query.minPrice != null ? Number(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice != null ? Number(req.query.maxPrice) : undefined,
      minRating: req.query.minRating != null ? Number(req.query.minRating) : undefined,
      minExperience: req.query.minExperience != null ? Number(req.query.minExperience) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getPublicAvailability(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await guideService.getPublicGuideAvailability(String(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getMine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = await guideService.getMyGuide(requireProviderId(req));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function upsertMine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const providerId = requireProviderId(req);
    const submit = Boolean(req.body?.submit);
    const patch = { ...req.body };
    delete patch.submit;
    const data = await guideService.upsertGuideDetails(providerId, patch, submit);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function upsertService(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const providerId = requireProviderId(req);
    const serviceId = req.params.serviceId ? String(req.params.serviceId) : undefined;
    const data = await guideService.addGuideService(providerId, {
      ...req.body,
      id: serviceId || req.body.id,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function deleteService(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const providerId = requireProviderId(req);
    const data = await guideService.removeGuideService(providerId, String(req.params.serviceId));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function upsertAvailability(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const providerId = requireProviderId(req);
    const data = await guideService.setGuideAvailability(providerId, req.body);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}
