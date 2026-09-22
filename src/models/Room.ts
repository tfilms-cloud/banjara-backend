import mongoose, { Schema, Types } from 'mongoose';

export interface IRoom {
  _id: Types.ObjectId;
  hotelId: Types.ObjectId;
  providerId: Types.ObjectId;
  name: string;
  roomType: 'single' | 'double' | 'twin' | 'deluxe' | 'suite' | 'family';
  bedType: string;
  capacity: number;
  size: number;
  pricePerNight: number;
  totalRooms: number;
  availableRooms: number;
  amenities: string[];
  breakfastIncluded: boolean;
  cancellationPolicy: string;
  images: string[];
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

const roomSchema = new Schema<IRoom>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true, index: true },
    name: { type: String, required: true },
    roomType: {
      type: String,
      enum: ['single', 'double', 'twin', 'deluxe', 'suite', 'family'],
      required: true,
    },
    bedType: { type: String, required: true },
    capacity: { type: Number, required: true, min: 1 },
    size: { type: Number, default: 20 },
    pricePerNight: { type: Number, required: true, min: 0 },
    totalRooms: { type: Number, required: true, min: 1 },
    availableRooms: { type: Number, required: true, min: 0 },
    amenities: { type: [String], default: [] },
    breakfastIncluded: { type: Boolean, default: false },
    cancellationPolicy: { type: String, default: 'Free cancellation' },
    images: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

export const Room = mongoose.model<IRoom>('Room', roomSchema);
