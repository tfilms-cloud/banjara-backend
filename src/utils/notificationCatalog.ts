/** Stable notification types used across API + push payloads. */
export const NOTIFICATION_TYPES = [
  'bookingPending',
  'bookingRequest',
  'bookingConfirmed',
  'bookingCancelled',
  'bookingReminder',
  'paymentReceived',
  'paymentFailed',
  'paymentExpired',
  'tripReminder',
  'pickupReminder',
  'newReview',
  'newMessage',
  'newOffer',
  'vehicle',
  'cnicVerified',
  'cnicFailed',
  'system',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationCategory =
  | 'bookings'
  | 'payments'
  | 'messages'
  | 'trips'
  | 'offers'
  | 'reviews'
  | 'system';

export type NotificationPreferences = {
  pushEnabled: boolean;
  bookings: boolean;
  payments: boolean;
  messages: boolean;
  trips: boolean;
  offers: boolean;
  reviews: boolean;
  system: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushEnabled: true,
  bookings: true,
  payments: true,
  messages: true,
  trips: true,
  offers: false,
  reviews: true,
  system: true,
};

const TYPE_TO_CATEGORY: Record<NotificationType, NotificationCategory> = {
  bookingPending: 'bookings',
  bookingRequest: 'bookings',
  bookingConfirmed: 'bookings',
  bookingCancelled: 'bookings',
  bookingReminder: 'bookings',
  paymentReceived: 'payments',
  paymentFailed: 'payments',
  paymentExpired: 'payments',
  tripReminder: 'trips',
  pickupReminder: 'trips',
  newReview: 'reviews',
  newMessage: 'messages',
  newOffer: 'offers',
  vehicle: 'system',
  cnicVerified: 'system',
  cnicFailed: 'system',
  system: 'system',
};

export function categoryForType(type: string): NotificationCategory {
  return TYPE_TO_CATEGORY[type as NotificationType] ?? 'system';
}

export function mergePreferences(
  raw: unknown
): NotificationPreferences {
  const base = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof NotificationPreferences)[]) {
    if (typeof src[key] === 'boolean') base[key] = src[key] as boolean;
  }
  return base;
}

export function allowsPush(
  prefs: NotificationPreferences,
  type: string
): boolean {
  if (!prefs.pushEnabled) return false;
  const category = categoryForType(type);
  return Boolean(prefs[category]);
}
