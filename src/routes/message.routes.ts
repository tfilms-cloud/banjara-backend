import { Router } from 'express';
import * as misc from '../controllers/misc.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticate);
router.get('/', misc.listMessages);
router.get('/unread-count', misc.unreadTotal);
router.post('/', misc.sendMessage);
router.post('/read', misc.markMessagesRead);
export default router;
