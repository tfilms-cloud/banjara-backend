import { Router } from 'express';
import * as verificationController from '../controllers/verification.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { upload } from '../middleware/upload.middleware';

const router = Router();

router.use(authenticate, requireRole('provider'));

router.get('/cnic', verificationController.getCnicStatus);

router.post(
  '/cnic/extract',
  upload.single('front'),
  verificationController.extractCnic
);

router.post(
  '/cnic',
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
  ]),
  verificationController.verifyCnic
);

export default router;
