import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as tourItineraryService from '../services/tourItinerary.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { paramId } from '../utils/params';

function providerId(req: AuthRequest) {
  if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
  return req.user.providerId;
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await tourItineraryService.createItinerary(providerId(req), req.body),
      'Itinerary created',
      201
    );
  } catch (error) {
    next(error);
  }
}

export async function listMine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await tourItineraryService.listProviderItineraries(
        providerId(req),
        req.query as Record<string, unknown>
      )
    );
  } catch (error) {
    next(error);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await tourItineraryService.updateItinerary(providerId(req), paramId(req.params.id), req.body),
      'Itinerary updated'
    );
  } catch (error) {
    next(error);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await tourItineraryService.deleteItinerary(providerId(req), paramId(req.params.id)),
      'Itinerary removed'
    );
  } catch (error) {
    next(error);
  }
}

export async function listPublished(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await tourItineraryService.listPublishedItineraries(req.query as Record<string, unknown>)
    );
  } catch (error) {
    next(error);
  }
}

export async function catalogByType(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tourType = String(req.params.tourType ?? 'trek');
    return sendSuccess(res, await tourItineraryService.getTourTypeCatalog(tourType));
  } catch (error) {
    next(error);
  }
}

export async function bestOperators(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const limit = Number(req.query.limit ?? 12);
    return sendSuccess(res, await tourItineraryService.getBestTourOperators(limit));
  } catch (error) {
    next(error);
  }
}

export async function getById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await tourItineraryService.getItinerary(paramId(req.params.id), {
        providerId: providerId(req),
      })
    );
  } catch (error) {
    next(error);
  }
}

export async function getPublicById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await tourItineraryService.getItinerary(paramId(req.params.id), { publicOnly: true })
    );
  } catch (error) {
    next(error);
  }
}
