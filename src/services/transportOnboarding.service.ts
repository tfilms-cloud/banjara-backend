import mongoose, { type ClientSession, type HydratedDocument } from 'mongoose';
import {
  ProviderProfile,
  type IProviderProfile,
} from '../models/ProviderProfile';
import { Vehicle } from '../models/Vehicle';
import { AppError, assertFound } from '../utils/AppError';
import { upsertVehicleFromTransportDetails } from './vehicle.service';
import {
  LODGING_STEPS,
  businessValid as lodgingBusinessValid,
  lodgingProgress,
  photoErrors,
  propertyErrors,
} from './lodgingOnboarding.service';

export type TransportStep =
  | 'business'
  | 'location'
  | 'transport'
  | 'vehicle'
  | 'verification'
  | 'review'
  | 'submitted';

import {
  transportErrors,
  transportPricingErrors,
  vehicleRegistrationErrors,
  text,
  phone,
} from '../utils/transportValidation';
export {
  transportErrors,
  transportPricingErrors,
} from '../utils/transportValidation';

function businessValid(profile: IProviderProfile) {
  return (
    text(profile.businessName).length >= 2 &&
    text(profile.ownerName).length >= 2 &&
    phone(profile.phone) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) &&
    text(profile.address).length >= 3 &&
    text(profile.city).length >= 2 &&
    text(profile.description).length >= 10 &&
    Number.isInteger(profile.yearsExperience) && Number(profile.yearsExperience) >= 0 && Number(profile.yearsExperience) <= 100
  );
}
function locationValid(profile: IProviderProfile) {
  const coords = profile.location?.coordinates;
  return Boolean(
    coords?.length === 2 &&
      coords.every(Number.isFinite) &&
      Math.abs(coords[0]) <= 180 &&
      Math.abs(coords[1]) <= 90 &&
      (coords[0] !== 0 || coords[1] !== 0),
  );
}
export async function transportProgress(
  profile: IProviderProfile,
  session?: ClientSession,
) {
  if (!profile.services.includes('transport')) return undefined;
  let nextStep: TransportStep = 'business';
  const cnicVerified = Boolean(
    profile.identityVerification?.verificationStatus === 'verified' &&
      profile.identityVerification.cnicVerified,
  );
  const details = profile.transportDetails as
    | Record<string, unknown>
    | undefined;
  const vehicle = profile.onboarding?.vehicleId
    ? await Vehicle.findOne({
        _id: profile.onboarding.vehicleId,
        providerId: profile._id,
      })
        .select('+verificationDetails')
        .session(session ?? null)
    : null;
  if (businessValid(profile)) {
    nextStep = 'location';
    if (profile.onboarding?.locationConfirmed && locationValid(profile)) {
      nextStep = 'transport';
      if (
        profile.onboarding?.transportConfirmed &&
        !transportErrors(details).length &&
        !transportPricingErrors(details).length
      ) {
        nextStep = 'vehicle';
        if (
          vehicle?.registrationCompletedAt &&
          !vehicleRegistrationErrors(vehicle).length &&
          vehicle.registrationNumber === details?.registrationNumber
        ) {
          nextStep = 'verification';
          if (cnicVerified) {
            nextStep = profile.onboarding?.submittedAt ? 'submitted' : 'review';
          } else if (profile.onboarding?.submittedAt) {
            // Submitted before the CNIC check passed: BANJARA checks the CNIC by hand.
            nextStep = 'submitted';
          }
        }
      }
    }
  }
  const steps: TransportStep[] = [
    'business',
    'location',
    'transport',
    'vehicle',
    'verification',
    'review',
  ];
  const completedSteps =
    nextStep === 'submitted'
      ? steps.filter((step) => step !== 'verification' || cnicVerified)
      : steps.slice(0, steps.indexOf(nextStep));
  return {
    nextStep,
    completedSteps,
    /** False when the application was submitted without a passing CNIC check. */
    cnicVerified,
    vehicleId: vehicle?._id.toString(),
    submittedAt: profile.onboarding?.submittedAt,
    completed: nextStep === 'submitted',
  };
}

export async function providerWithProgress(
  profile: IProviderProfile,
  session?: ClientSession,
) {
  const document = profile as IProviderProfile & { toObject?: () => object };
  return {
    ...(document.toObject ? document.toObject() : profile),
    onboardingProgress:
      (await transportProgress(profile, session)) ?? (await lodgingProgress(profile, session)),
  };
}

