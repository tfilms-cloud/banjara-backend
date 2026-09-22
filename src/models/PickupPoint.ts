import mongoose, { Schema, Types } from 'mongoose';

export interface IPickupAddress {
  street?: string;
  area?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  formattedAddress?: string;
}

/**
 * Pickup points are separate from business location.
 * A provider can have many pickup points (bus stands, meeting spots, etc.).
 */
export interface IPickupPoint {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  name: string;
  description?: string;
  address: string;
  structuredAddress?: IPickupAddress;
  /** Flat coords kept for backward compatibility with existing clients */
  latitude: number;
  longitude: number;
  location?: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  landmark?: string;
  images: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const pickupAddressSchema = new Schema<IPickupAddress>(
  {
    street: String,
    area: String,
    city: String,
    region: String,
    postalCode: String,
    country: String,
    formattedAddress: String,
  },
  { _id: false }
);

const pickupPointSchema = new Schema<IPickupPoint>(
  {
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true, index: true },
    name: { type: String, required: true },
    description: String,
    address: { type: String, required: true },
    structuredAddress: { type: pickupAddressSchema },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: undefined },
    },
    landmark: String,
    images: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

pickupPointSchema.index({ location: '2dsphere' });

pickupPointSchema.pre('validate', function syncGeoJson() {
  if (typeof this.longitude === 'number' && typeof this.latitude === 'number') {
    this.location = {
      type: 'Point',
      coordinates: [this.longitude, this.latitude],
    };
  }
});

export const PickupPoint = mongoose.model<IPickupPoint>('PickupPoint', pickupPointSchema);
