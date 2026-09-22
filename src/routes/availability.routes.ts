import { Router } from 'express';
import * as hotelController from '../controllers/hotel.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

router.get('/rooms/:roomId', hotelController.getAvailability);
router.put('/rooms/:roomId', authenticate, requireRole('provider'), hotelController.updateAvailability);
router.post('/block', authenticate, requireRole('provider'), hotelController.block);
router.post('/unblock', authenticate, requireRole('provider'), hotelController.unblock);
router.post('/bulk', authenticate, requireRole('provider'), hotelController.bulkAvailability);

export default router;
