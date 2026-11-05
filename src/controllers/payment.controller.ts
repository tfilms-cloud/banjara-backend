import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as paymentService from '../services/payment.service';
import * as payoutAccountService from '../services/providerPaymentAccount.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { paramId } from '../utils/params';

function actor(req: AuthRequest) {
  if (!req.user) throw new AppError('Authentication required', 401);
  return {
    id: req.user.id,
    role: req.user.role,
    providerId: req.user.providerId,
  };
}

export async function listMine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await paymentService.listMyPayments(actor(req), req.query as Record<string, unknown>)
    );
  } catch (error) {
    next(error);
  }
}

export async function getById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await paymentService.getPayment(paramId(req.params.id), actor(req)));
  } catch (error) {
    next(error);
  }
}

export async function initiate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await paymentService.initiateP2PPayment(paramId(req.params.id), actor(req), req.body),
      'Payment instructions ready'
    );
  } catch (error) {
    next(error);
  }
}

export async function viewed(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await paymentService.markInstructionsViewed(paramId(req.params.id), actor(req))
    );
  } catch (error) {
    next(error);
  }
}

export async function previewDraftFiles(req: AuthRequest, res: Response, next: NextFunction) {
  try { return sendSuccess(res, await paymentService.previewDraftFiles(paramId(req.params.id), actor(req), req.body.receiptUrls)); }
  catch (error) { next(error); }
}

export async function submitProof(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await paymentService.submitPaymentProof(paramId(req.params.id), actor(req), req.body),
      'Payment proof submitted'
    );
  } catch (error) {
    next(error);
  }
}

export async function confirm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await paymentService.confirmPayment(paramId(req.params.id), actor(req)),
      'Payment confirmed'
    );
  } catch (error) {
    next(error);
  }
}

export async function reportIssue(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await paymentService.reportPaymentIssue(paramId(req.params.id), actor(req), req.body),
      'Payment issue reported'
    );
  } catch (error) {
    next(error);
  }
}

export async function refund(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await paymentService.refundPayment(paramId(req.params.id), actor(req)));
  } catch (error) {
    next(error);
  }
}

export async function completeRefund(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await paymentService.completeRefund(paramId(req.params.id), actor(req), req.body), 'Manual refund evidence recorded');
  } catch (error) { next(error); }
}

export async function listMessages(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await paymentService.listPaymentMessages(paramId(req.params.id), actor(req))
    );
  } catch (error) {
    next(error);
  }
}

export async function sendMessage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await paymentService.sendPaymentMessage(paramId(req.params.id), actor(req), req.body),
      'Message sent',
      201
    );
  } catch (error) {
    next(error);
  }
}

/** Provider payout accounts */
export async function listAccounts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
    return sendSuccess(res, await payoutAccountService.listAccounts(req.user.providerId));
  } catch (error) {
    next(error);
  }
}

export async function createAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
    return sendSuccess(
      res,
      await payoutAccountService.createAccount(req.user.providerId, req.body),
      'Payment account added',
      201
    );
  } catch (error) {
    next(error);
  }
}

export async function updateAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
    return sendSuccess(
      res,
      await payoutAccountService.updateAccount(
        req.user.providerId,
        paramId(req.params.accountId),
        req.body
      )
    );
  } catch (error) {
    next(error);
  }
}

export async function deleteAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
    return sendSuccess(
      res,
      await payoutAccountService.deleteAccount(req.user.providerId, paramId(req.params.accountId))
    );
  } catch (error) {
    next(error);
  }
}

/** Public active accounts for a provider (masked) — customer payment picker */
export async function listProviderActiveAccounts(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    return sendSuccess(
      res,
      await payoutAccountService.listActiveAccountsForCustomer(paramId(req.params.providerId))
    );
  } catch (error) {
    next(error);
  }
}
