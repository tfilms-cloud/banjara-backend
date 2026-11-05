import type { ClientSession } from 'mongoose';
import { Vehicle } from '../models/Vehicle';
import { Trip } from '../models/Trip';
import { ProviderProfile } from '../models/ProviderProfile';
import { AdminAuditLog } from '../models/AdminAuditLog';
import { AppError, assertFound } from '../utils/AppError';
import { assertApprovedProvider } from './provider.service';
import * as notificationService from './notification.service';
import { transportErrors, vehicleRegistrationErrors } from '../utils/transportValidation';

const VEHICLE_TYPES = [
  'van',
  'bus',
  'car',
  'minibus',
  'tourVehicle',
  'coaster',
  'suv',
  'jeep',
  'other',
] as const;

type VehicleType = (typeof VEHICLE_TYPES)[number];

const VEHICLE_TYPE_ALIASES: Record<string, VehicleType> = {
  van: 'van',
  bus: 'bus',
  car: 'car',
  minibus: 'minibus',
  mini_bus: 'minibus',
  'mini-bus': 'minibus',
  tourvehicle: 'tourVehicle',
  tour_vehicle: 'tourVehicle',
  coaster: 'coaster',
  suv: 'suv',
  // A jeep used to be stored as "suv" (the model had no jeep type), so drivers who
  // picked Jeep saw "SUV". Vehicles saved before this keep "suv".
  jeep: 'jeep',
  other: 'other',
};

function normalizeVehicleType(value: unknown): VehicleType {
  const raw = String(value ?? 'other')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if ((VEHICLE_TYPES as readonly string[]).includes(raw)) return raw as VehicleType;
  return VEHICLE_TYPE_ALIASES[raw] ?? 'other';
}

function defaultSeatCountForType(type: VehicleType): number {
  switch (type) {
    case 'bus':
      return 40;
    case 'minibus':
    case 'coaster':
      return 14;
    case 'van':
      return 8;
    case 'suv':
      return 6;
    case 'jeep':
      return 5;
    case 'tourVehicle':
      return 10;
    case 'car':
    default:
      return 4;
  }
}

function normalizeCreateInput(input: Record<string, unknown>) {
  const seatCount = Number(input.seatCount ?? input.totalSeats ?? 0);
  if (!Number.isInteger(seatCount) || seatCount < 1) {
    throw new AppError('Total seats must be a positive integer', 422);
  }

  const brand = String(input.brand ?? input.make ?? input.model ?? input.name ?? 'Unknown');
  const vehicleModel = String(input.vehicleModel ?? input.model ?? input.name ?? 'Unknown');

  return {
    name: String(input.name),
    type: normalizeVehicleType(input.type),
    brand,
    vehicleModel,
    year: Number(input.year),
    registrationNumber: String(input.registrationNumber),
    seatCount,
    seatConfiguration: input.seatConfiguration as
      | { rows?: number; seatsPerRow?: number; layoutType?: string }
      | undefined,
    amenities: Array.isArray(input.amenities) ? input.amenities.map(String) : [],
    images: Array.isArray(input.images) ? input.images.map(String) : [],
    verificationDetails: input.verificationDetails as Record<string, unknown> | undefined,
    status: 'pending' as const,
  };
}

/** Each transport provider is one driver with one vehicle. */
export const MAX_VEHICLES_PER_DRIVER = 1;

export async function createVehicle(providerId: string, input: Record<string, unknown>) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Provider profile not found');
  const onboarding = profile.verificationStatus === 'pending' && profile.services.includes('transport');
  if (!onboarding) await assertApprovedProvider(providerId);
  // Rides are offered by individual local drivers, each driving their own single vehicle.
  // A rejected vehicle does not count, so the driver can register a corrected one.
  const current = await Vehicle.countDocuments({ providerId, status: { $ne: 'rejected' } });
  if (current >= MAX_VEHICLES_PER_DRIVER) {
    throw new AppError(
      'You already have a registered vehicle. Drivers can register one vehicle; edit it instead of adding another.',
      409
    );
  }
  if (onboarding || input.verificationDetails) {
    const errors = transportErrors(input.verificationDetails as Record<string, unknown>);
    if (errors.length) throw new AppError(errors.join('\n'), 422);
  }
  const normalized = normalizeCreateInput(input);
  if ((onboarding || input.verificationDetails) && vehicleRegistrationErrors(normalized).length) {
    throw new AppError(vehicleRegistrationErrors(normalized).join('\n'), 422);
  }
  return Vehicle.create({
    ...normalized,
    registrationCompletedAt: normalized.verificationDetails ? new Date() : undefined,
    providerId,
  });
}

