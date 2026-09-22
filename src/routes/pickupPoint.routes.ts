import { Router } from 'express';
import * as tripController from '../controllers/trip.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { updatePickupPointSchema } from '../validators/pickupPoint.validator';

const router = Router();

router.get('/', tripController.listPickups);
router.post('/', authenticate, requireRole('provider'), tripController.createPickup);
router.put('/:id', authenticate, requireRole('provider'), validate(updatePickupPointSchema), tripController.updatePickup);
router.delete('/:id', authenticate, requireRole('provider'), tripController.deletePickup);

export default router;
