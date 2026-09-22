import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authRateLimiter } from '../middleware/rateLimit.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from '../validators/auth.validator';

const router = Router();

router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);
router.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), authController.resetPassword);

export default router;
