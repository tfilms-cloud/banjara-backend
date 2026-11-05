import { Router } from 'express';
import * as guideController from '../controllers/guide.controller';
import { authenticate, optionalAuth } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  guideAvailabilitySchema,
  guideOfferedServiceCreateSchema,
  guideOfferedServiceUpdateSchema,
} from '../validators/guide.validator';
import { z } from 'zod';

const router = Router();

const guideProfileBodySchema = z.object({ submit: z.boolean().optional() }).passthrough();

/** Public guide discovery */
router.get('/', optionalAuth, guideController.searchGuides);

/** Provider-managed guide profile — before /:id routes */
router.get('/me/profile', authenticate, requireRole('provider'), guideController.getMine);
router.put(
  '/me/profile',
  authenticate,
  requireRole('provider'),
  validate(guideProfileBodySchema),
  guideController.upsertMine
);
router.post(
  '/me/services',
  authenticate,
  requireRole('provider'),
  validate(guideOfferedServiceCreateSchema),
  guideController.upsertService
);
router.put(
  '/me/services/:serviceId',
  authenticate,
  requireRole('provider'),
  validate(guideOfferedServiceUpdateSchema),
  guideController.upsertService
);
router.delete(
  '/me/services/:serviceId',
  authenticate,
  requireRole('provider'),
  guideController.deleteService
);
router.put(
  '/me/availability',
  authenticate,
  requireRole('provider'),
  validate(guideAvailabilitySchema),
  guideController.upsertAvailability
);

router.get('/:id/availability', optionalAuth, guideController.getPublicAvailability);

export default router;
