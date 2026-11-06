import type { ClientSession } from 'mongoose';
import type { IProviderProfile } from '../models/ProviderProfile';
import { Room } from '../models/Room';
import { phone, text } from '../utils/transportValidation';

/**
 * Lodging (hotel, guest house, lodge, hostel) application steps, mirroring the
 * transport flow. Progress is worked out from the saved data plus a "confirmed" flag
 * per step, so the website and the app can both resume at the right step.
 */
export type LodgingStep = 'business' | 'location' | 'property' | 'photos' | 'rooms' | 'review' | 'submitted';

export const LODGING_STEPS: LodgingStep[] = ['business', 'location', 'property', 'photos', 'rooms', 'review'];
export const LODGING_TYPES = ['hotel', 'guestHouse', 'lodge', 'hostel'];

type Details = Record<string, unknown>;

const time = (value: unknown) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text(value));
const images = (value: unknown) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : []);

export function businessValid(profile: IProviderProfile) {
  return (
    text(profile.businessName).length >= 2 &&
    text(profile.ownerName).length >= 2 &&
    phone(profile.phone) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) &&
    text(profile.address).length >= 3 &&
    text(profile.city).length >= 2 &&
    text(profile.description).length >= 10 &&
    Number.isInteger(profile.yearsExperience) &&
    Number(profile.yearsExperience) >= 0 &&
    Number(profile.yearsExperience) <= 100
  );
}

export function locationValid(profile: IProviderProfile) {
  const coords = profile.location?.coordinates;
  return Boolean(
    coords?.length === 2 &&
      coords.every(Number.isFinite) &&
      Math.abs(coords[0]) <= 180 &&
      Math.abs(coords[1]) <= 90 &&
      (coords[0] !== 0 || coords[1] !== 0)
  );
}

/** What is missing from the property details (step 5). Empty when complete. */
export function propertyErrors(details: Details | undefined): string[] {
  const d = details ?? {};
  const errors: string[] = [];
  if (!LODGING_TYPES.includes(text(d.hotelType))) errors.push('Choose the type of lodging');
  if (text(d.managerName).length < 2) errors.push('Enter the manager’s name');
  if (!phone(d.phone)) errors.push('Enter a valid mobile number for the property');
  if (text(d.village).length < 2) errors.push('Enter the village or area');
  if (text(d.district).length < 2) errors.push('Enter the district');
  if (text(d.businessRegistrationNumber).length < 3) errors.push('Enter the business registration number');
  const years = Number(d.yearsExperience);
  if (!Number.isInteger(years) || years < 0 || years > 100) errors.push('Enter years of experience in hospitality');
  if (!time(d.checkInTime) || !time(d.checkOutTime)) errors.push('Set check-in and check-out times');
  if (!['yes', 'no'].includes(text(d.restaurantAvailable))) errors.push('Say whether there is a restaurant');
  return errors;
}

/** What is missing from the photos (step 6). Empty when complete. */
export function photoErrors(details: Details | undefined): string[] {
  const d = details ?? {};
  const errors: string[] = [];
  if (!images(d.outlookImages).length) errors.push('Add at least one photo of the outside of the property');
  if (!images(d.roomImages).length) errors.push('Add at least one room photo');
  if (text(d.restaurantAvailable) === 'yes' && !images(d.restaurantImages).length) {
    errors.push('Add a restaurant photo');
  }
  return errors;
}

export async function activeRoomCount(profile: IProviderProfile, session?: ClientSession) {
  return Room.countDocuments({ providerId: profile._id, status: 'active' }).session(session ?? null);
}

export async function lodgingProgress(profile: IProviderProfile, session?: ClientSession) {
  if (!profile.services.includes('hotel')) return undefined;
  const details = profile.hotelDetails as Details | undefined;
  const flags = (profile.onboarding ?? {}) as Record<string, unknown>;
  const rooms = await activeRoomCount(profile, session);

  let nextStep: LodgingStep = 'business';
  if (businessValid(profile)) {
    nextStep = 'location';
    if (flags.locationConfirmed && locationValid(profile)) {
      nextStep = 'property';
      if (flags.propertyConfirmed && !propertyErrors(details).length) {
        nextStep = 'photos';
        if (flags.photosConfirmed && !photoErrors(details).length) {
          nextStep = 'rooms';
          if (rooms > 0) nextStep = profile.onboarding?.submittedAt ? 'submitted' : 'review';
        }
      }
    }
  }
  const completedSteps = nextStep === 'submitted' ? LODGING_STEPS : LODGING_STEPS.slice(0, LODGING_STEPS.indexOf(nextStep));
  return {
    service: 'hotel' as const,
    nextStep,
    completedSteps,
    rooms,
    submittedAt: profile.onboarding?.submittedAt,
    completed: nextStep === 'submitted',
  };
}
