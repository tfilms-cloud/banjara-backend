import mongoose, { Schema, Types } from 'mongoose';

export interface IRoomAvailability {
  _id: Types.ObjectId;
  roomId: Types.ObjectId;
  date: string;
  totalRooms: number;
  bookedRooms: number;
  availableRooms: number;
  blockedRooms: number;
  priceOverride?: number;
  createdAt: Date;
  updatedAt: Date;
}

const roomAvailabilitySchema = new Schema<IRoomAvailability>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    date: { type: String, required: true, index: true },
    totalRooms: { type: Number, required: true },
    bookedRooms: { type: Number, default: 0 },
    availableRooms: { type: Number, required: true, min: 0 },
    blockedRooms: { type: Number, default: 0 },
    priceOverride: Number,
  },
  { timestamps: true }
);

roomAvailabilitySchema.index({ roomId: 1, date: 1 }, { unique: true });

export const RoomAvailability = mongoose.model<IRoomAvailability>(
  'RoomAvailability',
  roomAvailabilitySchema
);
