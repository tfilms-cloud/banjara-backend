import { Router } from 'express';
import * as locationController from '../controllers/location.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { optionalAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  geocodeSearchQuerySchema,
  nearbyBusinessQuerySchema,
  reverseGeocodeQuerySchema,
  saveBusinessLocationSchema,
} from '../validators/location.validator';

const router = Router();

/** Public geocoding helpers (optional auth — needed during provider onboarding). */
router.get(
  '/search',
  optionalAuth,
  validate(geocodeSearchQuerySchema, 'query'),
  locationController.searchPlaces
);
router.get(
  '/reverse',
  optionalAuth,
  validate(reverseGeocodeQuerySchema, 'query'),
  locationController.reverseGeocode
);

/** Nearby businesses for "near me" features */
router.get(
  '/nearby',
  optionalAuth,
  validate(nearbyBusinessQuerySchema, 'query'),
  locationController.nearby
);

/** Spec-aligned business location CRUD — ownership enforced */
router.get(
  '/:businessId/location',
  authenticate,
  requireRole('provider', 'admin'),
  locationController.getBusinessLocation
);
router.post(
  '/:businessId/location',
  authenticate,
  requireRole('provider', 'admin'),
  validate(saveBusinessLocationSchema),
  locationController.saveBusinessLocation
);
router.patch(
  '/:businessId/location',
  authenticate,
  requireRole('provider', 'admin'),
  validate(saveBusinessLocationSchema),
  locationController.saveBusinessLocation
);
router.put(
  '/:businessId/location',
  authenticate,
  requireRole('provider', 'admin'),
  validate(saveBusinessLocationSchema),
  locationController.saveBusinessLocation
);

export default router;
