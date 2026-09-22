import { Router } from 'express';
import * as uploadController from '../controllers/upload.controller';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';
import { uploadRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

router.use(authenticate);
router.post('/', uploadRateLimiter, upload.single('file'), uploadController.uploadSingle);
router.post('/multiple', uploadRateLimiter, upload.array('files', 8), uploadController.uploadMultiple);

export default router;
