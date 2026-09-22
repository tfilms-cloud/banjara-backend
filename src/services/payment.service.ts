import { Payment } from '../models/Payment';
import { AppError, assertFound } from '../utils/AppError';
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

export async function refundPayment(paymentId: string) {
  const payment = assertFound(await Payment.findById(paymentId), 'Payment not found');
  if (payment.status !== 'paid' && payment.status !== 'pending') {
    throw new AppError('Payment cannot be refunded', 400);
  }
  payment.status = 'refunded';
  await payment.save();
  return payment;
}

export async function getPayment(id: string) {
  return assertFound(await Payment.findById(id), 'Payment not found');
}
