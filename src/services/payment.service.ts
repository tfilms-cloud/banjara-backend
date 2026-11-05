import type { ClientSession } from 'mongoose';
import { createHash } from 'node:crypto';
import { paymentTransaction } from '../utils/paymentTransaction';
import { assertOwnedPaymentFiles, signPaymentFile } from './paymentFiles.service';
import { Trip } from '../models/Trip';
import * as hotelService from './hotel.service';
import { Payment } from '../models/Payment';
import { PaymentMessage } from '../models/PaymentMessage';
import { Booking } from '../models/Booking';
import { AppError, assertFound } from '../utils/AppError';
import type { UserRole } from '../types/auth.types';
import {
  channelForMethod,
  generateTxnCode,
  isP2PMethod,
  maskIdentifier,
  type PaymentIssueReason,
  type PaymentMethod,
  type PaymentStatus,
  type PaymentTimelineEvent,
  type PaymentTimelineEventType,
} from '../types/payment.types';
import { ProviderProfile } from '../models/ProviderProfile';
import { User } from '../models/User';
import * as payoutAccounts from './providerPaymentAccount.service';
import * as notificationService from './notification.service';
import { confirmTripSeats, releaseTripSeats } from './tripSeat.service';
import { buildTicketQrDataUrl } from '../utils/qrCode';
import { log } from '../utils/logger';

const DEFAULT_PROOF_WINDOW_MINUTES = 30;

export interface PaymentActor {
  id: string;
  role: UserRole;
  providerId?: string;
}

function pushEvent(
  payment: InstanceType<typeof Payment>,
  type: PaymentTimelineEventType,
  message: string,
  actor?: { role?: PaymentTimelineEvent['actorRole']; id?: string },
  meta?: Record<string, unknown>
) {
  payment.timeline = payment.timeline ?? [];
  payment.timeline.push({
    type,
    message,
    actorRole: actor?.role ?? 'system',
    actorId: actor?.id,
    meta,
    at: new Date(),
  });
}

/** Create an unpaid payment record; this never verifies receipt of funds. */
export async function createPayment(input: {
  bookingId: string;
  customerId: string;
  providerId: string;
  amount: number;
  method: PaymentMethod;
  currency?: string;
}) {
  assertSupportedPaymentMethod(input.method);
  const txn = generateTxnCode();
  const payment = await Payment.create({
    bookingId: input.bookingId,
    customerId: input.customerId,
    providerId: input.providerId,
    amount: input.amount,
    currency: input.currency ?? 'PKR',
    method: input.method,
    status: isP2PMethod(input.method) ? 'unpaid' : 'pending',
    transactionId: txn,
    expiresAt: isP2PMethod(input.method)
      ? new Date(Date.now() + DEFAULT_PROOF_WINDOW_MINUTES * 60 * 1000)
      : undefined,
    timeline: [
      {
        type: 'booking_created',
        message: 'Booking created — awaiting payment',
        actorRole: 'system',
        at: new Date(),
      },
    ],
  });
  return payment;
}

export function assertSupportedPaymentMethod(method: PaymentMethod) {
  if (!isP2PMethod(method) && method !== 'cash' && method !== 'payAtHotel') {
    throw new AppError('Card and gateway wallet payments are not available yet. Choose a bank or wallet transfer.', 422);
  }
}

/** Pay-later remains pending; no gateway payment may be auto-approved. */
export async function verifyPayment(paymentId: string) {
  const payment = assertFound(await Payment.findById(paymentId), 'Payment not found');
  assertSupportedPaymentMethod(payment.method);
  return payment;
}

