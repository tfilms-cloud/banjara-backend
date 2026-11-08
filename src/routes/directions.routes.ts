import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.middleware';
import { getDrivingRoute } from '../services/directions.service';
import { sendSuccess } from '../utils/apiResponse';

/** "lat,lng" with real coordinates. */
const point = z
  .string()
  .max(60)
  .transform((value) => value.split(',').map((part) => Number(part.trim())))
  .refine(
    (parts) =>
      parts.length === 2 &&
      parts.every((n) => Number.isFinite(n)) &&
      Math.abs(parts[0]) <= 90 &&
      Math.abs(parts[1]) <= 180,
    'Expected "lat,lng"'
  )
  .transform(([lat, lng]) => ({ lat, lng }));

const drivingQuerySchema = z.object({ from: point, to: point });

const router = Router();

/**
 * Public: driving distance, time and road path from A to B (e.g. a visitor to a ride's
 * pickup). `data` is null when the routing server can't answer; clients then show
 * straight-line distance instead.
 */
router.get('/driving', validate(drivingQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = req.query as unknown as z.infer<typeof drivingQuerySchema>;
    sendSuccess(res, await getDrivingRoute(from, to));
  } catch (error) {
    next(error);
  }
});

export default router;
