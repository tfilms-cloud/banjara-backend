import mongoose, { Schema, Types } from 'mongoose';
import type { PayoutChannel } from '../types/payment.types';

/**
 * A driver's City to City balance with BANJARA. Riders pay drivers in cash, so BANJARA's
 * commission is owed by the driver:
 *  - `commission`: added when an intercity booking completes (owed, always counts);
 *  - `payment`: the driver reports paying BANJARA; it reduces the balance once an admin
 *    approves it (pending and rejected payments don't count).
 * Balance owed = Σ commission − Σ approved payments.
 */
export type LedgerKind = 'commission' | 'payment';
export type LedgerStatus = 'posted' | 'pending' | 'approved' | 'rejected';

export interface IDriverLedgerEntry {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  kind: LedgerKind;
  /** Always positive, PKR. */
  amount: number;
  status: LedgerStatus;
  /** Commission: the completed booking, its agreed fare and the rate applied. */
  bookingId?: Types.ObjectId;
  bookingNumber?: string;
  fare?: number;
  percent?: number;
  route?: string;
  /** Payment: how the driver paid and the transaction ID they entered. */
  channel?: PayoutChannel;
  reference?: string;
  note?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ledgerSchema = new Schema<IDriverLedgerEntry>(
  {
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true, index: true },
    kind: { type: String, enum: ['commission', 'payment'], required: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['posted', 'pending', 'approved', 'rejected'], required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    bookingNumber: String,
    fare: Number,
    percent: Number,
    route: String,
    channel: { type: String, enum: ['bank', 'easypaisa', 'jazzcash', 'raast', 'other'] },
    reference: { type: String, trim: true, maxlength: 80 },
    note: { type: String, trim: true, maxlength: 300 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    rejectionReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

ledgerSchema.index({ providerId: 1, createdAt: 1 });
ledgerSchema.index({ kind: 1, status: 1, createdAt: -1 });
// A booking's commission is recorded exactly once, even if completion runs twice.
ledgerSchema.index(
  { bookingId: 1, kind: 1 },
  { unique: true, partialFilterExpression: { kind: 'commission' } }
);

export const DriverLedgerEntry = mongoose.model<IDriverLedgerEntry>('DriverLedgerEntry', ledgerSchema);