async function loadVisiblePayment(id: string, actor: PaymentActor, session?: ClientSession) {
  const payment = assertFound(await Payment.findById(id).session(session ?? null), 'Payment not found');

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

async function serializePayment(
  payment: InstanceType<typeof Payment>,
  opts?: { revealAccount?: boolean }
) {
  const plain = payment.toObject();
  const account = plain.receivingAccount
    ? {
        ...plain.receivingAccount,
        identifier: opts?.revealAccount
          ? plain.receivingAccount.identifier
          : undefined,
        displayIdentifier:
          plain.receivingAccount.displayIdentifier ||
          maskIdentifier(
            plain.receivingAccount.channel,
            plain.receivingAccount.identifier || ''
          ),
      }
    : undefined;

  return {
    id: payment._id.toString(),
    bookingId: payment.bookingId.toString(),
    customerId: payment.customerId.toString(),
    providerId: payment.providerId.toString(),
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    transactionId: payment.transactionId,
    receivingAccount: account,
    expiresAt: payment.expiresAt,
    proof: payment.proof ? {
      ...plain.proof,
      receiptUrls: await Promise.all(payment.proof.receiptUrls.map(signPaymentFile)),
    } : undefined,
    refund: payment.refund ? {
      ...payment.refund,
      receiptUrls: await Promise.all(payment.refund.receiptUrls.map(signPaymentFile)),
    } : undefined,
    amountMismatch: Boolean(payment.proof && Math.round(payment.proof.paidAmount * 100) !== Math.round(payment.amount * 100)),
    issueReason: payment.issueReason,
    issueNote: payment.issueNote,
    timeline: payment.timeline ?? [],
    paidAt: payment.paidAt,
    confirmedAt: payment.confirmedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/** All money, booking and seat transitions share one database transaction. */
async function activeBooking(payment: InstanceType<typeof Payment>, session: ClientSession) {
  const booking = assertFound(await Booking.findById(payment.bookingId).session(session), 'Booking not found');
  if (!['pending', 'payment_verification', 'disputed'].includes(booking.bookingStatus) ||
      booking.paymentId?.toString() !== payment._id.toString()) {
    throw new AppError('This booking can no longer accept payment. Create a new booking, or contact support if you already paid.', 409);
  }
  return booking;
}

async function assertSeatHold(booking: InstanceType<typeof Booking>, session: ClientSession) {
  if (booking.bookingType !== 'transport' || !booking.transportBooking) return;
  const { tripId, seats } = booking.transportBooking;
  const trip = await Trip.findOne({ _id: tripId, status: { $ne: 'cancelled' },
    $and: seats.map(seatNumber => ({ seatLayout: { $elemMatch: { seatNumber, status: 'reserved' } } }))
  }).session(session);
  if (!trip) throw new AppError('The seat reservation is no longer available. Contact support if you already paid.', 409);
}

async function systemMessage(payment: InstanceType<typeof Payment>, text: string, session: ClientSession) {
  await PaymentMessage.create([{ paymentId: payment._id, bookingId: payment.bookingId,
    senderRole: 'system', kind: 'system', text,
    readByCustomer: false, readByProvider: false }], { session });
}

export async function refundPaymentAsSystem(id: string, session?: ClientSession): Promise<InstanceType<typeof Payment>> {
  if (!session) return paymentTransaction(tx => refundPaymentAsSystem(id, tx));
  const payment = assertFound(await Payment.findById(id).session(session), 'Payment not found');
  if (['refunded', 'refund_pending', 'failed', 'expired'].includes(payment.status)) return payment;
  // Evidence of payment requires reconciliation; an unpaid attempt needs no refund.
  payment.status = ['paid', 'confirmed'].includes(payment.status) || payment.proof ? 'refund_pending' : 'failed';
  pushEvent(payment, payment.status === 'refund_pending' ? 'refund_requested' : 'resolved',
    payment.status === 'refund_pending' ? 'Refund pending: provider must return funds and record evidence' : 'Unpaid payment attempt closed');
  await payment.save({ session });
  await Booking.updateOne({ _id: payment.bookingId }, { $set: { paymentStatus: payment.status } }, { session });
  return payment;
}

export async function refundPayment(id: string, actor: PaymentActor) {
  const current = await loadVisiblePayment(id, actor);
  if (actor.role === 'customer') throw new AppError('Contact support to request a refund', 403);
  if (!['paid', 'confirmed', 'refund_pending', 'refunded'].includes(current.status) && !current.proof) {
    throw new AppError('No received payment or payment proof to refund. Cancel the unpaid booking instead.', 409);
  }
  const payment = await paymentTransaction(session => refundPaymentAsSystem(id, session));
  await notifyCounterpart(payment, 'customer', 'Refund pending', 'The provider started a manual refund. Open your payment for details.');
  return serializePayment(payment);
}

export async function completeRefund(id: string, actor: PaymentActor, input: { referenceNumber: string; receiptUrls: string[] }) {
  if (!['provider', 'admin'].includes(actor.role)) throw new AppError('Only the provider or admin can record a refund', 403);
  await loadVisiblePayment(id, actor);
  await assertOwnedPaymentFiles(input.receiptUrls, actor.id);
  const payment = await paymentTransaction(async session => {
    const p = await loadVisiblePayment(id, actor, session);
    if (p.status === 'refunded' && p.refund?.referenceNumber === input.referenceNumber.trim()) return p;
    if (p.status !== 'refund_pending') throw new AppError('No refund is pending', 409);
    p.status = 'refunded';
    p.refund = { referenceNumber: input.referenceNumber.trim(), receiptUrls: input.receiptUrls,
      recordedAt: new Date(), recordedBy: actor.id };
    pushEvent(p, 'refunded', 'Provider recorded a manual refund with transfer evidence', { role: actor.role, id: actor.id });
    await p.save({ session });
    await Booking.updateOne({ _id: p.bookingId }, { $set: { paymentStatus: 'refunded' } }, { session });
    await systemMessage(p, 'Provider recorded a refund. Check your account and contact support if it has not arrived.', session);
    return p;
  });
  await notifyCounterpart(payment, 'customer', 'Refund evidence recorded', 'The provider recorded a refund transfer. Please check your bank or wallet.');
  return serializePayment(payment);
}

export async function getPayment(id: string, actor: PaymentActor) {
  const payment = await loadVisiblePayment(id, actor);
  const reveal = actor.role === 'customer' && ['unpaid', 'payment_initiated', 'proof_submitted', 'under_review', 'rejected'].includes(payment.status);
  const booking = await Booking.findById(payment.bookingId).lean();
  const provider = await ProviderProfile.findById(payment.providerId).select('businessName').lean();
  const trip = booking?.transportBooking ? await Trip.findById(booking.transportBooking.tripId).select('origin destination departureDate departureTime').lean() : null;
  return {
    ...await serializePayment(payment, { revealAccount: reveal || actor.role === 'admin' }),
    summary: booking ? {
      bookingNumber: booking.bookingNumber, service: booking.bookingType,
      providerName: provider?.businessName || 'Service provider',
      title: trip ? `${trip.origin} → ${trip.destination}` : booking.packageBooking?.title || booking.guideBooking?.serviceName || 'Hotel stay',
      date: trip ? `${trip.departureDate} ${trip.departureTime}` : booking.hotelBooking ? `${booking.hotelBooking.checkIn} – ${booking.hotelBooking.checkOut}` : booking.packageBooking?.startDate || booking.guideBooking?.date,
      subtotal: booking.subtotal, tax: booking.tax, serviceFee: booking.serviceFee, discount: booking.discount,
    } : undefined,
  };
}

export async function initiateP2PPayment(paymentId: string, actor: PaymentActor, input: { method: PaymentMethod; accountId: string }) {
  if (actor.role !== 'customer') throw new AppError('Only the customer can start payment', 403);
  await loadVisiblePayment(paymentId, actor);
  const payment = await paymentTransaction(async session => {
    const p = await loadVisiblePayment(paymentId, actor, session);
    const booking = await activeBooking(p, session);
    if (!isP2PMethod(input.method)) throw new AppError('Choose a transfer payment method', 400);
    if (!['unpaid', 'pending', 'payment_initiated', 'rejected'].includes(p.status) ||
        (p.expiresAt && p.expiresAt.getTime() <= Date.now())) {
      throw new AppError('Payment window ended. Create a new booking; contact support if you already paid.', 409);
    }
    await assertSeatHold(booking, session);
    if (p.status === 'payment_initiated' && p.receivingAccount?.accountId === input.accountId && p.method === input.method) return p;
    const account = await payoutAccounts.getAccountForPayment(p.providerId.toString(), input.accountId, channelForMethod(input.method)!);
    p.method = input.method;
    p.status = 'payment_initiated';
    // Never extend the inventory hold by reopening payment instructions.
    p.expiresAt = p.expiresAt ?? new Date(Date.now() + DEFAULT_PROOF_WINDOW_MINUTES * 60_000);
    p.receivingAccount = { accountId: account._id.toString(), channel: account.channel,
      label: account.label, accountTitle: account.accountTitle,
      displayIdentifier: maskIdentifier(account.channel, account.identifier), identifier: account.identifier,
      bankName: account.bankName, instructions: account.instructions };
    pushEvent(p, 'payment_method_selected', 'Transfer instructions prepared', { role: 'customer', id: actor.id });
    booking.paymentStatus = 'payment_initiated';
    await booking.save({ session });
    await p.save({ session });
    return p;
  });
  return serializePayment(payment, { revealAccount: true });
}

export async function markInstructionsViewed(paymentId: string, actor: PaymentActor) {
  // GET/polling must not change financial state or append unbounded timeline events.
  return getPayment(paymentId, actor);
}

export async function previewDraftFiles(paymentId: string, actor: PaymentActor, references: string[]) {
  await loadVisiblePayment(paymentId, actor);
  await assertOwnedPaymentFiles(references, actor.id);
  return Promise.all(references.map(async storageRef => ({ storageRef, url: await signPaymentFile(storageRef) })));
}

export async function submitPaymentProof(paymentId: string, actor: PaymentActor, input: {
  receiptUrls: string[]; referenceNumber: string; paidAmount: number; paidAt?: string | Date; note?: string;
}) {
  if (actor.role !== 'customer') throw new AppError('Only the customer can submit proof', 403);
  await loadVisiblePayment(paymentId, actor);
  await assertOwnedPaymentFiles(input.receiptUrls, actor.id);
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (!Number.isFinite(paidAt.getTime()) || paidAt.getTime() > Date.now() + 60_000) throw new AppError('Invalid payment date', 422);
  let payment;
  try {
    payment = await paymentTransaction(async session => {
      const p = await loadVisiblePayment(paymentId, actor, session);
      const booking = await activeBooking(p, session);
      if (!['payment_initiated', 'rejected'].includes(p.status) || !p.receivingAccount || !isP2PMethod(p.method)) {
        throw new AppError('Open payment instructions before submitting proof, or refresh the payment status', 409);
      }
      if (p.expiresAt && p.expiresAt.getTime() <= Date.now()) {
        // The expiry worker owns cleanup. Do not mark expired here and skip inventory release.
        throw new AppError('Payment window expired. Contact support if you already transferred money.', 409);
      }
      await assertSeatHold(booking, session);
      const reference = input.referenceNumber.trim();
      if (reference.length < 3 || !Number.isFinite(input.paidAmount) || input.paidAmount <= 0 || !input.receiptUrls.length) {
        throw new AppError('Receipt, reference and a valid paid amount are required', 422);
      }
      p.referenceKey = createHash('sha256').update([p.providerId, p.receivingAccount.channel,
        p.receivingAccount.identifier, reference.toUpperCase().replace(/[^A-Z0-9]/g, '')].join('|')).digest('hex');
      p.proof = { receiptUrls: input.receiptUrls, referenceNumber: reference,
        paidAmount: input.paidAmount, paidAt, note: input.note?.trim(), submittedAt: new Date() };
      p.status = 'proof_submitted';
      p.issueReason = undefined;
      p.issueNote = undefined;
      pushEvent(p, 'proof_submitted', 'Receipt submitted; awaiting confirmation of funds', { role: 'customer', id: actor.id });
      await p.save({ session });
      booking.paymentStatus = 'proof_submitted';
      booking.bookingStatus = 'payment_verification';
      await booking.save({ session });
      await PaymentMessage.create([{ paymentId: p._id, bookingId: p.bookingId, senderRole: 'customer',
        senderId: actor.id, kind: 'reference', text: input.note?.trim() || 'Payment proof submitted.',
        referenceNumber: reference, imageUrl: input.receiptUrls[0], readByCustomer: true, readByProvider: false }], { session });
      return p;
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new AppError('This transaction reference was already used for another booking. Contact support if needed.', 409);
    throw error;
  }
  await notifyCounterpart(payment, 'provider', 'Payment proof ready', 'A customer submitted payment proof for review.');
  return serializePayment(payment, { revealAccount: true });
}

export async function confirmPayment(paymentId: string, actor: PaymentActor) {
  if (!['provider', 'admin'].includes(actor.role)) throw new AppError('Only the provider or admin can confirm payment', 403);
  await loadVisiblePayment(paymentId, actor);
  const payment = await paymentTransaction(async session => {
    const p = await loadVisiblePayment(paymentId, actor, session);
    if (p.status === 'confirmed') return p;
    const booking = await activeBooking(p, session);
    if (!['proof_submitted', 'under_review', 'disputed'].includes(p.status) || !p.proof) throw new AppError('Payment is not awaiting confirmation', 409);
    if (Math.round(p.proof.paidAmount * 100) !== Math.round(p.amount * 100)) {
      throw new AppError('The paid amount differs from the booking total. Report the issue and resolve it before confirming.', 409);
    }
    await assertSeatHold(booking, session);
    if (booking.bookingType === 'transport' && booking.transportBooking) {
      await confirmTripSeats(booking.transportBooking.tripId, booking.transportBooking.seats, session);
    }
    p.status = 'confirmed'; p.paidAt = p.proof.paidAt; p.confirmedAt = new Date(); p.confirmedBy = actor.id as never;
    pushEvent(p, 'payment_confirmed', 'Provider confirmed funds received', { role: actor.role, id: actor.id });
    booking.paymentStatus = 'paid'; booking.bookingStatus = 'confirmed';
    booking.ticketQr = booking.ticketQr || buildTicketQrDataUrl(booking.bookingNumber);
    await p.save({ session }); await booking.save({ session });
    await systemMessage(p, 'Payment received. Booking confirmed.', session);
    return p;
  });
  await notifyCounterpart(payment, 'customer', 'Payment confirmed', 'Your payment was confirmed and your booking is ready.');
  return serializePayment(payment);
}

export async function reportPaymentIssue(paymentId: string, actor: PaymentActor, input: { reason: PaymentIssueReason; note?: string }) {
  if (!['provider', 'admin'].includes(actor.role)) throw new AppError('Only the provider or admin can report an issue', 403);
  await loadVisiblePayment(paymentId, actor);
  const payment = await paymentTransaction(async session => {
    const p = await loadVisiblePayment(paymentId, actor, session);
    const booking = await activeBooking(p, session);
    if (!['proof_submitted', 'under_review'].includes(p.status)) throw new AppError('No payment proof to dispute', 409);
    p.status = 'rejected'; p.issueReason = input.reason; p.issueNote = input.note?.trim();
    // Give the customer a bounded correction window while retaining the original hold.
    p.expiresAt = new Date(Date.now() + DEFAULT_PROOF_WINDOW_MINUTES * 60_000);
    pushEvent(p, 'payment_issue_reported', 'Provider requested a payment correction', { role: actor.role, id: actor.id }, { reason: input.reason, note: input.note });
    booking.paymentStatus = 'rejected';
    await p.save({ session }); await booking.save({ session });
    await systemMessage(p, 'Payment issue: ' + input.reason.replace(/_/g, ' ') + (input.note ? ' — ' + input.note : ''), session);
    return p;
  });
  await notifyCounterpart(payment, 'customer', 'Payment needs attention', input.note || 'Open your payment to see the issue reported by the provider.');
  return serializePayment(payment);
}

async function notifyCounterpart(payment: InstanceType<typeof Payment>, target: 'customer' | 'provider', title: string, message: string) {
  try {
    const provider = target === 'provider' ? await ProviderProfile.findById(payment.providerId).select('userId').lean() : null;
    const userId = target === 'customer' ? payment.customerId.toString() : provider?.userId?.toString();
    if (userId) await notificationService.notifyUser({ userId, type: 'newMessage', title, message,
      data: { paymentId: payment._id.toString(), bookingId: payment.bookingId.toString() } });
    return Boolean(userId);
  } catch (err) { log().error({ err, paymentId: payment._id.toString() }, '[payment] notification failed'); return false; }
}

export async function listMyPayments(actor: PaymentActor, query: Record<string, unknown> = {}) {
  const filter: Record<string, unknown> = {};
  if (actor.role === 'customer') filter.customerId = actor.id;
  else if (actor.role === 'provider') {
    if (!actor.providerId) return [];
    filter.providerId = actor.providerId;
  } else if (actor.role !== 'admin') return [];

  if (typeof query.status === 'string' && query.status.trim()) {
    filter.status = query.status.trim();
  }

  const rows = await Payment.find(filter).sort({ createdAt: -1 }).limit(100);
  return Promise.all(rows.map((row) => serializePayment(row)));
}

export async function expireStalePayments() {
  const stale = await Payment.find({ status: { $in: ['payment_initiated', 'unpaid', 'rejected'] }, expiresAt: { $lte: new Date() } }).select('_id').limit(100);
  let expired = 0;
  let notified = 0;
  for (const row of stale) {
    const payment = await paymentTransaction(async session => {
      const p = await Payment.findById(row._id).session(session);
      if (!p || !['payment_initiated', 'unpaid', 'rejected'].includes(p.status) || !p.expiresAt || p.expiresAt.getTime() > Date.now()) return null;
      const booking = await Booking.findById(p.bookingId).session(session);
      if (!booking || !['pending', 'payment_verification'].includes(booking.bookingStatus)) return null;
      p.status = 'expired'; pushEvent(p, 'expired', 'Payment window ended; booking hold released');
      booking.paymentStatus = 'expired'; booking.bookingStatus = 'expired';
      await p.save({ session }); await booking.save({ session });
      if (booking.bookingType === 'transport' && booking.transportBooking) {
        await releaseTripSeats(booking.transportBooking.tripId, booking.transportBooking.seats, session);
      }
      if (booking.bookingType === 'hotel' && booking.hotelBooking) {
        const h = booking.hotelBooking;
        await hotelService.releaseRoomsForRange(h.roomId, h.checkIn, h.checkOut, h.rooms, session);
      }
      return p;
    });
    if (payment) {
      expired++;
      if (await notifyCounterpart(payment, 'customer', 'Payment window expired', 'Your reservation hold ended. If you already transferred money, open the payment chat for help.')) notified++;
    }
  }
  return { expired, notified };
}

async function serializeMessage(doc: InstanceType<typeof PaymentMessage>) {
  return {
    id: doc._id.toString(),
    paymentId: doc.paymentId.toString(),
    bookingId: doc.bookingId.toString(),
    senderRole: doc.senderRole,
    senderId: doc.senderId ? doc.senderId.toString() : undefined,
    kind: doc.kind,
    text: doc.text,
    imageUrl: doc.imageUrl ? await signPaymentFile(doc.imageUrl) : undefined,
    referenceNumber: doc.referenceNumber,
    readByCustomer: doc.readByCustomer,
    readByProvider: doc.readByProvider,
    createdAt: doc.createdAt,
  };
}

export async function listPaymentMessages(paymentId: string, actor: PaymentActor) {
  const payment = await loadVisiblePayment(paymentId, actor);
  const rows = await PaymentMessage.find({ paymentId: payment._id }).sort({ createdAt: 1 }).limit(200);

  if (actor.role === 'customer') {
    await PaymentMessage.updateMany(
      { paymentId: payment._id, readByCustomer: false },
      { $set: { readByCustomer: true } }
    );
  } else if (actor.role === 'provider') {
    await PaymentMessage.updateMany(
      { paymentId: payment._id, readByProvider: false },
      { $set: { readByProvider: true } }
    );
  }

  return Promise.all(rows.map(serializeMessage));
}

export async function sendPaymentMessage(
  paymentId: string,
  actor: PaymentActor,
  input: { text?: string; imageUrl?: string; referenceNumber?: string }
) {
  if (!['customer', 'provider', 'admin'].includes(actor.role)) {
    throw new AppError('Not allowed to message on this payment', 403);
  }
  const payment = await loadVisiblePayment(paymentId, actor);
  if (input.imageUrl) await assertOwnedPaymentFiles([input.imageUrl], actor.id);
  const text = input.text?.trim();
  if (!text && !input.imageUrl && !input.referenceNumber) {
    throw new AppError('Enter a message or attach an image', 400);
  }

  const kind = input.imageUrl
    ? 'image'
    : input.referenceNumber
      ? 'reference'
      : 'text';

  const doc = await PaymentMessage.create({
    paymentId: payment._id,
    bookingId: payment.bookingId,
    senderRole: actor.role === 'admin' ? 'admin' : actor.role,
    senderId: actor.id,
    kind,
    text,
    imageUrl: input.imageUrl,
    referenceNumber: input.referenceNumber?.trim(),
    readByCustomer: actor.role === 'customer',
    readByProvider: actor.role === 'provider',
  });

  pushEvent(payment, 'message', text || 'Attachment sent', {
    role: actor.role === 'admin' ? 'admin' : actor.role === 'provider' ? 'provider' : 'customer',
    id: actor.id,
  });
  await payment.save();

  // Notify the counterpart so payment chat isn't silent.
  void (async () => {
    try {
      let recipientId: string | undefined;
      if (actor.role === 'customer') {
        const provider = await ProviderProfile.findById(payment.providerId).select('userId').lean();
        recipientId = provider?.userId?.toString();
      } else {
        recipientId = payment.customerId.toString();
      }
      if (!recipientId || recipientId === actor.id) return;

      const sender = await User.findById(actor.id).select('name').lean();
      const preview = text
        ? text.length > 140
          ? `${text.slice(0, 137)}…`
          : text
        : input.imageUrl
          ? 'Sent a photo'
          : input.referenceNumber
            ? `Reference: ${input.referenceNumber.trim()}`
            : 'New payment message';

      await notificationService.notifyUser({
        userId: recipientId,
        type: 'newMessage',
        title: sender?.name?.trim() || 'Payment chat',
        message: preview,
        data: {
          bookingId: payment.bookingId.toString(),
          paymentId: payment._id.toString(),
          senderId: actor.id,
          otherUserId: actor.id,
        },
      });
    } catch (err) {
      log().error({ paymentId: payment._id.toString(), err }, '[payment] chat notification failed');
    }
  })();

  return serializeMessage(doc);
}
