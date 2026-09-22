import { Router } from 'express';
import * as misc from '../controllers/misc.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();
router.use(authenticate);
router.post('/', misc.createSupport);
router.get('/', misc.listSupport);
router.get('/:id', misc.getSupport);
router.put('/:id', requireRole('admin'), misc.updateSupport);
export default router;
