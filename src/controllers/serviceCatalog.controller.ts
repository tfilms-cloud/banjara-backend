import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as serviceCatalogService from '../services/serviceCatalog.service';
import { sendSuccess } from '../utils/apiResponse';
import { paramId } from '../utils/params';

/** Public + provider: active services only */
export async function listActive(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await serviceCatalogService.listServices({ includeInactive: false }));
  } catch (error) {
    next(error);
  }
}

/** Admin: all services */
export async function listAdmin(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await serviceCatalogService.listServices({ includeInactive: true }));
  } catch (error) {
    next(error);
  }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await serviceCatalogService.createService(req.body), 'Service created', 201);
  } catch (error) {
    next(error);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await serviceCatalogService.updateService(paramId(req.params.id), req.body),
      'Service updated'
    );
  } catch (error) {
    next(error);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await serviceCatalogService.deleteService(paramId(req.params.id)),
      'Service deactivated'
    );
  } catch (error) {
    next(error);
  }
}
