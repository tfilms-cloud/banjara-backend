import mongoose, { Schema, Types } from 'mongoose';

const placeSchema = new Schema(
  {
    name: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false }
);

export interface IRoute {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  origin: { name: string; latitude: number; longitude: number };
  destination: { name: string; latitude: number; longitude: number };
  stops: string[];
  distance: number;
  estimatedDuration: number;
  createdAt: Date;
  updatedAt: Date;
}

const routeSchema = new Schema<IRoute>(
  {
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true, index: true },
    origin: { type: placeSchema, required: true },
    destination: { type: placeSchema, required: true },
    stops: { type: [String], default: [] },
    distance: { type: Number, default: 0 },
    estimatedDuration: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Route = mongoose.model<IRoute>('Route', routeSchema);
