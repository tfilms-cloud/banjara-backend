import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();
router.use(authenticate, requireRole('admin'));

router.get('/dashboard', adminController.dashboard);

router.get('/providers', adminController.listProviders);
router.get('/providers/:id', adminController.getProvider);
router.put('/providers/:id/approve', adminController.approveProvider);
router.put('/providers/:id/reject', adminController.rejectProvider);
router.put('/providers/:id/suspend', adminController.suspendProvider);

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
router.put('/support/:id', adminController.updateSupport);

router.get('/reports', adminController.getReports);

export default router;
