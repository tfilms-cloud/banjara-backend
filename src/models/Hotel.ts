import mongoose, { Schema, Types } from 'mongoose';

export type HotelApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'changes_requested';

export interface IHotel {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  name: string;
  description: string;
  hotelType: 'hotel' | 'resort' | 'guestHouse' | 'lodge';
  rating: number;
  reviewCount: number;
  address: string;
  city: string;
  country?: string;
  phone?: string;
  email?: string;
  location?: { type: 'Point'; coordinates: [number, number] };
  amenities: string[];
  images: string[];
  checkInTime: string;
  checkOutTime: string;
  cancellationPolicy: string;
  priceFrom: number;
  status: 'active' | 'inactive' | 'draft';
  approvalStatus: HotelApprovalStatus;
  isVerified: boolean;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const hotelSchema = new Schema<IHotel>(
  {
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    hotelType: {
      type: String,
      enum: ['hotel', 'resort', 'guestHouse', 'lodge'],
      required: true,
    },
    rating: { type: Number, default: 0, index: true },
    reviewCount: { type: Number, default: 0 },
    address: { type: String, required: true },
    city: { type: String, required: true, index: true },
    country: { type: String, default: 'Pakistan' },
    phone: String,
    email: String,
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    amenities: { type: [String], default: [] },
    images: { type: [String], default: [] },
    checkInTime: { type: String, default: '14:00' },
    checkOutTime: { type: String, default: '12:00' },
    cancellationPolicy: { type: String, default: 'Free cancellation up to 24 hours before check-in.' },
    priceFrom: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive', 'draft'], default: 'active' },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended', 'changes_requested'],
      default: 'approved',
      index: true,
    },
    isVerified: { type: Boolean, default: false, index: true },
    rejectionReason: String,
  },
  { timestamps: true }
);

hotelSchema.index({ location: '2dsphere' });
hotelSchema.index({ status: 1, approvalStatus: 1, city: 1 });
hotelSchema.index({ hotelType: 1, rating: -1, priceFrom: 1 });

export const Hotel = mongoose.model<IHotel>('Hotel', hotelSchema);