/**
 * Creates or updates a Vehicle document from transporter signup `transportDetails`.
 * Pending providers may upsert — admin still must approve the vehicle before trips.
 */
export async function upsertVehicleFromTransportDetails(
  providerId: string,
  transport: Record<string, unknown> | null | undefined,
  refresh = false,
  session?: ClientSession
) {
  if (!transport || typeof transport !== 'object') return null;

  const registrationNumber = String(transport.registrationNumber ?? '').trim();
  if (!registrationNumber) return null;

  const vehicleClass = String(
    transport.vehicleClass ??
      (Array.isArray(transport.vehicleTypes) ? transport.vehicleTypes[0] : '') ??
      'other'
  );
  const type = normalizeVehicleType(vehicleClass);
  const vehicleModel = String(transport.vehicleModel ?? transport.model ?? 'Unknown').trim() || 'Unknown';
  const yearRaw = Number(transport.vehicleMakeYear ?? transport.year);
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 1980 && yearRaw <= 2100
      ? Math.trunc(yearRaw)
      : new Date().getFullYear();
  // transportDetails.businessName is now the driver's own name, so name the vehicle after itself.
  const name = `${vehicleModel} (${registrationNumber})`;
  const images = [
    String(transport.vehicleImageFront ?? '').trim(),
    String(transport.vehicleImageBack ?? '').trim(),
  ].filter(Boolean);
  const seatCount = defaultSeatCountForType(type);

  const payload = {
    name,
    type,
    brand: vehicleModel,
    vehicleModel,
    year,
    registrationNumber,
    seatCount,
    amenities: [] as string[],
    images,
  };

  const profile = refresh ? await ProviderProfile.findById(providerId).session(session ?? null) : null;
  const primary = profile?.onboarding?.vehicleId
    ? await Vehicle.findOne({ _id: profile.onboarding.vehicleId, providerId }).session(session ?? null) : null;
  // One vehicle per driver: a changed registration number updates that vehicle, never adds a second.
  const existing =
    primary ??
    (await Vehicle.findOne({ providerId, registrationNumber }).session(session ?? null)) ??
    (await Vehicle.findOne({ providerId, status: { $ne: 'rejected' } })
      .sort({ createdAt: 1 })
      .session(session ?? null));
  if (existing) {
    // Listing vehicles must never overwrite an edited vehicle or undo moderation.
    if (!refresh) return existing;
    if (!existing.registrationCompletedAt) existing.name = payload.name;
    existing.type = payload.type;
    existing.brand = payload.brand;
    existing.vehicleModel = payload.vehicleModel;
    existing.year = payload.year;
    existing.registrationNumber = payload.registrationNumber;
    existing.set('verificationDetails', transport);
    if (payload.images.length) existing.images = [...new Set([...payload.images, ...existing.images.slice(2)])];
    await existing.save({ session });
    return existing;
  }

  const [vehicle] = await Vehicle.create([{
    ...payload,
    verificationDetails: transport,
    providerId,
    status: 'pending',
  }], { session });
  return vehicle;
}

export async function listVehicles(providerId?: string, onlyActive = false) {
  const filter: Record<string, unknown> = providerId ? { providerId } : {};
  if (onlyActive) filter.status = 'active';
  const query = Vehicle.find(filter).sort({ createdAt: -1 });
  return providerId ? query.select('+verificationDetails') : query;
}

export async function listActiveVehiclesForProvider(providerId: string) {
  return Vehicle.find({ providerId, status: 'active' }).sort({ createdAt: -1 });
}

export async function getVehicle(id: string, ownerId?: string, admin = false) {
  const vehicle = assertFound(await Vehicle.findById(id), 'Vehicle not found');
  return admin || (ownerId && vehicle.providerId.toString() === ownerId)
    ? Vehicle.findById(id).select('+verificationDetails') : vehicle;
}

