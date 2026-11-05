import { Router } from 'express';
import * as misc from '../controllers/misc.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticate);

router.get('/', misc.listNotifications);
router.put('/read-all', misc.readAllNotifications);
router.get('/preferences', misc.getNotificationPreferences);
router.patch('/preferences', misc.updateNotificationPreferences);
router.post('/device-token', misc.registerDeviceToken);
router.delete('/device-token', misc.unregisterDeviceToken);
router.put('/:id/read', misc.readNotification);

export default router;
