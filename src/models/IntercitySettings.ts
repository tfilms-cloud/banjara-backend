import mongoose, { Schema, Types } from 'mongoose';
import type { IntercityClass } from './RouteFare';

/**
 * One document holding every City to City rule, so prices and windows change without
 * a redeploy. `enabled` is the runtime switch; env INTERCITY_ENABLED is the hard kill
 * switch above it. Defaults are PLACEHOLDERS until the business sets real values.
 */
export interface IIntercitySettings {
  _id: Types.ObjectId;
  key: 'default';
  enabled: boolean;
  /** Fallback fare when no RouteFare matches: base + perKm × km × class multiplier. */
  baseFare: number;
  perKm: number;
  /** Straight-line km × this ≈ road km (mountain roads wind). */
  roadFactor: number;
  classMultipliers: Record<IntercityClass, number>;
  /** Typical seats per class, used for shared-seat pricing and capacity checks. */
  classSeats: Record<IntercityClass, number>;
  /** A shared seat costs this fraction of the full-car fare. */
  sharedSeatFraction: number;
  waitingPerHour: number;
  overnightCharge: number;
  /** Riders may offer a price on formula-priced routes too. */
  bidOnFallback: boolean;
  /** Lowest rider offer, as a % of the quoted fare. */
  minOfferPercent: number;
  minLeadMinutes: number;
  /** A "now" request stays open this long. */
  requestTtlMinutes: number;
  freeCancelMinutes: number;
  noShowWaitMinutes: number;
  matchRadiusKm: number;
  /** Search radius steps around the pickup: start small, widen when nobody is near. */
  radiusStepsKm: number[];
  /** Shared rides: departures within ± this many minutes can share a vehicle. */
  sharedWindowMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_INTERCITY_SETTINGS = {
  enabled: true,
  baseFare: 1500,
  perKm: 45,
  roadFactor: 1.3,
  classMultipliers: { car: 1, suv: 1.4, jeep: 1.5, van: 1.8, coaster: 2.6 },
  classSeats: { car: 4, suv: 6, jeep: 6, van: 12, coaster: 22 },
  sharedSeatFraction: 0.3,
  waitingPerHour: 500,
  overnightCharge: 4000,
  bidOnFallback: false,
  minOfferPercent: 70,
  minLeadMinutes: 120,
  requestTtlMinutes: 30,
  freeCancelMinutes: 180,
  noShowWaitMinutes: 30,
  matchRadiusKm: 30,
  radiusStepsKm: [10, 20, 30, 50],
  sharedWindowMinutes: 60,
} satisfies Omit<IIntercitySettings, '_id' | 'key' | 'createdAt' | 'updatedAt'>;

const perClass = new Schema(
  { car: Number, suv: Number, jeep: Number, van: Number, coaster: Number },
  { _id: false }
);

const intercitySettingsSchema = new Schema<IIntercitySettings>(
  {
    key: { type: String, enum: ['default'], default: 'default', unique: true },
    enabled: { type: Boolean, default: DEFAULT_INTERCITY_SETTINGS.enabled },
    baseFare: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.baseFare, min: 0 },
    perKm: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.perKm, min: 0 },
    roadFactor: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.roadFactor, min: 1 },
    classMultipliers: { type: perClass, default: () => ({ ...DEFAULT_INTERCITY_SETTINGS.classMultipliers }) },
    classSeats: { type: perClass, default: () => ({ ...DEFAULT_INTERCITY_SETTINGS.classSeats }) },
    sharedSeatFraction: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.sharedSeatFraction, min: 0, max: 1 },
    waitingPerHour: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.waitingPerHour, min: 0 },
    overnightCharge: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.overnightCharge, min: 0 },
    bidOnFallback: { type: Boolean, default: DEFAULT_INTERCITY_SETTINGS.bidOnFallback },
    minOfferPercent: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.minOfferPercent, min: 0, max: 100 },
    minLeadMinutes: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.minLeadMinutes, min: 0 },
    requestTtlMinutes: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.requestTtlMinutes, min: 1 },
    freeCancelMinutes: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.freeCancelMinutes, min: 0 },
    noShowWaitMinutes: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.noShowWaitMinutes, min: 0 },
    matchRadiusKm: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.matchRadiusKm, min: 0 },
    radiusStepsKm: { type: [Number], default: () => [...DEFAULT_INTERCITY_SETTINGS.radiusStepsKm] },
    sharedWindowMinutes: { type: Number, default: DEFAULT_INTERCITY_SETTINGS.sharedWindowMinutes, min: 0 },
  },
  { timestamps: true }
);

export const IntercitySettings = mongoose.model<IIntercitySettings>('IntercitySettings', intercitySettingsSchema);
