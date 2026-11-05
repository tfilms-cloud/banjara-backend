/** Guide service provider — nested on ProviderProfile.guideDetails */

export type GuideGender = 'male' | 'female' | 'other';

export type GuideType =
  | 'local'
  | 'tour'
  | 'trekking'
  | 'hiking'
  | 'cultural'
  | 'adventure'
  | 'mountain'
  | 'photography'
  | 'other';

export type LanguageProficiency = 'basic' | 'conversational' | 'fluent' | 'native';

export type GuidePricingType = 'per_person' | 'per_group' | 'per_hour' | 'per_day' | 'custom';

export type GuideDocumentType =
  | 'cnic'
  | 'guide_license'
  | 'tourism_cert'
  | 'first_aid'
  | 'mountain_cert'
  | 'other';

export type GuideDocumentStatus = 'pending' | 'verified' | 'rejected' | 'expired';

export type GuidePhotoCategory =
  | 'profile'
  | 'action'
  | 'mountains'
  | 'destinations'
  | 'trekking'
  | 'tours'
  | 'other';

export type GuideProfileStatus =
  | 'draft'
  | 'pending'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface GuideLanguage {
  language: string;
  proficiency: LanguageProficiency;
}

export interface GuideDocument {
  id: string;
  type: GuideDocumentType;
  label?: string;
  number?: string;
  issueDate?: string;
  expiryDate?: string;
  fileUrl: string;
  status: GuideDocumentStatus;
  rejectionReason?: string;
}

export interface GuidePhoto {
  id: string;
  url: string;
  category: GuidePhotoCategory;
  caption?: string;
}

export interface GuideOfferedService {
  id: string;
  name: string;
  category: GuideType;
  description: string;
  durationLabel: string;
  durationHours?: number;
  price: number;
  pricingType: GuidePricingType;
  currency: string;
  minGuests: number;
  maxGuests: number;
  included: string[];
  excluded: string[];
  meetingPoint?: string;
  availableLocations: string[];
  notes?: string;
  active: boolean;
}

export interface GuideDayAvailability {
  day: Weekday;
  enabled: boolean;
  startTime: string; // HH:mm
  endTime: string;
}

export interface GuideAvailability {
  weekly: GuideDayAvailability[];
  minBookingHours?: number;
  maxBookingHours?: number;
  advanceBookingHours?: number;
  availableFrom?: string; // ISO date
  availableUntil?: string;
  blockedDates: string[]; // YYYY-MM-DD
}

export interface GuideDetails {
  /** Profile lifecycle for guide-specific review (mirrors provider verification) */
  profileStatus?: GuideProfileStatus;
  changesRequestedNote?: string;

  fullName?: string;
  profilePhoto?: string;
  gender?: GuideGender;
  dateOfBirth?: string;
  age?: number;
  phone?: string;
  whatsapp?: string;
  email?: string;
  cnicNumber?: string;
  cnicFrontUrl?: string;
  cnicBackUrl?: string;

  country?: string;
  province?: string;
  district?: string;
  city?: string;
  currentLocation?: string;
  areasCovered?: string[];
  pickupLocations?: string[];

  guideTypes?: GuideType[];
  customGuideType?: string;
  yearsExperience?: number;
  shortBio?: string;
  detailedDescription?: string;
  specialSkills?: string[];
  areasOfExpertise?: string[];
  certifications?: string[];
  training?: string[];
  awards?: string[];

  languages?: GuideLanguage[];
  documents?: GuideDocument[];
  photos?: GuidePhoto[];
  services?: GuideOfferedService[];
  availability?: GuideAvailability;

  /** Fallback daily rate when no specific service selected */
  dailyHireRate?: number;
}

export interface GuideBookingDetails {
  serviceId?: string;
  serviceName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime?: string;
  durationHours?: number;
  guests: number;
  meetingPoint?: string;
  availableLocation?: string;
  specialRequest?: string;
  pricingType: GuidePricingType;
  unitPrice: number;
  currency?: string;
  guestDetails: {
    name: string;
    email: string;
    phone: string;
    specialRequests?: string;
  };
  rejectionReason?: string;
  cancellationReason?: string;
  serviceStatus?: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'no_show';
}

export const DEFAULT_GUIDE_WEEKLY: GuideDayAvailability[] = [
  { day: 'monday', enabled: true, startTime: '09:00', endTime: '18:00' },
  { day: 'tuesday', enabled: true, startTime: '09:00', endTime: '18:00' },
  { day: 'wednesday', enabled: true, startTime: '09:00', endTime: '18:00' },
  { day: 'thursday', enabled: true, startTime: '09:00', endTime: '18:00' },
  { day: 'friday', enabled: true, startTime: '09:00', endTime: '18:00' },
  { day: 'saturday', enabled: true, startTime: '09:00', endTime: '18:00' },
  { day: 'sunday', enabled: false, startTime: '09:00', endTime: '18:00' },
];

export const GUIDE_AREA_SUGGESTIONS = [
  'Gilgit',
  'Hunza',
  'Skardu',
  'Nagar',
  'Ghizer',
  'Astore',
  'Diamer',
  'Chitral',
  'Islamabad',
  'Other',
] as const;
