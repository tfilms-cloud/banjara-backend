import { Router } from 'express';
import * as tripController from '../controllers/trip.controller';
import { authenticate, optionalAuth } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { createTripSchema, searchTripSchema } from '../validators/trip.validator';

const router = Router();

router.get('/search', optionalAuth, validate(searchTripSchema, 'query'), tripController.search);
router.get('/', authenticate, tripController.list);
router.get('/:id', optionalAuth, tripController.getById);
router.post('/', authenticate, requireRole('provider'), validate(createTripSchema), tripController.create);
router.put('/:id', authenticate, requireRole('provider'), tripController.update);
router.delete('/:id', authenticate, requireRole('provider'), tripController.remove);

export default router;
