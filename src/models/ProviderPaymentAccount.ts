import mongoose, { Schema, Types } from 'mongoose';
import type { PayoutChannel } from '../types/payment.types';

export interface IProviderPaymentAccount {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  channel: PayoutChannel;
  /** Short label shown to customers, e.g. "Primary JazzCash" */
  label: string;
  accountTitle: string;
  /** IBAN / account number / mobile / Raast ID */
  identifier: string;
  bankName?: string;
  branch?: string;
  instructions?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const providerPaymentAccountSchema = new Schema<IProviderPaymentAccount>(
  {
    providerId: {
      type: Schema.Types.ObjectId,
      ref: 'ProviderProfile',
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ['bank', 'easypaisa', 'jazzcash', 'raast', 'other'],
      required: true,
    },
    label: { type: String, required: true, trim: true },
    accountTitle: { type: String, required: true, trim: true },
    identifier: { type: String, required: true, trim: true },
    bankName: { type: String, trim: true },
    branch: { type: String, trim: true },
    instructions: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

providerPaymentAccountSchema.index({ providerId: 1, channel: 1, active: 1 });

export const ProviderPaymentAccount = mongoose.model<IProviderPaymentAccount>(
  'ProviderPaymentAccount',
  providerPaymentAccountSchema
);
