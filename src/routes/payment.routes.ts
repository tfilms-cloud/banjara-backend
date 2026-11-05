import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  createPaymentAccountSchema,
  completeRefundSchema,
  initiatePaymentSchema,
  reportIssueSchema,
  sendPaymentMessageSchema,
  submitProofSchema,
  updatePaymentAccountSchema,
} from '../validators/payment.validator';

const router = Router();

router.use(authenticate);

/** Customer / provider transaction lists */
router.get('/', paymentController.listMine);

/** Provider payout receiving accounts */
router.get('/accounts/me', requireRole('provider'), paymentController.listAccounts);
router.post(
  '/accounts/me',
  requireRole('provider'),
  validate(createPaymentAccountSchema),
  paymentController.createAccount
);
router.put(
  '/accounts/me/:accountId',
  requireRole('provider'),
  validate(updatePaymentAccountSchema),
  paymentController.updateAccount
);
router.delete(
  '/accounts/me/:accountId',
  requireRole('provider'),
  paymentController.deleteAccount
);

/** Masked active accounts for a provider (customer payment screen) */
router.get(
  '/accounts/provider/:providerId',
  requireRole('customer', 'provider', 'admin'),
  paymentController.listProviderActiveAccounts
);

/** Transaction lifecycle */
router.get('/:id', paymentController.getById);
router.post(
  '/:id/initiate',
  requireRole('customer'),
  validate(initiatePaymentSchema),
  paymentController.initiate
);
router.post('/:id/viewed', requireRole('customer'), paymentController.viewed);
router.post('/:id/attachments/preview', validate(submitProofSchema.pick({ receiptUrls: true })), paymentController.previewDraftFiles);
router.post(
  '/:id/proof',
  requireRole('customer'),
  validate(submitProofSchema),
  paymentController.submitProof
);
router.post(
  '/:id/confirm',
  requireRole('provider', 'admin'),
  paymentController.confirm
);
router.post(
  '/:id/report-issue',
  requireRole('provider', 'admin'),
  validate(reportIssueSchema),
  paymentController.reportIssue
);
router.post('/:id/refund', requireRole('admin', 'provider'), paymentController.refund);
router.post('/:id/refund/complete', requireRole('admin', 'provider'), validate(completeRefundSchema), paymentController.completeRefund);

/** Payment / transaction chat */
router.get(
  '/:id/messages',
  requireRole('customer', 'provider', 'admin'),
  paymentController.listMessages
);
router.post(
  '/:id/messages',
  requireRole('customer', 'provider', 'admin'),
  validate(sendPaymentMessageSchema),
  paymentController.sendMessage
);

export default router;
