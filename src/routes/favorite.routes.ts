import { Router } from 'express';
import * as misc from '../controllers/misc.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();
router.use(authenticate, requireRole('customer'));
router.post('/', misc.addFavorite);
router.get('/', misc.listFavorites);
router.delete('/:id', misc.removeFavorite);
export default router;
