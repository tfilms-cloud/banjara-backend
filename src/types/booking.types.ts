export type BookingType = 'transport' | 'hotel' | 'package';
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'refunded';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type PaymentMethod = 'card' | 'mobileWallet' | 'cash' | 'payAtHotel';

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
