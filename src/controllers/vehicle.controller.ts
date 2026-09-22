import { paramId } from '../utils/params';
import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
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
    const id = req.user?.role === 'provider' ? providerId(req) : undefined;
    return sendSuccess(res, await vehicleService.listVehicles(id));
  } catch (error) {
    next(error);
  }
}

export async function getById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await vehicleService.getVehicle(paramId(req.params.id)));
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
