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
  | 'lodge'
  | 'restaurant';

export type ProviderService = string;

export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface ProviderLocation {
  address: string;
  city: string;
  latitude?: number;
  longitude?: number;
}
