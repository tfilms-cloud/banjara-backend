import { Router } from 'express';
import * as tourItineraryController from '../controllers/tourItinerary.controller';
import { authenticate, optionalAuth } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  createTourItinerarySchema,
  listTourItineraryQuerySchema,
  updateTourItinerarySchema,
} from '../validators/tourItinerary.validator';

const router = Router();

/** Public catalog — static paths first */
router.get('/catalog/:tourType', optionalAuth, tourItineraryController.catalogByType);
router.get('/best-operators', optionalAuth, tourItineraryController.bestOperators);
router.get(
  '/',
  optionalAuth,
  validate(listTourItineraryQuerySchema, 'query'),
  tourItineraryController.listPublished
);

/** Provider CRUD — before /:id */
router.get('/mine', authenticate, requireRole('provider'), tourItineraryController.listMine);
router.get('/mine/:id', authenticate, requireRole('provider'), tourItineraryController.getById);
router.post(
  '/',
  authenticate,
  requireRole('provider'),
  validate(createTourItinerarySchema),
  tourItineraryController.create
);
router.put(
  '/:id',
  authenticate,
  requireRole('provider'),
  validate(updateTourItinerarySchema),
  tourItineraryController.update
);
router.delete('/:id', authenticate, requireRole('provider'), tourItineraryController.remove);

router.get('/:id', optionalAuth, tourItineraryController.getPublicById);

export default router;
