import { Router } from 'express';
import { z } from 'zod';
import * as providerController from '../controllers/provider.controller';
import * as bookingController from '../controllers/booking.controller';
import * as hotelController from '../controllers/hotel.controller';
import * as locationController from '../controllers/location.controller';
import { authenticate, optionalAuth } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { upload } from '../middleware/upload.middleware';
import { providerRegisterSchema, providerUpdateSchema } from '../validators/provider.validator';
import { saveBusinessLocationSchema } from '../validators/location.validator';

const router = Router();

/** Public traveler catalog (restaurants, guides, tours) */
router.get('/catalog', optionalAuth, providerController.searchCatalog);
router.get('/public/:id', optionalAuth, providerController.getPublicProvider);

router.use(authenticate);
router.post(
  '/register',
  requireRole('customer', 'provider'),
  validate(providerRegisterSchema),
  providerController.registerProvider
);
router.get('/me', requireRole('provider'), providerController.getMe);
router.put('/me', requireRole('provider'), validate(providerUpdateSchema), providerController.updateMe);
router.post('/me/onboarding/checkpoint', requireRole('provider'), validate(z.object({
  step: z.enum(['location', 'transport', 'vehicle']),
  vehicleId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
})), providerController.onboardingCheckpoint);
router.post('/me/onboarding/submit', requireRole('provider'), providerController.submitOnboarding);
router.put(
  '/me/logo',
  requireRole('provider'),
  upload.single('file'),
  providerController.updateLogo
);
router.get('/me/location', requireRole('provider'), locationController.getMyLocation);
router.put(
  '/me/location',
  requireRole('provider'),
  validate(saveBusinessLocationSchema),
  locationController.saveMyLocation
);
router.patch(
  '/me/location',
  requireRole('provider'),
  validate(saveBusinessLocationSchema),
  locationController.saveMyLocation
);
router.post(
  '/me/location',
  requireRole('provider'),
  validate(saveBusinessLocationSchema),
  locationController.saveMyLocation
);
router.get('/me/status', requireRole('provider'), providerController.getStatus);
router.get('/dashboard', requireRole('provider'), providerController.dashboard);
router.get('/bookings', requireRole('provider'), bookingController.listProvider);
router.put('/bookings/:id/status', requireRole('provider'), bookingController.updateStatus);
router.put('/bookings/:id/cash-received', requireRole('provider'), bookingController.markCashReceived);
router.get('/earnings', requireRole('provider'), bookingController.earnings);
router.get('/hotel/dashboard', requireRole('provider'), hotelController.providerDashboard);
router.get('/hotel/bookings/lookup', requireRole('provider'), hotelController.lookupBooking);
router.put('/hotel/bookings/:bookingId/check-in', requireRole('provider'), hotelController.checkIn);
router.put('/hotel/bookings/:bookingId/check-out', requireRole('provider'), hotelController.checkOut);

export default router;
