import { Router } from 'express';
import * as discoverController from '../controllers/discover.controller';
import { validate } from '../middleware/validation.middleware';
import { discoverQuerySchema } from '../validators/discover.validator';

const router = Router();

/** Public: one normalized, sortable/filterable card list per Explore service. */
router.get('/', validate(discoverQuerySchema, 'query'), discoverController.discover);

export default router;
