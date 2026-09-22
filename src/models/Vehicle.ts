import mongoose, { Schema, Types } from 'mongoose';

export type VehicleStatus = 'pending' | 'active' | 'rejected' | 'suspended';

export interface ISeatConfiguration {
  rows?: number;
  seatsPerRow?: number;
  layoutType?: string;
}

export interface IVehicle {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  name: string;
  type: 'van' | 'bus' | 'car' | 'minibus' | 'tourVehicle' | 'coaster' | 'suv' | 'other';
  brand: string;
  vehicleModel: string;
  year: number;
  registrationNumber: string;
  /** Permanent physical capacity — never changed by bookings */
  seatCount: number;
  seatConfiguration?: ISeatConfiguration;
  amenities: string[];
  images: string[];
  status: VehicleStatus;
  rejectionReason?: string;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedBy?: Types.ObjectId;
  rejectedAt?: Date;
  suspendedBy?: Types.ObjectId;
  suspendedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const seatConfigurationSchema = new Schema<ISeatConfiguration>(
  {
    rows: Number,
    seatsPerRow: Number,
    layoutType: String,
  },
  { _id: false }
);

const vehicleSchema = new Schema<IVehicle>(
  {
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true, index: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['van', 'bus', 'car', 'minibus', 'tourVehicle', 'coaster', 'suv', 'other'],
      required: true,
    },
    brand: { type: String, required: true },
    vehicleModel: { type: String, required: true },
    year: { type: Number, required: true },
    registrationNumber: { type: String, required: true, index: true },
    seatCount: { type: Number, required: true, min: 1 },
    seatConfiguration: { type: seatConfigurationSchema },
    amenities: { type: [String], default: [] },
    images: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['pending', 'active', 'rejected', 'suspended'],
      default: 'pending',
      index: true,
    },
    rejectionReason: { type: String, trim: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    suspendedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    suspendedAt: Date,
  },
  { timestamps: true }
);

export const Vehicle = mongoose.model<IVehicle>('Vehicle', vehicleSchema);
