import { Router } from 'express';
import * as vehicleController from '../controllers/vehicle.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { createVehicleSchema } from '../validators/vehicle.validator';

const router = Router();

router.get('/', authenticate, vehicleController.list);
router.get('/:id', authenticate, vehicleController.getById);
router.post(
  '/',
  authenticate,
  requireRole('provider'),
  validate(createVehicleSchema),
  vehicleController.create
);
router.put('/:id', authenticate, requireRole('provider'), vehicleController.update);
router.delete('/:id', authenticate, requireRole('provider'), vehicleController.remove);

export default router;
