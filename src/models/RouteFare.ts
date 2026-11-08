import mongoose, { Schema, Types } from 'mongoose';

/** Vehicle classes offered for City to City rides. */
export const INTERCITY_CLASSES = ['car', 'suv', 'jeep', 'van', 'coaster'] as const;
export type IntercityClass = (typeof INTERCITY_CLASSES)[number];

/**
 * The full-car fare for one route and vehicle class (city A → city B). When no row
 * matches, the fare falls back to the formula in IntercitySettings.
 */
export interface IRouteFare {
  _id: Types.ObjectId;
  fromCityId: Types.ObjectId;
  toCityId: Types.ObjectId;
  vehicleClass: IntercityClass;
  /** Whole-vehicle fare for one leg, before extras, tax and service fee. */
  baseFare: number;
  distanceKm: number;
  durationMinutes: number;
  tolls: number;
  /** Mountain / difficult road surcharge (e.g. Karakoram Highway). */
  difficultSurcharge: number;
  /** Riders may offer their own price on this route. */
  bidEnabled: boolean;
  /** The same fare applies B → A. */
  bothWays: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const routeFareSchema = new Schema<IRouteFare>(
  {
    fromCityId: { type: Schema.Types.ObjectId, ref: 'City', required: true },
    toCityId: { type: Schema.Types.ObjectId, ref: 'City', required: true },
    vehicleClass: { type: String, enum: INTERCITY_CLASSES, required: true },
    baseFare: { type: Number, required: true, min: 0 },
    distanceKm: { type: Number, default: 0, min: 0 },
    durationMinutes: { type: Number, default: 0, min: 0 },
    tolls: { type: Number, default: 0, min: 0 },
    difficultSurcharge: { type: Number, default: 0, min: 0 },
    bidEnabled: { type: Boolean, default: false },
    bothWays: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

routeFareSchema.index({ fromCityId: 1, toCityId: 1, vehicleClass: 1 }, { unique: true });

export const RouteFare = mongoose.model<IRouteFare>('RouteFare', routeFareSchema);
