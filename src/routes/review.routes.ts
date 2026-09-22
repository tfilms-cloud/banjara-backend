import { Router } from 'express';
import * as misc from '../controllers/misc.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { createReviewSchema, replyReviewSchema, updateReviewSchema } from '../validators/review.validator';

const router = Router();

router.get('/provider/:providerId', misc.listProviderReviews);
router.post('/', authenticate, requireRole('customer'), validate(createReviewSchema), misc.createReview);
router.put('/:id', authenticate, requireRole('customer'), validate(updateReviewSchema), misc.updateReview);
router.post('/:id/reply', authenticate, requireRole('provider'), validate(replyReviewSchema), misc.replyReview);

export default router;
