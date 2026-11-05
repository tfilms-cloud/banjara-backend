import { paramId } from '../utils/params';
import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { ProviderProfile } from '../models/ProviderProfile';
import * as vehicleService from '../services/vehicle.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';

function providerId(req: AuthRequest) {
  if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
  return req.user.providerId;
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await vehicleService.createVehicle(providerId(req), req.body), 'Vehicle created', 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.user?.role === 'provider') {
      const id = providerId(req);
      // Heal: signup used to only save transportDetails — ensure a Vehicle row exists
      try {
        const profile = await ProviderProfile.findById(id).select('services transportDetails');
        if (profile && (profile.services ?? []).includes('transport')) {
          await vehicleService.upsertVehicleFromTransportDetails(
            id,
            profile.transportDetails as Record<string, unknown> | undefined
          );
        }
      } catch {
        // non-fatal — still return whatever vehicles exist
      }
      return sendSuccess(res, await vehicleService.listVehicles(id));
    }
    return sendSuccess(res, await vehicleService.listVehicles());
  } catch (error) {
    next(error);
  }
}

export async function getById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await vehicleService.getVehicle(paramId(req.params.id), req.user?.providerId, req.user?.role === 'admin'));
  } catch (error) {
    next(error);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await vehicleService.updateVehicle(providerId(req), paramId(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await vehicleService.deleteVehicle(providerId(req), paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}
