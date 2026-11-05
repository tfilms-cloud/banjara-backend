import mongoose, { Schema, Types } from 'mongoose';

export interface IServiceCatalog {
  _id: Types.ObjectId;
  /** Stable key used on provider profiles, e.g. transport, hotel */
  key: string;
  label: string;
  emoji: string;
  description: string;
  active: boolean;
  sortOrder: number;
  /**
   * BANJARA commission % for every provider on this service
   * (e.g. 0.2 = 0.2%, 20 = 20%).
   */
  platformFeePercent: number;
  createdAt: Date;
  updatedAt: Date;
}

const serviceCatalogSchema = new Schema<IServiceCatalog>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      // Keep camelCase keys (travelGuide) — do not force lowercase
      match: [/^[a-z][a-zA-Z0-9_]*$/, 'key must start with a letter'],
    },
    label: { type: String, required: true, trim: true },
    emoji: { type: String, default: '✨' },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    platformFeePercent: { type: Number, default: 0.2, min: 0, max: 100 },
  },
  { timestamps: true }
);

export const ServiceCatalog = mongoose.model<IServiceCatalog>('ServiceCatalog', serviceCatalogSchema);

export const DEFAULT_SERVICE_CATALOG: Array<{
  key: string;
  label: string;
  emoji: string;
  description: string;
  sortOrder: number;
  platformFeePercent: number;
}> = [
  {
    key: 'transport',
    label: 'Transportation',
    emoji: '🚌',
    description: 'Trips, vans, buses, and car rental — one transport listing',
    sortOrder: 1,
    platformFeePercent: 0.2,
  },
  {
    key: 'hotel',
    label: 'Lodging',
    emoji: '🏨',
    description: 'Hotels, guest houses, lodges, and hostels',
    sortOrder: 2,
    platformFeePercent: 0.2,
  },
  {
    key: 'tour',
    label: 'Tour Operators',
    emoji: '🗺️',
    description: 'Guided tours, treks, and packages',
    sortOrder: 3,
    platformFeePercent: 0.2,
  },
  {
    key: 'travelGuide',
    label: 'Guides',
    emoji: '🧭',
    description: 'Hireable local guide — experience & languages, no trips',
    sortOrder: 4,
    platformFeePercent: 0.2,
  },
  {
    key: 'restaurant',
    label: 'Restaurants',
    emoji: '🍽️',
    description: 'Dining, menus, sales and destination offers',
    sortOrder: 5,
    platformFeePercent: 0.2,
  },
];
