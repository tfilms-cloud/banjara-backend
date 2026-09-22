import mongoose, { Schema, Types } from 'mongoose';
import type { PaymentMethod, PaymentStatus } from '../types/booking.types';

export interface IPayment {
  _id: Types.ObjectId;
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  providerId: Types.ObjectId;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  transactionId?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'PKR' },
    method: {
      type: String,
      enum: ['card', 'mobileWallet', 'cash', 'payAtHotel'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    transactionId: String,
    paidAt: Date,
  },
  { timestamps: true }
);

export const Payment = mongoose.model<IPayment>('Payment', paymentSchema);
