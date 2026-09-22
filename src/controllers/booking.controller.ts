import { paramId } from '../utils/params';
import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as bookingService from '../services/booking.service';
import * as paymentService from '../services/payment.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await bookingService.createBooking(req.user!.id, req.body), 'Booking created', 201);
  } catch (error) {
    next(error);
  }
}

export async function listMine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await bookingService.getMyBookings(req.user!.id, req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
}

export async function listProvider(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
    return sendSuccess(
      res,
      await bookingService.getProviderBookings(req.user.providerId, req.query as Record<string, unknown>)
    );
  } catch (error) {
    next(error);
  }
}

export async function getById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const booking = await bookingService.getBooking(paramId(req.params.id), req.user);
    return sendSuccess(res, await bookingService.serializeBooking(booking));
  } catch (error) {
    next(error);
  }
}

export async function cancel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await bookingService.cancelBooking(paramId(req.params.id), req.user!), 'Booking cancelled');
  } catch (error) {
    next(error);
  }
}

export async function ticket(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await bookingService.getTicket(paramId(req.params.id), req.user!));
  } catch (error) {
    next(error);
  }
}

export async function earnings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
    return sendSuccess(res, await bookingService.getProviderEarnings(req.user.providerId));
  } catch (error) {
    next(error);
  }
}

export async function updateStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
    const status = req.body?.status as 'confirmed' | 'cancelled' | 'completed' | 'rejected';
    if (!status) throw new AppError('Status is required', 400);
    return sendSuccess(
      res,
      await bookingService.updateProviderBookingStatus(paramId(req.params.id), req.user.providerId, status),
      'Booking status updated'
    );
  } catch (error) {
    next(error);
  }
}

export async function getPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await paymentService.getPayment(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function refundPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await paymentService.refundPayment(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}
