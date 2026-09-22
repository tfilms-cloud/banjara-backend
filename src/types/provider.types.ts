export type ProviderType =
  | 'travelAgency'
  | 'vanOperator'
  | 'busOperator'
  | 'carRental'
  | 'tourOperator'
  | 'travelGuide'
  | 'hotel'
  | 'resort'
  | 'guestHouse'
  | 'lodge';

export type ProviderService = 'transport' | 'hotel' | 'tour' | 'carRental' | 'travelGuide';

export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface ProviderLocation {
  address: string;
  city: string;
  latitude?: number;
  longitude?: number;
}
