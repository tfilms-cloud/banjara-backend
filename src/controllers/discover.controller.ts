import type { NextFunction, Request, Response } from 'express';
import * as discoverService from '../services/discover.service';
import type { DiscoverQuery } from '../validators/discover.validator';
import { sendSuccess } from '../utils/apiResponse';

export async function discover(req: Request, res: Response, next: NextFunction) {
  try {
    // `validate(discoverQuerySchema, 'query')` has already parsed and defaulted this.
    const query = req.query as unknown as DiscoverQuery;
    sendSuccess(res, await discoverService.discover(query));
  } catch (error) {
    next(error);
  }
}
