import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';

const router = Router();

router.use(authenticate);
router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);
router.put('/me/password', userController.updatePassword);
router.put('/me/avatar', upload.single('file'), userController.updateAvatar);

export default router;
