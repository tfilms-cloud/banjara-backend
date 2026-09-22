import { Router } from 'express';
import * as hotelController from '../controllers/hotel.controller';
import { authenticate, optionalAuth } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { createHotelSchema, searchHotelSchema } from '../validators/hotel.validator';

const router = Router();

router.get('/search', optionalAuth, validate(searchHotelSchema, 'query'), hotelController.search);
router.post('/quote', optionalAuth, hotelController.quote);
router.get('/', optionalAuth, hotelController.list);
router.get('/:id', optionalAuth, hotelController.getById);
router.post('/', authenticate, requireRole('provider'), validate(createHotelSchema), hotelController.create);
router.put('/:id', authenticate, requireRole('provider'), hotelController.update);
router.delete('/:id', authenticate, requireRole('provider'), hotelController.remove);

export default router;
