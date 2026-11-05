import mongoose, { Schema, Types } from 'mongoose';

export type PaymentMessageKind = 'text' | 'image' | 'system' | 'reference';

export interface IPaymentMessage {
  _id: Types.ObjectId;
  paymentId: Types.ObjectId;
  bookingId: Types.ObjectId;
  senderRole: 'customer' | 'provider' | 'admin' | 'system';
  senderId?: Types.ObjectId;
  kind: PaymentMessageKind;
  text?: string;
  imageUrl?: string;
  referenceNumber?: string;
  readByCustomer: boolean;
  readByProvider: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const paymentMessageSchema = new Schema<IPaymentMessage>(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    senderRole: {
      type: String,
      enum: ['customer', 'provider', 'admin', 'system'],
      required: true,
    },
    senderId: { type: Schema.Types.ObjectId, ref: 'User' },
    kind: {
      type: String,
      enum: ['text', 'image', 'system', 'reference'],
      default: 'text',
    },
    text: { type: String, maxlength: 2000 },
    imageUrl: String,
    referenceNumber: String,
    readByCustomer: { type: Boolean, default: false },
    readByProvider: { type: Boolean, default: false },
  },
  { timestamps: true }
);

paymentMessageSchema.index({ paymentId: 1, createdAt: 1 });

export const PaymentMessage = mongoose.model<IPaymentMessage>(
  'PaymentMessage',
  paymentMessageSchema
);
