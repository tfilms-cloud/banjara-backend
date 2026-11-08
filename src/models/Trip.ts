import mongoose, { Schema, Types } from 'mongoose';

export interface ISeat {
  seatNumber: string;
  row: number;
  column: number;
  type: 'standard' | 'premium' | 'disabled';
  status: 'available' | 'reserved' | 'booked' | 'blocked';
}

export interface ITrip {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  routeId?: Types.ObjectId;
  origin: string;
  destination: string;
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  departureDate: string;
  departureTime: string;
  arrivalDate?: string;
  arrivalTime?: string;
  pickupPoints: Types.ObjectId[];
  dropoffPoints: Types.ObjectId[];
  price: number;
  totalSeats: number;
  availableSeats: number;
  bookedSeats: number;
  seatLayout: ISeat[];
  amenities: string[];
  status: 'scheduled' | 'boarding' | 'departed' | 'inTransit' | 'completed' | 'cancelled';
  /** one_way = to destination only; round_trip = go & return */
  journeyType: 'one_way' | 'round_trip';
  returnDate?: string;
  returnTime?: string;
  /** seat = per-seat sales; vehicle = whole-vehicle hire */
  bookingMode: 'seat' | 'vehicle';
  description?: string;
  /** scheduled = a driver-published trip (all existing trips); intercity = a City to City ride. */
  rideType?: 'scheduled' | 'intercity';
  rideRequestId?: Types.ObjectId;
  /** City to City only. Rider addresses are never stored here (trips are public). */
  intercity?: { fromCityId: Types.ObjectId; toCityId: Types.ObjectId; departAt: Date; leg: 'outbound' | 'return' };
  /** Last known driver position (City to City tracking). */
  lastLocation?: { lat: number; lng: number; at: Date; speed?: number; heading?: number };
  createdAt: Date;
  updatedAt: Date;
}

const seatSchema = new Schema<ISeat>(
  {
    seatNumber: { type: String, required: true },
    row: { type: Number, required: true },
    column: { type: Number, required: true },
    type: { type: String, enum: ['standard', 'premium', 'disabled'], default: 'standard' },
    status: {
      type: String,
      enum: ['available', 'reserved', 'booked', 'blocked'],
      default: 'available',
    },
  },
  { _id: false }
);

const tripSchema = new Schema<ITrip>(
  {
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true, index: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    routeId: { type: Schema.Types.ObjectId, ref: 'Route' },
    origin: { type: String, required: true, index: true },
    destination: { type: String, required: true, index: true },
    originLat: Number,
    originLng: Number,
    destinationLat: Number,
    destinationLng: Number,
    departureDate: { type: String, required: true, index: true },
    departureTime: { type: String, required: true },
    arrivalDate: String,
    arrivalTime: String,
    pickupPoints: [{ type: Schema.Types.ObjectId, ref: 'PickupPoint' }],
    dropoffPoints: [{ type: Schema.Types.ObjectId, ref: 'PickupPoint' }],
    price: { type: Number, required: true, min: 0 },
    totalSeats: { type: Number, required: true },
    availableSeats: { type: Number, required: true },
    bookedSeats: { type: Number, default: 0 },
    seatLayout: { type: [seatSchema], default: [] },
    amenities: { type: [String], default: [] },
    journeyType: {
      type: String,
      enum: ['one_way', 'round_trip'],
      default: 'one_way',
      index: true,
    },
    returnDate: String,
    returnTime: String,
    bookingMode: {
      type: String,
      enum: ['seat', 'vehicle'],
      default: 'seat',
      index: true,
    },
    status: {
      type: String,
      enum: ['scheduled', 'boarding', 'departed', 'inTransit', 'completed', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    description: String,
    rideType: { type: String, enum: ['scheduled', 'intercity'], default: 'scheduled' },
    rideRequestId: { type: Schema.Types.ObjectId, ref: 'RideRequest' },
    intercity: {
      type: new Schema(
        {
          fromCityId: { type: Schema.Types.ObjectId, ref: 'City' },
          toCityId: { type: Schema.Types.ObjectId, ref: 'City' },
          departAt: Date,
          leg: { type: String, enum: ['outbound', 'return'] },
        },
        { _id: false }
      ),
      default: undefined,
    },
    lastLocation: {
      type: new Schema({ lat: Number, lng: Number, at: Date, speed: Number, heading: Number }, { _id: false }),
      default: undefined,
    },
  },
  { timestamps: true }
);

tripSchema.index({ origin: 1, destination: 1, departureDate: 1 });
// City to City: shared-seat lookups and a driver's upcoming rides.
tripSchema.index(
  { 'intercity.fromCityId': 1, 'intercity.toCityId': 1, 'intercity.departAt': 1 },
  { partialFilterExpression: { rideType: 'intercity' } }
);

export const Trip = mongoose.model<ITrip>('Trip', tripSchema);
