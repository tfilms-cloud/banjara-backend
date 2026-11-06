import mongoose, { Schema, Types } from 'mongoose';
import type { GuideDetails } from '../types/guide.types';
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
  /** Primary vehicle from transporter signup */
  vehicleClass?: string;
  ownerName?: string;
  vehicleModel?: string;
  vehicleMakeYear?: string;
  engineNumber?: string;
  registrationNumber?: string;
  driverName?: string;
  driverPhone?: string;
  driverEmail?: string;
  driverPermanentAddress?: string;
  driverCnic?: string;
  hasInsurance?: string;
  insuranceCompany?: string;
  insuranceNumber?: string;
  insuranceYear?: string;
  driverExperienceYears?: string;
  driverLicenseNumber?: string;
  vehicleImageFront?: string;
  vehicleImageBack?: string;
  driverPhoto?: string;
  driverEmergencyContact?: string;
}

export interface IHotelDetails {
  hotelName?: string;
  hotelType?: string;
  managerName?: string;
  landline?: string;
  phone?: string;
  email?: string;
  address?: string;
  village?: string;
  district?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  businessRegistered?: string;
  businessRegistrationNumber?: string;
  yearsExperience?: number;
  website?: string;
  socialFacebook?: string;
  socialInstagram?: string;
  socialTiktok?: string;
  restaurantAvailable?: string;
  outlookImages?: string[];
  roomImages?: string[];
  restaurantImages?: string[];
  description?: string;
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
  /** Guide gender classification */
  gender?: 'male' | 'female';
  regionalLanguages?: string[];
  internationalLanguages?: string[];
  yearsExperience?: number;
  experienceHistory?: string;
  specialties?: string[];
  operatingAreas?: string[];
  certifications?: string[];
  dailyHireRate?: number;
}

export interface IRestaurantOffer {
  id?: string;
  title: string;
  type?: 'sale' | 'offer' | 'discount';
  discountPercent?: number;
  description?: string;
  active?: boolean;
}

export interface IRestaurantDetails {
  restaurantName?: string;
  cuisineTypes?: string[];
  menuVariety?: string[];
  city?: string;
  address?: string;
  phone?: string;
  description?: string;
  images?: string[];
  offers?: IRestaurantOffer[];
  hours?: string;
  website?: string;
  latitude?: number;
  longitude?: number;
}

export interface IProviderProfile {
  onboarding?: {
    locationConfirmed?: boolean;
    transportConfirmed?: boolean;
    vehicleId?: Types.ObjectId;
    /** Lodging steps 5 and 6 (see lodgingOnboarding.service). */
    propertyConfirmed?: boolean;
    photosConfirmed?: boolean;
    submittedAt?: Date;
  };
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
  restaurantDetails?: IRestaurantDetails;
  /** Hireable guide profile (services, availability, documents, languages) */
  guideDetails?: GuideDetails;
  /**
   * CNIC information match result (OCR). Does not prove document authenticity.
   * Raw CNIC images are not stored here.
   */
  identityVerification?: {
    verificationStatus: 'pending' | 'verified' | 'failed' | 'manual_review';
    cnicVerified: boolean;
    cnicNumberMasked: string;
    fatherNameVerified: boolean;
    expiryDateVerified: boolean;
    documentVerificationDate?: Date;
    verificationFailureReason?: string | null;
    informationMatched?: boolean;
  };
  /**
   * BANJARA commission as a percent of booking revenue (e.g. 0.2 = 0.2%, 20 = 20%).
   * Admin can set a different rate per service provider.
   */
  platformFeePercent?: number;
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
    vehicleClass: String,
    ownerName: String,
    vehicleModel: String,
    vehicleMakeYear: String,
    engineNumber: String,
    registrationNumber: String,
    driverName: String,
    driverPhone: String,
    driverEmail: String,
    driverPermanentAddress: String,
    driverCnic: String,
    hasInsurance: String,
    insuranceCompany: String,
    insuranceNumber: String,
    insuranceYear: String,
    driverExperienceYears: String,
    driverLicenseNumber: String,
    vehicleImageFront: String,
    vehicleImageBack: String,
    driverPhoto: String,
    driverEmergencyContact: String,
  },
  { _id: false }
);

const hotelDetailsSchema = new Schema<IHotelDetails>(
  {
    hotelName: String,
    hotelType: String,
    managerName: String,
    landline: String,
    phone: String,
    email: String,
    address: String,
    village: String,
    district: String,
    city: String,
    latitude: Number,
    longitude: Number,
    googleMapsUrl: String,
    businessRegistered: String,
    businessRegistrationNumber: String,
    yearsExperience: Number,
    website: String,
    socialFacebook: String,
    socialInstagram: String,
    socialTiktok: String,
    restaurantAvailable: String,
    outlookImages: [String],
    roomImages: [String],
    restaurantImages: [String],
    description: String,
    checkInTime: String,
    checkOutTime: String,
    amenities: [String],
    images: [String],
  },
  // Keep lodging onboarding flexible — never silently drop form fields
  { _id: false, strict: false }
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
    gender: { type: String, enum: ['male', 'female'] },
    regionalLanguages: [String],
    internationalLanguages: [String],
    yearsExperience: Number,
    experienceHistory: String,
    specialties: [String],
    operatingAreas: [String],
    certifications: [String],
    dailyHireRate: Number,
  },
  { _id: false }
);

const restaurantOfferSchema = new Schema<IRestaurantOffer>(
  {
    id: String,
    title: { type: String, required: true },
    type: { type: String, enum: ['sale', 'offer', 'discount'], default: 'offer' },
    discountPercent: Number,
    description: String,
    active: { type: Boolean, default: true },
  },
  { _id: false }
);

const restaurantDetailsSchema = new Schema<IRestaurantDetails>(
  {
    restaurantName: String,
    cuisineTypes: [String],
    menuVariety: [String],
    city: String,
    address: String,
    phone: String,
    description: String,
    images: [String],
    offers: [restaurantOfferSchema],
    hours: String,
    website: String,
    latitude: Number,
    longitude: Number,
  },
  { _id: false }
);

const providerSchema = new Schema<IProviderProfile>(
  {
    onboarding: {
      locationConfirmed: Boolean,
      transportConfirmed: Boolean,
      vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
      propertyConfirmed: Boolean,
      photosConfirmed: Boolean,
      submittedAt: Date,
    },
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
        'restaurant',
      ],
      default: [],
    },
    services: {
      type: [String],
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
    restaurantDetails: { type: restaurantDetailsSchema },
    /** Flexible guide onboarding payload — validated in Zod layer */
    guideDetails: { type: Schema.Types.Mixed },
    identityVerification: {
      verificationStatus: {
        type: String,
        enum: ['pending', 'verified', 'failed', 'manual_review'],
        default: 'pending',
      },
      cnicVerified: { type: Boolean, default: false },
      cnicNumberMasked: { type: String, default: '' },
      fatherNameVerified: { type: Boolean, default: false },
      expiryDateVerified: { type: Boolean, default: false },
      documentVerificationDate: Date,
      verificationFailureReason: { type: String, default: null },
      informationMatched: { type: Boolean, default: false },
    },
    /** BANJARA cut % — e.g. 0.2 means 0.2% of provider booking revenue */
    platformFeePercent: { type: Number, default: 0.2, min: 0, max: 100 },
  },
  { timestamps: true }
);

providerSchema.index({ location: '2dsphere' });

export const ProviderProfile = mongoose.model<IProviderProfile>('ProviderProfile', providerSchema);
