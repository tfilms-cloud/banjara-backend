import { Router } from 'express';
import * as providerController from '../controllers/provider.controller';
import * as bookingController from '../controllers/booking.controller';
import * as hotelController from '../controllers/hotel.controller';
import * as locationController from '../controllers/location.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { upload } from '../middleware/upload.middleware';
import { providerRegisterSchema, providerUpdateSchema } from '../validators/provider.validator';
import { saveBusinessLocationSchema } from '../validators/location.validator';

const router = Router();

router.use(authenticate);
router.post(
  '/register',
  requireRole('customer', 'provider'),
  validate(providerRegisterSchema),
  providerController.registerProvider
);
router.get('/me', requireRole('provider'), providerController.getMe);
router.put('/me', requireRole('provider'), validate(providerUpdateSchema), providerController.updateMe);
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
router.get('/earnings', requireRole('provider'), bookingController.earnings);
router.get('/hotel/dashboard', requireRole('provider'), hotelController.providerDashboard);
router.get('/hotel/bookings/lookup', requireRole('provider'), hotelController.lookupBooking);
router.put('/hotel/bookings/:bookingId/check-in', requireRole('provider'), hotelController.checkIn);
router.put('/hotel/bookings/:bookingId/check-out', requireRole('provider'), hotelController.checkOut);

export default router;
