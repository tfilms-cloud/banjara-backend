import { Types } from 'mongoose';
import { DriverLedgerEntry, type IDriverLedgerEntry } from '../models/DriverLedgerEntry';
import { ProviderProfile } from '../models/ProviderProfile';
import { Trip } from '../models/Trip';
import { IntercitySettings, type IIntercitySettings } from '../models/IntercitySettings';
import type { PayoutChannel } from '../types/payment.types';
import { AppError } from '../utils/AppError';
import { getIntercitySettings } from './intercityFare.service';
import * as notificationService from './notification.service';

/**
 * City to City driver balance. Riders pay drivers the fare in cash; BANJARA's commission
 * (IntercitySettings.commissionPercent of the agreed fare) is owed by the driver for every
 * completed ride. Drivers pay it to BANJARA and report the payment; an admin approves it.
 * A driver owing too much, or for too long, can't take new requests until they pay.
 */

type Limits = Pick<IIntercitySettings, 'maxDriverDue' | 'maxDueDays'>;
type Entry = Pick<IDriverLedgerEntry, 'kind' | 'amount' | 'status' | 'createdAt'>;

export interface BalanceSummary {
  /** Commission owed after approved payments (never negative). */
  owed: number;
  /** Reported payments waiting for an admin. */
  pendingPayments: number;
  /** When the oldest commission not yet covered by approved payments was added. */
  dueSince: Date | null;
  blocked: boolean;
  blockReason: 'over_limit' | 'overdue' | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure: the balance from ledger entries. Approved payments settle the oldest commission
 * first, so `dueSince` is the date of the oldest commission still (partly) unpaid.
 */
export function summarizeBalance(entries: Entry[], limits: Limits, now = new Date()): BalanceSummary {
  const commissions = entries
    .filter((e) => e.kind === 'commission')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const paid = entries
    .filter((e) => e.kind === 'payment' && e.status === 'approved')
    .reduce((sum, e) => sum + e.amount, 0);
  const pendingPayments = entries
    .filter((e) => e.kind === 'payment' && e.status === 'pending')
    .reduce((sum, e) => sum + e.amount, 0);
  const totalCommission = commissions.reduce((sum, e) => sum + e.amount, 0);
  const owed = Math.max(0, totalCommission - paid);

  let covered = paid;
  let dueSince: Date | null = null;
  for (const c of commissions) {
    if (covered >= c.amount) {
      covered -= c.amount;
      continue;
    }
    dueSince = new Date(c.createdAt);
    break;
  }

  const overLimit = owed > limits.maxDriverDue;
  const overdue = !!dueSince && owed > 0 && now.getTime() - dueSince.getTime() > limits.maxDueDays * DAY_MS;
  return {
    owed,
    pendingPayments,
    dueSince: owed > 0 ? dueSince : null,
    blocked: overLimit || overdue,
    blockReason: overLimit ? 'over_limit' : overdue ? 'overdue' : null,
  };
}

/** Commission for one fare, in whole rupees. */
export function commissionFor(fare: number, percent: number) {
  return Math.round((Math.max(0, fare) * Math.max(0, percent)) / 100);
}

async function entriesFor(providerId: string) {
  return DriverLedgerEntry.find({ providerId: new Types.ObjectId(providerId) })
    .sort({ createdAt: -1 })
    .lean<IDriverLedgerEntry[]>();
}

function blockMessage(summary: BalanceSummary, limits: Limits) {
  return summary.blockReason === 'over_limit'
    ? `You owe BANJARA Rs ${summary.owed.toLocaleString('en-PK')} in commission, over the Rs ${limits.maxDriverDue.toLocaleString('en-PK')} limit. Pay your balance to take new City to City rides.`
    : `Your City to City commission has been unpaid for more than ${limits.maxDueDays} days. Pay your balance to take new rides.`;
}

/** The driver's balance screen: what they owe, whether they're blocked, how to pay, history. */
export async function getDriverBalance(providerId: string) {
  const settings = await getIntercitySettings();
  const entries = await entriesFor(providerId);
  const summary = summarizeBalance(entries, settings);
  return {
    ...summary,
    message: summary.blocked ? blockMessage(summary, settings) : null,
    commissionPercent: settings.commissionPercent,
    maxDriverDue: settings.maxDriverDue,
    maxDueDays: settings.maxDueDays,
    payTo: settings.collectionAccounts ?? [],
    entries: entries.slice(0, 100).map(serializeEntry),
  };
}

/** Throws when the driver must pay before taking new City to City requests. */
export async function assertCanTakeRides(providerId: string) {
  const settings = await getIntercitySettings();
  const summary = summarizeBalance(await entriesFor(providerId), settings);
  if (summary.blocked) throw new AppError(blockMessage(summary, settings), 403);
}

/** Which of these drivers must pay before taking new requests (one query for all of them). */
export async function blockedProviderIds(providerIds: string[]): Promise<Set<string>> {
  if (!providerIds.length) return new Set();
  const settings = await getIntercitySettings();
  const entries = await DriverLedgerEntry.find({
    providerId: { $in: providerIds.map((id) => new Types.ObjectId(id)) },
  })
    .select('providerId kind amount status createdAt')
    .lean<IDriverLedgerEntry[]>();
  const byDriver = new Map<string, IDriverLedgerEntry[]>();
  for (const e of entries) {
    const key = String(e.providerId);
    byDriver.set(key, [...(byDriver.get(key) ?? []), e]);
  }
  const blocked = new Set<string>();
  for (const [id, list] of byDriver) if (summarizeBalance(list, settings).blocked) blocked.add(id);
  return blocked;
}

/**
 * Record BANJARA's commission when a City to City booking completes. Idempotent (one entry
 * per booking); other bookings are ignored. The fare is the booking subtotal, i.e. the
 * agreed price after any counter-offer.
 */
export async function recordCommission(booking: {
  _id: unknown;
  providerId: unknown;
  bookingNumber?: string;
  subtotal?: number;
  transportBooking?: { tripId?: unknown; intercity?: unknown } | null;
}) {
  const tripId = booking.transportBooking?.tripId;
  if (!tripId || !booking.transportBooking?.intercity) return null;
  const trip = await Trip.findById(String(tripId)).select('rideType origin destination').lean();
  if (trip?.rideType !== 'intercity') return null;
  const settings = await getIntercitySettings();
  const fare = Number(booking.subtotal ?? 0);
  const amount = commissionFor(fare, settings.commissionPercent);
  if (amount <= 0) return null;
  try {
    return await DriverLedgerEntry.create({
      providerId: new Types.ObjectId(String(booking.providerId)),
      kind: 'commission',
      status: 'posted',
      amount,
      fare,
      percent: settings.commissionPercent,
      bookingId: new Types.ObjectId(String(booking._id)),
      bookingNumber: booking.bookingNumber,
      route: `${trip.origin} → ${trip.destination}`,
    });
  } catch (err) {
    // Already recorded for this booking.
    if ((err as { code?: number }).code === 11000) return null;
    throw err;
  }
}

/** The driver reports paying BANJARA; it counts once an admin approves it. */
export async function submitPayment(
  providerId: string,
  input: { amount: number; channel: PayoutChannel; reference: string; note?: string }
) {
  const settings = await getIntercitySettings();
  const summary = summarizeBalance(await entriesFor(providerId), settings);
  const amount = Math.round(input.amount);
  if (!(amount > 0)) throw new AppError('Enter the amount you paid.', 422);
  const unclaimed = summary.owed - summary.pendingPayments;
  if (unclaimed <= 0) {
    throw new AppError(
      summary.owed > 0
        ? 'Your payments already cover your balance and are waiting for approval.'
        : 'You have no City to City commission to pay.',
      409
    );
  }
  if (amount > unclaimed) {
    throw new AppError(`You can report up to Rs ${unclaimed.toLocaleString('en-PK')} (your balance not yet covered by pending payments).`, 422);
  }
  const reference = input.reference.trim();
  const duplicate = await DriverLedgerEntry.exists({
    kind: 'payment',
    reference,
    status: { $in: ['pending', 'approved'] },
  });
  if (duplicate) throw new AppError('A payment with this transaction ID has already been reported.', 409);
  const entry = await DriverLedgerEntry.create({
    providerId,
    kind: 'payment',
    status: 'pending',
    amount,
    channel: input.channel,
    reference,
    note: input.note?.trim() || undefined,
  });
  return serializeEntry(entry.toObject());
}

/** Admin: reported driver payments (newest first), with each driver's current balance. */
export async function listPayments(status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') {
  const filter: Record<string, unknown> = { kind: 'payment' };
  if (status !== 'all') filter.status = status;
  const payments = await DriverLedgerEntry.find(filter).sort({ createdAt: -1 }).limit(200).lean<IDriverLedgerEntry[]>();
  const providerIds = [...new Set(payments.map((p) => String(p.providerId)))];
  const providers = await ProviderProfile.find({ _id: { $in: providerIds } })
    .select('businessName phone')
    .lean<Array<{ _id: Types.ObjectId; businessName?: string; phone?: string }>>();
  const settings = await getIntercitySettings();
  const balances = new Map<string, BalanceSummary>();
  for (const id of providerIds) balances.set(id, summarizeBalance(await entriesFor(id), settings));
  return payments.map((p) => {
    const provider = providers.find((x) => String(x._id) === String(p.providerId));
    const balance = balances.get(String(p.providerId));
    return {
      ...serializeEntry(p),
      providerId: String(p.providerId),
      driverName: provider?.businessName ?? 'Driver',
      driverPhone: provider?.phone ?? null,
      driverOwed: balance?.owed ?? 0,
      driverBlocked: balance?.blocked ?? false,
    };
  });
}

/** Admin: approve (the payment reduces the balance) or reject a reported payment. */
export async function reviewPayment(adminUserId: string, id: string, decision: 'approve' | 'reject', reason?: string) {
  if (!Types.ObjectId.isValid(id)) throw new AppError('Payment not found', 404);
  const entry = await DriverLedgerEntry.findOneAndUpdate(
    { _id: id, kind: 'payment', status: 'pending' },
    {
      $set: {
        status: decision === 'approve' ? 'approved' : 'rejected',
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        ...(decision === 'reject' ? { rejectionReason: reason?.trim() || 'Payment could not be verified' } : {}),
      },
    },
    { returnDocument: 'after' }
  ).lean<IDriverLedgerEntry>();
  if (!entry) throw new AppError('This payment was already reviewed or does not exist.', 409);

  const provider = await ProviderProfile.findById(entry.providerId).select('userId').lean<{ userId?: Types.ObjectId }>();
  if (provider?.userId) {
    const amount = `Rs ${entry.amount.toLocaleString('en-PK')}`;
    await notificationService
      .createNotification({
        userId: String(provider.userId),
        type: decision === 'approve' ? 'commissionPaymentApproved' : 'commissionPaymentRejected',
        title: decision === 'approve' ? 'Payment received' : 'Payment not verified',
        message:
          decision === 'approve'
            ? `Your ${amount} commission payment (${entry.reference}) was approved.`
            : `Your ${amount} payment (${entry.reference}) could not be verified: ${entry.rejectionReason}.`,
        data: { ledgerEntryId: String(entry._id) },
      })
      .catch(() => undefined);
  }
  return serializeEntry(entry);
}

/** Admin: the commission rules and where drivers pay. */
export async function getCommissionSettings() {
  const s = await getIntercitySettings();
  return {
    commissionPercent: s.commissionPercent,
    maxDriverDue: s.maxDriverDue,
    maxDueDays: s.maxDueDays,
    collectionAccounts: s.collectionAccounts ?? [],
  };
}

export async function updateCommissionSettings(input: {
  commissionPercent?: number;
  maxDriverDue?: number;
  maxDueDays?: number;
  collectionAccounts?: IIntercitySettings['collectionAccounts'];
}) {
  await getIntercitySettings(); // make sure the document exists
  const $set = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  await IntercitySettings.updateOne({ key: 'default' }, { $set }, { runValidators: true });
  return getCommissionSettings();
}

function serializeEntry(e: IDriverLedgerEntry) {
  return {
    id: String(e._id),
    kind: e.kind,
    status: e.status,
    amount: e.amount,
    createdAt: e.createdAt,
    bookingId: e.bookingId ? String(e.bookingId) : null,
    bookingNumber: e.bookingNumber ?? null,
    fare: e.fare ?? null,
    percent: e.percent ?? null,
    route: e.route ?? null,
    channel: e.channel ?? null,
    reference: e.reference ?? null,
    note: e.note ?? null,
    reviewedAt: e.reviewedAt ?? null,
    rejectionReason: e.rejectionReason ?? null,
  };
}
