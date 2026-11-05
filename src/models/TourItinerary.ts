import mongoose, { Schema, Types } from 'mongoose';

export type TourType = 'trek' | 'expedition' | 'summit';
export type TourItineraryStatus = 'draft' | 'pending' | 'published' | 'rejected';
export type TourDifficulty = 'easy' | 'moderate' | 'hard';

export interface ITourDay {
  dayNumber: number;
  title: string;
  description: string;
}

export interface ITourItinerary {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  title: string;
  tourType: TourType;
  summary: string;
  description: string;
  destination: string;
  region?: string;
  durationDays: number;
  durationNights?: number;
  difficulty?: TourDifficulty;
  maxParticipants: number;
  pricePerPerson: number;
  currency: string;
  included: string[];
  excluded: string[];
  days: ITourDay[];
  coverImage: string;
  images: string[];
  departureLocation?: string;
  bestSeason?: string;
  status: TourItineraryStatus;
  featured: boolean;
  rejectionReason?: string;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const tourDaySchema = new Schema<ITourDay>(
  {
    dayNumber: { type: Number, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
  },
  { _id: false }
);

const tourItinerarySchema = new Schema<ITourItinerary>(
  {
    providerId: {
      type: Schema.Types.ObjectId,
      ref: 'ProviderProfile',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    tourType: {
      type: String,
      enum: ['trek', 'expedition', 'summit'],
      required: true,
      index: true,
    },
    summary: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    destination: { type: String, required: true, trim: true, index: true },
    region: { type: String, trim: true },
    durationDays: { type: Number, required: true, min: 1 },
    durationNights: { type: Number, min: 0 },
    difficulty: {
      type: String,
      enum: ['easy', 'moderate', 'hard'],
    },
    maxParticipants: { type: Number, required: true, min: 1 },
    pricePerPerson: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'PKR' },
    included: { type: [String], default: [] },
    excluded: { type: [String], default: [] },
    days: { type: [tourDaySchema], default: [] },
    coverImage: { type: String, required: true },
    images: { type: [String], default: [] },
    departureLocation: { type: String, trim: true },
    bestSeason: { type: String, trim: true },
    status: {
      type: String,
      enum: ['draft', 'pending', 'published', 'rejected'],
      default: 'draft',
      index: true,
    },
    featured: { type: Boolean, default: false, index: true },
    rejectionReason: { type: String },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

tourItinerarySchema.index({ status: 1, tourType: 1, featured: -1, createdAt: -1 });
tourItinerarySchema.index({ providerId: 1, status: 1 });

export const TourItinerary = mongoose.model<ITourItinerary>('TourItinerary', tourItinerarySchema);