/** Lodging checkpoints: each one checks its step's data before marking it done. */
async function lodgingCheckpoint(profile: HydratedDocument<IProviderProfile>, step: string, session: ClientSession) {
  const progress = (await lodgingProgress(profile, session))!;
  const order = [...LODGING_STEPS, 'submitted'];
  if (!order.includes(step)) throw new AppError('Invalid onboarding checkpoint', 422);
  if (order.indexOf(step) > order.indexOf(progress.nextStep))
    throw new AppError(`Complete the ${progress.nextStep} step first.`, 422);
  const details = profile.hotelDetails as Record<string, unknown> | undefined;
  if (step === 'location') {
    if (!lodgingBusinessValid(profile) || !locationValid(profile))
      throw new AppError('Complete your details and confirm a valid map pin.', 422);
    profile.set('onboarding.locationConfirmed', true);
  } else if (step === 'property') {
    const errors = propertyErrors(details);
    if (errors.length) throw new AppError(errors.join('\n'), 422);
    profile.set('onboarding.propertyConfirmed', true);
  } else if (step === 'photos') {
    const errors = photoErrors(details);
    if (errors.length) throw new AppError(errors.join('\n'), 422);
    profile.set('onboarding.photosConfirmed', true);
  } else {
    throw new AppError('Invalid onboarding checkpoint', 422);
  }
  // Any change after submitting sends the application back for review.
  profile.set('onboarding.submittedAt', undefined);
}

async function submitLodgingApplication(profile: HydratedDocument<IProviderProfile>) {
  const progress = await lodgingProgress(profile);
  if (!progress || !['review', 'submitted'].includes(progress.nextStep))
    throw new AppError(`Complete the ${progress?.nextStep ?? 'lodging'} step before submitting.`, 422);
  if (!profile.onboarding?.submittedAt) profile.set('onboarding.submittedAt', new Date());
  await profile.save();
  return providerWithProgress(profile);
}

export async function checkpoint(
  userId: string,
  step: string,
  vehicleId?: string,
) {
  return mongoose.connection.transaction(async (session) => {
    const profile = assertFound(
      await ProviderProfile.findOne({ userId }).session(session),
      'Provider profile not found',
    );
    if (profile.services.includes('hotel')) {
      await lodgingCheckpoint(profile, step, session);
      await profile.save({ session });
      return providerWithProgress(profile, session);
    }
    if (!profile.services.includes('transport'))
      throw new AppError('Transportation onboarding required', 422);
    const progress = (await transportProgress(profile, session))!;
    const order = [
      'business',
      'location',
      'transport',
      'vehicle',
      'verification',
      'review',
      'submitted',
    ];
    if (order.indexOf(step) > order.indexOf(progress.nextStep))
      throw new AppError(`Complete the ${progress.nextStep} step first.`, 422);
    if (step === 'location') {
      if (!businessValid(profile) || !locationValid(profile))
        throw new AppError(
          'Complete business details and confirm a valid map pin.',
          422,
        );
      profile.set('onboarding.locationConfirmed', true);
    } else if (step === 'transport') {
      const errors = [
        ...transportErrors(profile.transportDetails as Record<string, unknown>),
        ...transportPricingErrors(
          profile.transportDetails as Record<string, unknown>,
        ),
      ];
      if (errors.length) throw new AppError(errors.join('\n'), 422);
      await upsertVehicleFromTransportDetails(
        profile._id.toString(),
        profile.transportDetails as Record<string, unknown>,
        true,
        session,
      );
      profile.set('onboarding.transportConfirmed', true);
      profile.set('onboarding.vehicleId', undefined);
      profile.set('onboarding.submittedAt', undefined);
    } else if (step === 'vehicle') {
      const vehicle = vehicleId
        ? await Vehicle.findOne({ _id: vehicleId, providerId: profile._id })
            .select('+verificationDetails')
            .session(session)
        : null;
      if (
        !vehicle?.registrationCompletedAt ||
        vehicle.registrationNumber !==
          profile.transportDetails?.registrationNumber ||
        vehicleRegistrationErrors(vehicle).length
      )
        throw new AppError(
          'Save the complete primary vehicle before continuing.',
          422,
        );
      if (profile.onboarding?.vehicleId?.toString() !== vehicle._id.toString())
        profile.set('onboarding.submittedAt', undefined);
      profile.set('onboarding.vehicleId', vehicle._id);
      profile.set(
        'transportDetails.vehicleImageFront',
        vehicle.verificationDetails?.vehicleImageFront,
      );
      profile.set(
        'transportDetails.vehicleImageBack',
        vehicle.verificationDetails?.vehicleImageBack,
      );
    } else {
      throw new AppError('Invalid onboarding checkpoint', 422);
    }
    await profile.save({ session });
    return providerWithProgress(profile, session);
  });
}

export async function submitTransportApplication(userId: string) {
  const lodging = await ProviderProfile.findOne({ userId, services: 'hotel' });
  if (lodging) return submitLodgingApplication(lodging);
  return mongoose.connection.transaction(async (session) => {
    const profile = assertFound(
      await ProviderProfile.findOne({ userId }).session(session),
      'Provider profile not found',
    );
    const progress = await transportProgress(profile, session);
    // A complete application may be submitted before the CNIC check passes;
    // the CNIC is then verified by the BANJARA team during review.
    if (!progress || !['verification', 'review', 'submitted'].includes(progress.nextStep))
      throw new AppError(
        `Complete the ${progress?.nextStep ?? 'transportation'} step before submitting.`,
        422,
      );
    if (!profile.onboarding?.submittedAt)
      profile.set('onboarding.submittedAt', new Date());
    await profile.save({ session });
    return providerWithProgress(profile, session);
  });
}
