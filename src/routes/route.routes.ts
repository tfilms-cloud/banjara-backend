import { Router } from 'express';
import * as tripController from '../controllers/trip.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { updateRouteSchema } from '../validators/route.validator';

const router = Router();

router.get('/', authenticate, tripController.listRoutes);
router.get('/:id', authenticate, tripController.getRoute);
router.post('/', authenticate, requireRole('provider'), tripController.createRoute);
router.put('/:id', authenticate, requireRole('provider'), validate(updateRouteSchema), tripController.updateRoute);
router.delete('/:id', authenticate, requireRole('provider'), tripController.deleteRoute);

export default router;
