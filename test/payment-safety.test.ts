import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { Booking } from '../src/models/Booking';
import { Payment } from '../src/models/Payment';
import { Trip } from '../src/models/Trip';
import { ProviderPaymentAccount } from '../src/models/ProviderPaymentAccount';
import { clearDatabase, ensureIndexes, setupTestDb, teardownTestDb } from './helpers/db';
import * as payments from '../src/services/payment.service';
import { cancelBooking, createBooking } from '../src/services/booking.service';

// Storage and push delivery are outside these database consistency tests.
vi.mock('../src/services/paymentFiles.service', () => ({
  assertOwnedPaymentFiles: vi.fn().mockResolvedValue(undefined),
  signPaymentFile: vi.fn(async (ref: string) => `https://private.example/${encodeURIComponent(ref)}?expires=900`),
}));
vi.mock('../src/services/notification.service', () => ({ notifyUser: vi.fn(), createNotification: vi.fn() }));

const oid = () => new mongoose.Types.ObjectId();
async function fixture(status = 'payment_initiated', options: { expired?: boolean; seatStatus?: string; amount?: number; bookingStatus?: string; customerId?: mongoose.Types.ObjectId; providerId?: mongoose.Types.ObjectId } = {}) {
  const customerId = options.customerId ?? oid(), providerId = options.providerId ?? oid();
  const account = await ProviderPaymentAccount.create({ providerId, channel: 'bank', label: 'Business', accountTitle: 'Test Provider', identifier: '123456789012', bankName: 'Test Bank', active: true });
  const trip = await Trip.create({ providerId, vehicleId: oid(), origin: 'Islamabad', destination: 'Gilgit', departureDate: '2030-01-01', departureTime: '08:00', price: 1000,
    totalSeats: 1, availableSeats: options.seatStatus === 'available' ? 1 : 0, bookedSeats: options.seatStatus === 'available' ? 0 : 1,
    seatLayout: [{ seatNumber: 'A1', row: 1, column: 1, status: options.seatStatus ?? 'reserved', type: 'standard' }] });
  const booking = await Booking.create({ bookingNumber: `B-${oid()}`, customerId, providerId, bookingType: 'transport', subtotal: 1000, totalAmount: 1000,
    bookingStatus: options.bookingStatus ?? 'pending', paymentStatus: status,
    transportBooking: { tripId: trip._id.toString(), seats: ['A1'], passengerDetails: [{ name: 'Passenger' }] } });
  const reference = `payment-file:payments/${customerId}/00000000-0000-4000-8000-000000000001.jpg`;
  const payment = await Payment.create({ bookingId: booking._id, customerId, providerId, amount: 1000, method: 'bankTransfer', status,
    expiresAt: new Date(Date.now() + (options.expired ? -10000 : 60000)),
    receivingAccount: { accountId: account._id.toString(), channel: 'bank', label: 'Business', accountTitle: 'Test Provider', identifier: account.identifier },
    ...(['proof_submitted', 'confirmed', 'under_review'].includes(status) ? { proof: { receiptUrls: [reference], referenceNumber: 'ABC123', paidAmount: options.amount ?? 1000, paidAt: new Date(), submittedAt: new Date() } } : {}),
  });
  booking.paymentId = payment._id; await booking.save();
  return { payment, booking, trip, account, reference,
    customer: { id: customerId.toString(), role: 'customer' as const },
    provider: { id: oid().toString(), providerId: providerId.toString(), role: 'provider' as const } };
}

