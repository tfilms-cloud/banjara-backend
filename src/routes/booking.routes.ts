import { Router } from 'express';
import * as bookingController from '../controllers/booking.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { createBookingSchema } from '../validators/booking.validator';

const router = Router();

router.use(authenticate);
router.post('/', requireRole('customer'), validate(createBookingSchema), bookingController.create);
router.get('/my-bookings', requireRole('customer'), bookingController.listMine);
router.get('/:id', bookingController.getById);
router.get('/:id/ticket', bookingController.ticket);
router.put('/:id/cancel', bookingController.cancel);

export default router;
