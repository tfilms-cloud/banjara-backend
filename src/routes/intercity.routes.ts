import { Router } from 'express';
import * as c from '../controllers/intercity.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  chooseOfferSchema,
  commissionPaymentSchema,
  driverSettingsSchema,
  intercityQuoteSchema,
  intercityRequestSchema,
  joinSharedSchema,
  locationBatchSchema,
  nearbyQuerySchema,
  respondSchema,
  sharedTripsQuerySchema,
  tripStatusSchema,
} from '../validators/intercity.validator';

/**
 * City to City rides. Every service call checks the feature switch (env
 * INTERCITY_ENABLED + IntercitySettings.enabled) and answers 404 when it is off;
 * /config is the one endpoint that always answers, so clients can hide the feature.
 */
const router = Router();

router.get('/config', c.config);
router.get('/cities', c.cities);
router.post('/quote', validate(intercityQuoteSchema), c.quote);
router.get('/shared-trips', validate(sharedTripsQuerySchema, 'query'), c.sharedTrips);
router.get('/nearby', validate(nearbyQuerySchema, 'query'), c.nearby);

// Rider
router.post('/requests', authenticate, requireRole('customer'), validate(intercityRequestSchema), c.createRequest);
router.get('/requests', authenticate, requireRole('customer'), c.myRequests);
router.get('/requests/:id', authenticate, requireRole('customer'), c.myRequest);
router.post('/requests/:id/cancel', authenticate, requireRole('customer'), c.cancelRequest);
router.post('/requests/:id/widen', authenticate, requireRole('customer'), c.widen);
router.post('/requests/:id/choose', authenticate, requireRole('customer'), validate(chooseOfferSchema), c.chooseOffer);
router.get('/requests/:id/shared-trips', authenticate, requireRole('customer'), c.requestSharedTrips);
router.post('/requests/:id/join', authenticate, requireRole('customer'), validate(joinSharedSchema), c.joinShared);

// Driver
router.get('/driver/settings', authenticate, requireRole('provider'), c.driverSettings);
router.put('/driver/settings', authenticate, requireRole('provider'), validate(driverSettingsSchema), c.updateDriverSettings);
router.get('/driver/requests', authenticate, requireRole('provider'), c.driverFeed);
// Commission owed to BANJARA (works even while the feature is switched off: money is still owed).
router.get('/driver/balance', authenticate, requireRole('provider'), c.driverBalance);
router.post('/driver/balance/payments', authenticate, requireRole('provider'), validate(commissionPaymentSchema), c.reportCommissionPayment);
router.post('/driver/requests/:id/respond', authenticate, requireRole('provider'), validate(respondSchema), c.respond);
router.put('/driver/trips/:id/status', authenticate, requireRole('provider'), validate(tripStatusSchema), c.tripStatus);
router.post('/driver/bookings/:id/no-show', authenticate, requireRole('provider'), c.noShow);

// Tracking: buffered points from the driver; last position for rider / driver / admin.
router.post('/trips/:id/locations', authenticate, requireRole('provider'), validate(locationBatchSchema), c.recordLocations);
router.get('/trips/:id/location', authenticate, c.tripLocation);

export default router;
