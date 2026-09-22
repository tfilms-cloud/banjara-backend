import mongoose, { Schema, Types } from 'mongoose';

export interface IReview {
  _id: Types.ObjectId;
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  providerId: Types.ObjectId;
  serviceType: 'transport' | 'hotel' | 'tour';
  rating: number;
  comment: string;
  categories: Record<string, number>;
  providerReply?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true, index: true },
    serviceType: { type: String, enum: ['transport', 'hotel', 'tour'], required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
    categories: { type: Schema.Types.Mixed, default: {} },
    providerReply: String,
  },
  { timestamps: true }
);

export const Review = mongoose.model<IReview>('Review', reviewSchema);
