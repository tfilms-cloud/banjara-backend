export type BookingType = 'transport' | 'hotel' | 'package' | 'guide';
export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'refunded'
  | 'payment_verification'
  | 'expired'
  | 'disputed';

export type { PaymentMethod, PaymentStatus } from './payment.types';
export { isP2PMethod, P2P_METHODS } from './payment.types';

export interface GeoPoint {
  name: string;
  latitude: number;
  longitude: number;
}

export interface PriceBreakdown {
  subtotal: number;
  tax: number;
  serviceFee: number;
  discount: number;
  totalAmount: number;
  currency: string;
}

export interface PassengerDetail {
  name: string;
  phone?: string;
  age?: number;
  gender?: string;
}

export interface GuestDetail {
  name: string;
  email: string;
  phone: string;
  specialRequests?: string;
}

export interface TransportBookingDetails {
  tripId: string;
  vehicleId?: string;
  seats: string[];
  pickupPoint?: string;
  dropoffPoint?: string;
  passengerDetails: PassengerDetail[];
  /** City to City rides: door-to-door details (private to the rider and driver). */
  intercity?: {
    rideRequestId: string;
    leg: 'outbound' | 'return';
    rideType: 'full_car' | 'shared_seat';
    pickupAddress: string;
    pickupLat: number;
    pickupLng: number;
    dropoffAddress: string;
    dropoffLat: number;
    dropoffLng: number;
    luggage: { bags: number; large: number };
    passengers: number;
    notes?: string;
  };
}

export interface HotelBookingDetails {
  hotelId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  guests: number;
  guestDetails: GuestDetail;
  nights: number;
  pricePerNight?: number;
  nightlyRates?: Array<{ date: string; rate: number }>;
  stayStatus?: 'booked' | 'checked_in' | 'checked_out';
}

export interface PackageBookingDetails {
  itineraryId: string;
  startDate: string;
  travelers: number;
  guestDetails: GuestDetail;
  title: string;
  tourType: string;
  destination: string;
  durationDays: number;
  pricePerPerson: number;
  currency?: string;
}

export interface GuideBookingDetails {
  serviceId?: string;
  serviceName: string;
  date: string;
  startTime: string;
  endTime?: string;
  durationHours?: number;
  guests: number;
  meetingPoint?: string;
  availableLocation?: string;
  specialRequest?: string;
  pricingType: 'per_person' | 'per_group' | 'per_hour' | 'per_day' | 'custom';
  unitPrice: number;
  currency?: string;
  guestDetails: GuestDetail;
  rejectionReason?: string;
  cancellationReason?: string;
  serviceStatus?: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'no_show';
}
