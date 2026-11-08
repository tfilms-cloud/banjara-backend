import mongoose, { Schema, Types } from 'mongoose';
import { INTERCITY_CLASSES, type IntercityClass } from './RouteFare';
import type { FareLine } from '../services/intercityFare.service';

/**
 * A rider's City to City request. Drivers answer with offers; when the rider picks
 * one, it becomes an ordinary intercity Trip + Booking, so confirmation, payment,
 * completion, reviews and cancellation all run through the existing booking code.
 */
export interface IRidePlace {
  address: string;
  lat: number;
  lng: number;
  cityId: Types.ObjectId;
  cityName: string;
}

export interface IRideOffer {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  amount: number;
  /** accept = at the quoted / rider's price; counter = the driver's own price. */
  kind: 'accept' | 'counter';
  status: 'pending' | 'chosen' | 'declined' | 'withdrawn';
  createdAt: Date;
}

export type RideRequestStatus = 'open' | 'matched' | 'expired' | 'cancelled';

export interface IRideRequest {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  status: RideRequestStatus;
  rideType: 'full_car' | 'shared_seat';
  journeyType: 'one_way' | 'round_trip';
  pickup: IRidePlace;
  dropoff: IRidePlace;
  /** Requested pickup time. */
  departAt: Date;
  bookNow: boolean;
  returnTrip?: { departAt: Date; waitMode: 'hourly' | 'overnight'; waitHours?: number; nights?: number };
  vehicleClass: IntercityClass;
  passengers: number;
  luggage: { bags: number; large: number };
  passengerName: string;
  passengerPhone: string;
  notes?: string;
  quote: { source: 'route' | 'formula'; distanceKm: number; lines: FareLine[]; outbound: number; returnLeg: number; subtotal: number; bidAllowed: boolean };
  fareMode: 'fixed' | 'bid';
  riderOffer?: number;
  offers: IRideOffer[];
  declinedBy: Types.ObjectId[];
  /** Drivers who cancelled after being chosen; never offered this request again. */
  excludedProviderIds: Types.ObjectId[];
  notifiedProviderIds: Types.ObjectId[];
  /** Current driver search radius around the pickup (km); widened step by step. */
  searchRadiusKm: number;
  chosenOfferId?: Types.ObjectId;
  tripId?: Types.ObjectId;
  bookingId?: Types.ObjectId;
  returnTripId?: Types.ObjectId;
  returnBookingId?: Types.ObjectId;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const placeSchema = new Schema<IRidePlace>(
  {
    address: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    cityId: { type: Schema.Types.ObjectId, ref: 'City', required: true },
    cityName: { type: String, required: true },
  },
  { _id: false }
);

const offerSchema = new Schema<IRideOffer>(
  {
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    amount: { type: Number, required: true, min: 0 },
    kind: { type: String, enum: ['accept', 'counter'], required: true },
    status: { type: String, enum: ['pending', 'chosen', 'declined', 'withdrawn'], default: 'pending' },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true }
);

const rideRequestSchema = new Schema<IRideRequest>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['open', 'matched', 'expired', 'cancelled'], default: 'open', index: true },
    rideType: { type: String, enum: ['full_car', 'shared_seat'], required: true },
    journeyType: { type: String, enum: ['one_way', 'round_trip'], default: 'one_way' },
    pickup: { type: placeSchema, required: true },
    dropoff: { type: placeSchema, required: true },
    departAt: { type: Date, required: true, index: true },
    bookNow: { type: Boolean, default: false },
    returnTrip: {
      type: new Schema(
        {
          departAt: { type: Date, required: true },
          waitMode: { type: String, enum: ['hourly', 'overnight'], required: true },
          waitHours: Number,
          nights: Number,
        },
        { _id: false }
      ),
      default: undefined,
    },
    vehicleClass: { type: String, enum: INTERCITY_CLASSES, required: true },
    passengers: { type: Number, required: true, min: 1 },
    luggage: {
      bags: { type: Number, default: 0, min: 0 },
      large: { type: Number, default: 0, min: 0 },
    },
    passengerName: { type: String, required: true },
    passengerPhone: { type: String, required: true },
    notes: String,
    quote: { type: Schema.Types.Mixed, required: true },
    fareMode: { type: String, enum: ['fixed', 'bid'], default: 'fixed' },
    riderOffer: Number,
    offers: { type: [offerSchema], default: [] },
    declinedBy: [{ type: Schema.Types.ObjectId, ref: 'ProviderProfile' }],
    excludedProviderIds: [{ type: Schema.Types.ObjectId, ref: 'ProviderProfile' }],
    notifiedProviderIds: [{ type: Schema.Types.ObjectId, ref: 'ProviderProfile' }],
    searchRadiusKm: { type: Number, default: 10, min: 1 },
    chosenOfferId: Schema.Types.ObjectId,
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip' },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    returnTripId: { type: Schema.Types.ObjectId, ref: 'Trip' },
    returnBookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

rideRequestSchema.index({ status: 1, 'pickup.cityId': 1, departAt: 1 });
rideRequestSchema.index({ status: 1, expiresAt: 1 });

export const RideRequest = mongoose.model<IRideRequest>('RideRequest', rideRequestSchema);