describe('Payment safety and state transitions', () => {
  beforeAll(async () => { await setupTestDb(); await ensureIndexes(); });
  afterAll(teardownTestDb);
  beforeEach(clearDatabase);

  it('rejects card and gateway wallet bookings before creating inventory or money records', async () => {
    for (const method of ['card', 'mobileWallet'] as const) {
      await expect(createBooking(oid().toString(), { bookingType: 'transport', paymentMethod: method })).rejects.toMatchObject({ statusCode: 422 });
    }
    expect(await Payment.countDocuments()).toBe(0);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('never restarts an expired booking or extends an existing hold', async () => {
    const f = await fixture();
    const before = f.payment.expiresAt!.getTime();
    await payments.initiateP2PPayment(f.payment.id, f.customer, { method: 'bankTransfer', accountId: f.account.id });
    expect((await Payment.findById(f.payment.id))!.expiresAt!.getTime()).toBe(before);
    await Payment.updateOne({ _id: f.payment._id }, { status: 'expired' });
    await Booking.updateOne({ _id: f.booking._id }, { bookingStatus: 'expired' });
    await expect(payments.initiateP2PPayment(f.payment.id, f.customer, { method: 'bankTransfer', accountId: f.account.id })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('does not expire a confirmed payment when proof is submitted late', async () => {
    const f = await fixture('confirmed', { expired: true, bookingStatus: 'confirmed', seatStatus: 'booked' });
    await expect(payments.submitPaymentProof(f.payment.id, f.customer, { receiptUrls: [f.reference], referenceNumber: 'REF123', paidAmount: 1000 })).rejects.toMatchObject({ statusCode: 409 });
    expect((await Payment.findById(f.payment.id))!.status).toBe('confirmed');
  });

  it('leaves expiry cleanup to the worker and releases inventory once', async () => {
    const f = await fixture('payment_initiated', { expired: true });
    await expect(payments.submitPaymentProof(f.payment.id, f.customer, { receiptUrls: [f.reference], referenceNumber: 'REF123', paidAmount: 1000 })).rejects.toMatchObject({ statusCode: 409 });
    expect((await Payment.findById(f.payment.id))!.status).toBe('payment_initiated');
    await Promise.all([payments.expireStalePayments(), payments.expireStalePayments()]);
    const trip = (await Trip.findById(f.trip.id))!;
    expect(trip.availableSeats).toBe(1); expect(trip.bookedSeats).toBe(0);
    expect((await Booking.findById(f.booking.id))!.bookingStatus).toBe('expired');
  });

  it('blocks confirmation of cancelled bookings and missing seat holds', async () => {
    const cancelled = await fixture('proof_submitted', { bookingStatus: 'cancelled' });
    await expect(payments.confirmPayment(cancelled.payment.id, cancelled.provider)).rejects.toMatchObject({ statusCode: 409 });
    const lostHold = await fixture('proof_submitted', { seatStatus: 'available' });
    await expect(payments.confirmPayment(lostHold.payment.id, lostHold.provider)).rejects.toMatchObject({ statusCode: 409 });
    expect((await Payment.findById(lostHold.payment.id))!.status).toBe('proof_submitted');
  });

  it('requires the exact paid amount and commits valid confirmation atomically', async () => {
    const f = await fixture('proof_submitted', { amount: 999 });
    await expect(payments.confirmPayment(f.payment.id, f.provider)).rejects.toMatchObject({ statusCode: 409 });
    await Payment.updateOne({ _id: f.payment._id }, { 'proof.paidAmount': 1000 });
    await payments.confirmPayment(f.payment.id, f.provider);
    await payments.confirmPayment(f.payment.id, f.provider); // retry is harmless
    expect((await Payment.findById(f.payment.id))!.status).toBe('confirmed');
    expect((await Booking.findById(f.booking.id))!.bookingStatus).toBe('confirmed');
    expect((await Trip.findById(f.trip.id))!.seatLayout[0].status).toBe('booked');
  });

  it('rejects reusing a reference on the same receiving account', async () => {
    const first = await fixture();
    const second = await fixture('payment_initiated', { customerId: first.payment.customerId, providerId: first.payment.providerId });
    const proof = { receiptUrls: [first.reference], referenceNumber: 'REF-123', paidAmount: 1000 };
    await payments.submitPaymentProof(first.payment.id, first.customer, proof);
    await expect(payments.submitPaymentProof(second.payment.id, second.customer, { ...proof, referenceNumber: 'ref123' })).rejects.toMatchObject({ statusCode: 409 });
    expect((await Payment.findById(second.payment.id))!.status).toBe('payment_initiated');
  });

  it('keeps cancellation and confirmation consistent under concurrent requests', async () => {
    const f = await fixture('proof_submitted');
    await Promise.allSettled([payments.confirmPayment(f.payment.id, f.provider), ...Array.from({ length: 4 }, () => cancelBooking(f.booking.id, f.customer, { silent: true }))]);
    expect((await Booking.findById(f.booking.id))!.bookingStatus).toBe('cancelled');
    expect((await Payment.findById(f.payment.id))!.status).toBe('refund_pending');
    const trip = (await Trip.findById(f.trip.id))!;
    expect(trip.availableSeats).toBe(1); expect(trip.bookedSeats).toBe(0);
  });

  it('records pending refunds separately from refund evidence', async () => {
    const f = await fixture('confirmed', { bookingStatus: 'confirmed', seatStatus: 'booked' });
    const pending = await payments.refundPayment(f.payment.id, f.provider);
    expect(pending.status).toBe('refund_pending');
    expect((await Booking.findById(f.booking.id))!.paymentStatus).toBe('refund_pending');
    const completed = await payments.completeRefund(f.payment.id, f.provider, { referenceNumber: 'RETURN123', receiptUrls: [f.reference] });
    expect(completed.status).toBe('refunded'); expect(completed.refund?.referenceNumber).toBe('RETURN123');
  });

  it('returns signed receipts and masked account data without mutating status on read', async () => {
    const f = await fixture('proof_submitted');
    const result = await payments.getPayment(f.payment.id, f.provider);
    expect(result.receivingAccount?.identifier).toBeUndefined();
    expect(JSON.stringify(result.receivingAccount)).not.toContain('123456789012');
    expect(result.proof?.referenceNumber).toBe('ABC123');
    expect(result.proof?.receiptUrls[0]).toContain('https://private.example/');
    expect((await Payment.findById(f.payment.id))!.status).toBe('proof_submitted');
  });
});
