import mongoose, { Schema, Types } from 'mongoose';
import type { ProviderService, ProviderType, VerificationStatus } from '../types/provider.types';

export interface IStructuredAddress {
  street?: string;
  area?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  formattedAddress?: string;
}

export interface ITransportDetails {
  businessName?: string;
  vehicleTypes?: string[];
  vehicleCount?: number;
  ownershipType?: string;
  operatingCities?: string[];
  operatingRoutes?: string[];
  pickupLocations?: string[];
  dropoffLocations?: string[];
  description?: string;
  pricingMethod?: string;
  priceAmount?: number;
  pricePercent?: number;
}

export interface IHotelDetails {
  hotelName?: string;
  hotelType?: string;
  address?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  description?: string;
  phone?: string;
  email?: string;
  checkInTime?: string;
  checkOutTime?: string;
  amenities?: string[];
  images?: string[];
}

export interface ITourDetails {
  companyName?: string;
  tourName?: string;
  description?: string;
  destination?: string;
  duration?: string;
  departureLocation?: string;
  pickupLocations?: string[];
  price?: number;
  maxParticipants?: number;
  included?: string[];
  excluded?: string[];
  images?: string[];
}

export interface IProviderProfile {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  businessName: string;
  ownerName: string;
  providerType: ProviderType[];
  services: ProviderService[];
  description: string;
  phone: string;
  email: string;
  website?: string;
  socialMedia?: string;
  /** Flat address kept for backward compatibility */
  address: string;
  city: string;
  structuredAddress?: IStructuredAddress;
  location?: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  locationUpdatedAt?: Date;
  verificationStatus: VerificationStatus;
  rejectionReason?: string;
  rating: number;
  totalReviews: number;
  yearsExperience?: number;
  logo?: string;
  transportDetails?: ITransportDetails;
  hotelDetails?: IHotelDetails;
  tourDetails?: ITourDetails;
  createdAt: Date;
  updatedAt: Date;
}

const structuredAddressSchema = new Schema<IStructuredAddress>(
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

const transportDetailsSchema = new Schema<ITransportDetails>(
  {
    businessName: String,
    vehicleTypes: [String],
    vehicleCount: Number,
    ownershipType: String,
    operatingCities: [String],
    operatingRoutes: [String],
    pickupLocations: [String],
    dropoffLocations: [String],
    description: String,
    pricingMethod: String,
    priceAmount: Number,
    pricePercent: Number,
  },
  { _id: false }
);

const hotelDetailsSchema = new Schema<IHotelDetails>(
  {
    hotelName: String,
    hotelType: String,
    address: String,
    city: String,
    latitude: Number,
    longitude: Number,
    description: String,
    phone: String,
    email: String,
    checkInTime: String,
    checkOutTime: String,
    amenities: [String],
    images: [String],
  },
  { _id: false }
);

const tourDetailsSchema = new Schema<ITourDetails>(
  {
    companyName: String,
    tourName: String,
    description: String,
    destination: String,
    duration: String,
    departureLocation: String,
    pickupLocations: [String],
    price: Number,
    maxParticipants: Number,
    included: [String],
    excluded: [String],
    images: [String],
  },
  { _id: false }
);

const providerSchema = new Schema<IProviderProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    businessName: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    providerType: {
      type: [String],
      enum: [
        'travelAgency',
        'vanOperator',
        'busOperator',
        'carRental',
        'tourOperator',
        'travelGuide',
        'hotel',
        'resort',
        'guestHouse',
        'lodge',
      ],
      default: [],
    },
    services: {
      type: [String],
      enum: ['transport', 'hotel', 'tour', 'carRental', 'travelGuide'],
      default: [],
      validate: {
        validator: (value: string[]) => !value || value.length <= 1,
        message: 'A provider can offer only one service',
      },
    },
    description: { type: String, default: '' },
    phone: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    website: String,
    socialMedia: String,
    address: { type: String, required: true },
    city: { type: String, required: true, index: true },
    structuredAddress: { type: structuredAddressSchema },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    locationUpdatedAt: Date,
    verificationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
      index: true,
    },
    rejectionReason: { type: String, trim: true },
    rating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    yearsExperience: Number,
    logo: String,
    transportDetails: { type: transportDetailsSchema },
    hotelDetails: { type: hotelDetailsSchema },
    tourDetails: { type: tourDetailsSchema },
  },
  { timestamps: true }
);

providerSchema.index({ location: '2dsphere' });

export const ProviderProfile = mongoose.model<IProviderProfile>('ProviderProfile', providerSchema);
