import { Router } from 'express';
import * as bookingController from '../controllers/booking.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

router.use(authenticate);
router.get('/:id', bookingController.getPayment);
router.post('/:id/refund', requireRole('admin', 'provider'), bookingController.refundPayment);

export default router;
