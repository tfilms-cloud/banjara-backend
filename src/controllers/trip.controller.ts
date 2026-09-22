import { paramId } from '../utils/params';
import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as tripService from '../services/trip.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';

function providerId(req: AuthRequest) {
  if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
  return req.user.providerId;
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.createTrip(providerId(req), req.body), 'Trip published', 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const id = req.user?.role === 'provider' ? req.user.providerId : undefined;
    return sendSuccess(res, await tripService.listTrips(id));
  } catch (error) {
    next(error);
  }
}

export async function search(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.searchTrips(req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
}

export async function getById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.getTrip(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.updateTrip(providerId(req), paramId(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.deleteTrip(providerId(req), paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function createRoute(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.createRoute(providerId(req), req.body), 'Route created', 201);
  } catch (error) {
    next(error);
  }
}

export async function listRoutes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.listRoutes(req.user?.providerId));
  } catch (error) {
    next(error);
  }
}

export async function getRoute(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.getRoute(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function updateRoute(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.updateRoute(providerId(req), paramId(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
}

export async function deleteRoute(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.deleteRoute(providerId(req), paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function createPickup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.createPickupPoint(providerId(req), req.body), 'Created', 201);
  } catch (error) {
    next(error);
  }
}

export async function listPickups(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await tripService.listPickupPoints(
        (req.query.providerId as string | undefined) || req.user?.providerId
      )
    );
  } catch (error) {
    next(error);
  }
}

export async function updatePickup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.updatePickupPoint(providerId(req), paramId(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
}

export async function deletePickup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await tripService.deletePickupPoint(providerId(req), paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}
