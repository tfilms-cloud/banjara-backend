import mongoose, { Schema, Types } from 'mongoose';

/**
 * A city BANJARA serves for City to City rides. A pin belongs to the nearest active
 * city within that city's radius; pickup and drop-off in different cities = intercity.
 */
export interface ICity {
  _id: Types.ObjectId;
  name: string;
  /** Lower-case key, e.g. "gilgit". */
  slug: string;
  aliases: string[];
  province?: string;
  location: { type: 'Point'; coordinates: [number, number] };
  /** How far from the centre a pin still counts as this city. */
  radiusKm: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const citySchema = new Schema<ICity>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    aliases: { type: [String], default: [] },
    province: String,
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    radiusKm: { type: Number, default: 25, min: 1 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

citySchema.index({ location: '2dsphere' });

export const City = mongoose.model<ICity>('City', citySchema);