/**
 * Vehicle fields a provider may edit. Identity (`providerId`) and moderation/audit fields
 * (`status`, `approvedBy`, `rejectedBy`, `suspendedBy`, and their timestamps/reasons) are
 * admin-managed.
 */
const VEHICLE_PROVIDER_FIELDS = [
  'name',
  'type',
  'brand',
  'vehicleModel',
  'year',
  'registrationNumber',
  'seatCount',
  'seatConfiguration',
  'amenities',
  'images',
  'verificationDetails',
] as const;

export async function updateVehicle(providerId: string, id: string, patch: Record<string, unknown>) {
  const vehicle = assertFound(await Vehicle.findById(id).select('+verificationDetails'), 'Vehicle not found');
  if (vehicle.providerId.toString() !== providerId) {
    throw new AppError('You cannot modify this vehicle', 403);
  }

  const update: Record<string, unknown> = {};
  if (patch.verificationDetails) {
    const errors = transportErrors(patch.verificationDetails as Record<string, unknown>);
    if (errors.length) throw new AppError(errors.join('\n'), 422);
  }
  for (const field of VEHICLE_PROVIDER_FIELDS) {
    if (patch[field] !== undefined) update[field] = patch[field];
  }
  if (update.seatCount == null && patch.totalSeats != null) {
    update.seatCount = patch.totalSeats;
  }
  if (update.type != null) {
    update.type = normalizeVehicleType(update.type);
  }

  if (typeof update.seatCount === 'number') {
    if (!Number.isInteger(update.seatCount) || update.seatCount < 1) {
      throw new AppError('Total seats must be a positive integer', 422);
    }
  }

  // Provider edit after rejection → resubmit as pending
  if (vehicle.status === 'rejected') {
    vehicle.status = 'pending';
    vehicle.rejectionReason = undefined;
    vehicle.rejectedAt = undefined;
    vehicle.rejectedBy = undefined;
  }

  Object.assign(vehicle, update);
  const registrationErrors = vehicleRegistrationErrors(vehicle);
  if (patch.verificationDetails && registrationErrors.length) throw new AppError(registrationErrors.join('\n'), 422);
  vehicle.registrationCompletedAt = registrationErrors.length ? undefined : new Date();
  await vehicle.save();
  const profile = await ProviderProfile.findById(providerId);
  if (profile?.onboarding?.vehicleId?.toString() === id && vehicle.verificationDetails) {
    for (const key of ['vehicleClass', 'ownerName', 'vehicleModel', 'vehicleMakeYear', 'engineNumber',
      'registrationNumber', 'driverName', 'driverPhone', 'driverEmail', 'driverPermanentAddress',
      'driverCnic', 'hasInsurance', 'insuranceCompany', 'insuranceNumber', 'insuranceYear',
      'driverExperienceYears', 'driverLicenseNumber', 'vehicleImageFront', 'vehicleImageBack', 'driverPhoto', 'driverEmergencyContact']) {
      profile.set(`transportDetails.${key}`, vehicle.verificationDetails[key]);
    }
    await profile.save();
  }
  return vehicle;
}

export async function deleteVehicle(providerId: string, id: string) {
  const vehicle = assertFound(await Vehicle.findById(id), 'Vehicle not found');
  if (vehicle.providerId.toString() !== providerId) {
    throw new AppError('You cannot delete this vehicle', 403);
  }
  await vehicle.deleteOne();
  return { deleted: true };
}

async function writeAudit(
  action: string,
  vehicleId: string,
  adminId: string,
  meta?: Record<string, unknown>
) {
  await AdminAuditLog.create({
    action,
    entityType: 'vehicle',
    entityId: vehicleId,
    adminId,
    meta,
  });
}

async function notifyProvider(providerId: string, title: string, message: string, data?: Record<string, unknown>) {
  const provider = await ProviderProfile.findById(providerId).select('userId');
  if (!provider?.userId) return;
  await notificationService.createNotification({
    userId: provider.userId.toString(),
    type: 'vehicle',
    title,
    message,
    data,
  });
}

