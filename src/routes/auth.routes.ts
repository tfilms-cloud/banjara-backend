import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authRateLimiter } from '../middleware/rateLimit.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  forgotPasswordSchema,
  loginMfaSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  twoFactorDisableSchema,
  twoFactorEnableSchema,
} from '../validators/auth.validator';

const router = Router();

router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.post('/login/2fa', authRateLimiter, validate(loginMfaSchema), authController.loginMfa);
router.post('/refresh', validate(refreshSchema), authController.refresh);
// No `authenticate`: logout must also work with an expired access token (see controller).
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);
router.post('/logout-all', authenticate, authController.logoutAll);
router.get('/sessions', authenticate, authController.listSessions);
router.delete('/sessions/:id', authenticate, authController.revokeSession);
router.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), authController.resetPassword);

// 2-step verification. Admin accounts only for now: the traveller site and the
// mobile app do not have a code step at sign-in yet.
const admin2fa = [authenticate, requireRole('admin')];
router.get('/2fa', ...admin2fa, authController.twoFactorStatus);
router.post('/2fa/setup', ...admin2fa, authRateLimiter, authController.twoFactorSetup);
router.post('/2fa/enable', ...admin2fa, authRateLimiter, validate(twoFactorEnableSchema), authController.twoFactorEnable);
router.post('/2fa/disable', ...admin2fa, authRateLimiter, validate(twoFactorDisableSchema), authController.twoFactorDisable);

export default router;
