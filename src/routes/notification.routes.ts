import { Router } from 'express';
import * as misc from '../controllers/misc.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticate);
router.get('/', misc.listNotifications);
router.put('/:id/read', misc.readNotification);
router.put('/read-all', misc.readAllNotifications);
export default router;
