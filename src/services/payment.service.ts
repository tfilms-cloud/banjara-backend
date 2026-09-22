import { Payment } from '../models/Payment';
import { AppError, assertFound } from '../utils/AppError';
import type { UserRole } from '../types/auth.types';
import type { PaymentMethod } from '../types/booking.types';

/** Mock payment gateway — replace with Stripe/JazzCash/etc later. */
export async function createPayment(input: {
  bookingId: string;
  customerId: string;
  providerId: string;
  amount: number;
  method: PaymentMethod;
  currency?: string;
}) {
  return Payment.create({
    bookingId: input.bookingId,
    customerId: input.customerId,
    providerId: input.providerId,
    amount: input.amount,
    currency: input.currency ?? 'PKR',
    method: input.method,
    status: 'pending',
  });
}

export async function verifyPayment(paymentId: string) {
  const payment = assertFound(await Payment.findById(paymentId), 'Payment not found');

  if (payment.method === 'cash' || payment.method === 'payAtHotel') {
    payment.status = 'pending';
    payment.transactionId = `MOCK-CASH-${Date.now()}`;
  } else {
    payment.status = 'paid';
    payment.transactionId = `MOCK-TXN-${Date.now()}`;
    payment.paidAt = new Date();
  }
  await payment.save();
  return payment;
}

export interface PaymentActor {
  id: string;
  role: UserRole;
  providerId?: string;
}

/**
 * Loads a payment the actor is allowed to see, or throws 404.
 *
 * 404 (not 403) for resources the caller may not know exist — a 403 would confirm the
 * id exists and act as an enumeration oracle.
 *
 * `Payment.providerId` references a ProviderProfile, while an actor's user id is a User
 * id — the profile id is resolved by the auth middleware into `req.user.providerId`.
 */
async function loadVisiblePayment(id: string, actor: PaymentActor) {
  const payment = assertFound(await Payment.findById(id), 'Payment not found');

  if (actor.role === 'admin') return payment;
  if (actor.role === 'customer') {
    if (payment.customerId.toString() !== actor.id) throw new AppError('Payment not found', 404);
    return payment;
  }
  if (actor.role === 'provider') {
    if (!actor.providerId || payment.providerId.toString() !== actor.providerId) {
      throw new AppError('Payment not found', 404);
    }
    return payment;
  }
  throw new AppError('Payment not found', 404);
}

async function applyRefund(payment: InstanceType<typeof Payment>) {
  if (payment.status !== 'paid' && payment.status !== 'pending') {
    throw new AppError('Payment cannot be refunded', 400);
  }
  payment.status = 'refunded';
  await payment.save();
  return payment;
}

export async function refundPayment(id: string, actor: PaymentActor) {
  const payment = await loadVisiblePayment(id, actor);
  if (actor.role === 'customer') throw new AppError('You cannot refund payments', 403);
  return applyRefund(payment);
}

/** Trusted internal refund (booking cancellation / rejection). Not user-reachable. */
export async function refundPaymentAsSystem(id: string) {
  const payment = assertFound(await Payment.findById(id), 'Payment not found');
  return applyRefund(payment);
}

export async function getPayment(id: string, actor: PaymentActor) {
  return loadVisiblePayment(id, actor);
}
