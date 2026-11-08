import mongoose, { Schema, Types } from 'mongoose';

/** Vehicle classes offered for City to City rides. */
export const INTERCITY_CLASSES = ['car', 'suv', 'jeep', 'van', 'coaster'] as const;
export type IntercityClass = (typeof INTERCITY_CLASSES)[number];

/**
 * Facts about one route (city A → city B) for a vehicle class: road km, drive time,
 * tolls and any rough-road surcharge. The fare itself always comes from the formula in
 * IntercitySettings; without a row, km and time are estimated from straight-line distance.
 */
export interface IRouteFare {
  _id: Types.ObjectId;
  fromCityId: Types.ObjectId;
  toCityId: Types.ObjectId;
  vehicleClass: IntercityClass;
  /** Unused since fares follow the formula; kept so older rows still load. */
  baseFare?: number;
  distanceKm: number;
  durationMinutes: number;
  tolls: number;
  /**
   * Extra for genuinely rough stretches (e.g. jeep tracks). Drive time already prices
   * ordinary mountain slowness, so keep this for exceptions.
   */
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
    baseFare: { type: Number, min: 0 },
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