export async function approveVehicle(vehicleId: string, adminId: string) {
  const vehicle = assertFound(await Vehicle.findById(vehicleId), 'Vehicle not found');
  if (vehicle.status === 'active') {
    throw new AppError('This vehicle has already been approved', 409);
  }
  if (vehicle.status !== 'pending' && vehicle.status !== 'rejected' && vehicle.status !== 'suspended') {
    throw new AppError('Only pending, rejected, or suspended vehicles can be approved', 422);
  }

  vehicle.status = 'active';
  vehicle.approvedBy = adminId as never;
  vehicle.approvedAt = new Date();
  vehicle.rejectionReason = undefined;
  vehicle.rejectedAt = undefined;
  vehicle.rejectedBy = undefined;
  vehicle.suspendedAt = undefined;
  vehicle.suspendedBy = undefined;
  await vehicle.save();

  await writeAudit('VEHICLE_APPROVED', vehicleId, adminId, { name: vehicle.name });
  await notifyProvider(
    vehicle.providerId.toString(),
    'Your vehicle has been approved',
    `${vehicle.name} has been approved and is now available for creating trips.`,
    { vehicleId }
  );

  return vehicle;
}

export async function rejectVehicle(vehicleId: string, adminId: string, reason: string) {
  const vehicle = assertFound(await Vehicle.findById(vehicleId), 'Vehicle not found');
  if (vehicle.status === 'rejected') {
    throw new AppError('This vehicle has already been rejected', 409);
  }
  if (vehicle.status !== 'pending') {
    throw new AppError('Only pending vehicles can be rejected', 422);
  }

  const trimmed = reason.trim();
  if (trimmed.length < 5) throw new AppError('Rejection reason is required', 422);

  vehicle.status = 'rejected';
  vehicle.rejectionReason = trimmed;
  vehicle.rejectedBy = adminId as never;
  vehicle.rejectedAt = new Date();
  await vehicle.save();

  await writeAudit('VEHICLE_REJECTED', vehicleId, adminId, { reason: trimmed, name: vehicle.name });
  await notifyProvider(
    vehicle.providerId.toString(),
    'Your vehicle needs attention',
    `${vehicle.name} was rejected. Reason: ${trimmed}`,
    { vehicleId, reason: trimmed }
  );

  return vehicle;
}

export async function suspendVehicle(vehicleId: string, adminId: string, reason?: string) {
  const vehicle = assertFound(await Vehicle.findById(vehicleId), 'Vehicle not found');
  if (vehicle.status !== 'active') {
    throw new AppError('Only active vehicles can be suspended', 422);
  }

  vehicle.status = 'suspended';
  vehicle.suspendedBy = adminId as never;
  vehicle.suspendedAt = new Date();
  if (reason?.trim()) vehicle.rejectionReason = reason.trim();
  await vehicle.save();

  await writeAudit('VEHICLE_SUSPENDED', vehicleId, adminId, {
    reason: reason?.trim(),
    name: vehicle.name,
  });
  await notifyProvider(
    vehicle.providerId.toString(),
    'Vehicle suspended',
    `${vehicle.name} has been suspended and is no longer available for new trips.`,
    { vehicleId }
  );

  return vehicle;
}

export async function getVehicleTripSummary(vehicleId: string) {
  const vehicle = assertFound(await Vehicle.findById(vehicleId), 'Vehicle not found');
  const trips = await Trip.find({
    vehicleId,
    status: { $nin: ['cancelled', 'completed'] },
  });

  const bookedSeats = trips.reduce((sum, trip) => sum + (trip.bookedSeats ?? 0), 0);
  const availableSeats = trips.reduce((sum, trip) => sum + (trip.availableSeats ?? 0), 0);

  return {
    vehicleId,
    totalSeats: vehicle.seatCount,
    activeTrips: trips.length,
    bookedSeats,
    availableSeats,
    trips: trips.map((trip) => ({
      id: trip._id.toString(),
      origin: trip.origin,
      destination: trip.destination,
      departureDate: trip.departureDate,
      departureTime: trip.departureTime,
      totalSeats: trip.totalSeats,
      availableSeats: trip.availableSeats,
      bookedSeats: trip.bookedSeats,
      status: trip.status,
    })),
  };
}
