import mongoose, { Schema, Types } from 'mongoose';
import type {
  PaymentIssueReason,
  PaymentMethod,
  PaymentProof,
  PaymentStatus,
  PaymentAccountSnapshot,
  PaymentTimelineEvent,
} from '../types/payment.types';

export interface IPayment {
  _id: Types.ObjectId;
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  providerId: Types.ObjectId;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  /** Public transaction code e.g. TXN-… */
  transactionId?: string;
  /** Snapshot of the provider account shown to the customer */
  receivingAccount?: PaymentAccountSnapshot;
  /** Minutes allowed to submit proof after initiation */
  expiresAt?: Date;
  proof?: PaymentProof;
  referenceKey?: string;
  refund?: { referenceNumber: string; receiptUrls: string[]; recordedAt: Date; recordedBy: string };
  issueReason?: PaymentIssueReason;
  issueNote?: string;
  supportCaseId?: Types.ObjectId;
  timeline: PaymentTimelineEvent[];
  paidAt?: Date;
  confirmedAt?: Date;
  confirmedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const accountSnapshotSchema = new Schema<PaymentAccountSnapshot>(
  {
    accountId: String,
    channel: String,
    label: String,
    accountTitle: String,
    displayIdentifier: String,
    identifier: String,
    bankName: String,
    instructions: String,
  },
  { _id: false }
);

const proofSchema = new Schema<PaymentProof>(
  {
    receiptUrls: [String],
    referenceNumber: { type: String, required: true },
    paidAmount: { type: Number, required: true },
    paidAt: { type: Date, required: true },
    note: String,
    submittedAt: { type: Date, required: true },
  },
  { _id: false }
);

const timelineSchema = new Schema<PaymentTimelineEvent>(
  {
    type: { type: String, required: true },
    message: { type: String, required: true },
    actorRole: String,
    actorId: String,
    meta: Schema.Types.Mixed,
    at: { type: Date, required: true },
  },
  { _id: false }
);

const paymentSchema = new Schema<IPayment>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    providerId: {
      type: Schema.Types.ObjectId,
      ref: 'ProviderProfile',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'PKR' },
    method: {
      type: String,
      enum: [
        'card',
        'mobileWallet',
        'cash',
        'payAtHotel',
        'bankTransfer',
        'easypaisa',
        'jazzcash',
        'raast',
      ],
      required: true,
    },
    status: {
      type: String,
      enum: [
        'pending',
        'unpaid',
        'payment_initiated',
        'proof_submitted',
        'under_review',
        'paid',
        'confirmed',
        'rejected',
        'disputed',
        'failed',
        'refunded',
        'refund_pending',
        'expired',
      ],
      default: 'unpaid',
      index: true,
    },
    transactionId: { type: String, index: true },
    receivingAccount: accountSnapshotSchema,
    expiresAt: Date,
    proof: proofSchema,
    referenceKey: { type: String },
    refund: { type: Schema.Types.Mixed },
    issueReason: String,
    issueNote: String,
    supportCaseId: { type: Schema.Types.ObjectId, ref: 'SupportTicket' },
    timeline: { type: [timelineSchema], default: [] },
    paidAt: Date,
    confirmedAt: Date,
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

paymentSchema.index({ bookingId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, expiresAt: 1 });
// Namespaced by receiving account; a bank reference cannot pay two bookings.
paymentSchema.index({ referenceKey: 1 }, { unique: true, sparse: true });

export const Payment = mongoose.model<IPayment>('Payment', paymentSchema);
