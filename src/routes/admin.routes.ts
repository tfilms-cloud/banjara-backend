import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import * as serviceCatalogController from '../controllers/serviceCatalog.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdminTwoFactor, requireRole } from '../middleware/role.middleware';
import { listAuditLogs } from '../services/audit.service';
import { sendSuccess } from '../utils/apiResponse';
import { validate } from '../middleware/validation.middleware';
import { updateSupportSchema } from '../validators/support.validator';
import { adminModerateItinerarySchema } from '../validators/tourItinerary.validator';
import * as intercityController from '../controllers/intercity.controller';
import { commissionSettingsSchema, reviewCommissionPaymentSchema } from '../validators/intercity.validator';

const router = Router();
// authenticate also applies the 2-step rule and the audit trail to every admin request.
router.use(authenticate, requireRole('admin'), requireAdminTwoFactor);

router.get('/audit-logs', async (req, res, next) => {
  try {
    return sendSuccess(res, await listAuditLogs(req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard', adminController.dashboard);

router.get('/providers', adminController.listProviders);
router.get('/providers/:id', adminController.getProvider);
router.put('/providers/:id/approve', adminController.approveProvider);
router.put('/providers/:id/reject', adminController.rejectProvider);
router.put('/providers/:id/suspend', adminController.suspendProvider);
router.put('/providers/:id/platform-fee', adminController.setProviderPlatformFee);

router.get('/services', serviceCatalogController.listAdmin);
router.post('/services', serviceCatalogController.create);
router.put('/services/:id', serviceCatalogController.update);
router.delete('/services/:id', serviceCatalogController.remove);

router.get('/customers', adminController.listCustomers);
router.get('/customers/:id', adminController.getCustomer);

router.get('/vehicles', adminController.listVehicles);
router.get('/vehicles/:id', adminController.getVehicle);
router.patch('/vehicles/:id/approve', adminController.approveVehicle);
router.put('/vehicles/:id/approve', adminController.approveVehicle);
router.patch('/vehicles/:id/reject', adminController.rejectVehicle);
router.put('/vehicles/:id/reject', adminController.rejectVehicle);
router.patch('/vehicles/:id/suspend', adminController.suspendVehicle);
router.put('/vehicles/:id/suspend', adminController.suspendVehicle);
router.get('/vehicles/:id/trips', adminController.getVehicleTrips);

router.get('/routes', adminController.listRoutes);
router.get('/routes/:id', adminController.getRoute);

router.get('/pickup-points', adminController.listPickupPoints);
router.get('/pickup-points/:id', adminController.getPickupPoint);

router.get('/trips', adminController.listTrips);
router.get('/trips/:id', adminController.getTrip);

router.get('/hotels', adminController.listHotels);
router.get('/hotels/:id', adminController.getHotel);
router.put('/hotels/:id/approve', adminController.approveHotel);
router.put('/hotels/:id/reject', adminController.rejectHotel);
router.put('/hotels/:id/suspend', adminController.suspendHotel);
router.put('/hotels/:id/request-changes', adminController.requestHotelChanges);

router.get('/rooms', adminController.listRooms);
router.get('/rooms/:id', adminController.getRoom);

router.get('/availability', adminController.listAvailability);

router.get('/bookings', adminController.listBookings);
router.get('/bookings/:id', adminController.getBooking);

router.get('/payments', adminController.listPayments);
router.get('/payments/:id', adminController.getPayment);

router.get('/reviews', adminController.listReviews);

router.get('/notifications', adminController.listNotifications);
router.get('/messages', adminController.listMessages);

router.get('/support', adminController.listSupport);
router.get('/support/:id', adminController.getSupport);
router.put('/support/:id', validate(updateSupportSchema), adminController.updateSupport);

router.get('/reports', adminController.getReports);

router.get('/tour-itineraries', adminController.listTourItineraries);
router.get('/tour-itineraries/:id', adminController.getTourItinerary);
router.put(
  '/tour-itineraries/:id/moderate',
  validate(adminModerateItinerarySchema),
  adminController.moderateTourItinerary
);


// City to City commission: drivers' reported payments and the commission rules.
router.get('/intercity/commission/payments', intercityController.adminCommissionPayments);
router.post('/intercity/commission/payments/:id/approve', intercityController.adminApproveCommissionPayment);
router.post(
  '/intercity/commission/payments/:id/reject',
  validate(reviewCommissionPaymentSchema),
  intercityController.adminRejectCommissionPayment
);
router.get('/intercity/commission/settings', intercityController.adminCommissionSettings);
router.put('/intercity/commission/settings', validate(commissionSettingsSchema), intercityController.adminUpdateCommissionSettings);

export default router;
