import mongoose, { Schema, Types } from 'mongoose';
import type {
  BookingStatus,
  BookingType,
  HotelBookingDetails,
  PaymentStatus,
  TransportBookingDetails,
} from '../types/booking.types';

export interface IBooking {
  _id: Types.ObjectId;
  bookingNumber: string;
  customerId: Types.ObjectId;
  providerId: Types.ObjectId;
  bookingType: BookingType;
  transportBooking?: TransportBookingDetails;
  hotelBooking?: HotelBookingDetails;
  subtotal: number;
  tax: number;
  serviceFee: number;
  discount: number;
  totalAmount: number;
  currency: string;
  paymentId?: Types.ObjectId;
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
  ticketQr?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bookingSchema = new Schema<IBooking>(
  {
    bookingNumber: { type: String, required: true, unique: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true, index: true },
    bookingType: { type: String, enum: ['transport', 'hotel', 'package'], required: true },
    transportBooking: { type: Schema.Types.Mixed },
    hotelBooking: { type: Schema.Types.Mixed },
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    serviceFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    currency: { type: String, default: 'PKR' },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    bookingStatus: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed', 'refunded'],
      default: 'pending',
      index: true,
    },
    ticketQr: String,
  },
  { timestamps: true }
);

export const Booking = mongoose.model<IBooking>('Booking', bookingSchema);
