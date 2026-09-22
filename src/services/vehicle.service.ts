import { Vehicle } from '../models/Vehicle';
import { Trip } from '../models/Trip';
import { ProviderProfile } from '../models/ProviderProfile';
import { AdminAuditLog } from '../models/AdminAuditLog';
import { AppError, assertFound } from '../utils/AppError';
import { assertApprovedProvider } from './provider.service';
import * as notificationService from './notification.service';

const VEHICLE_TYPES = [
  'van',
  'bus',
  'car',
  'minibus',
  'tourVehicle',
  'coaster',
  'suv',
  'other',
] as const;

type VehicleType = (typeof VEHICLE_TYPES)[number];

function normalizeVehicleType(value: unknown): VehicleType {
  const type = String(value ?? 'other');
  return (VEHICLE_TYPES as readonly string[]).includes(type) ? (type as VehicleType) : 'other';
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
    status: 'pending' as const,
  };
}

export async function createVehicle(providerId: string, input: Record<string, unknown>) {
  await assertApprovedProvider(providerId);
  return Vehicle.create({
    ...normalizeCreateInput(input),
    providerId,
  });
}

export async function listVehicles(providerId?: string, onlyActive = false) {
  const filter: Record<string, unknown> = providerId ? { providerId } : {};
  if (onlyActive) filter.status = 'active';
  return Vehicle.find(filter).sort({ createdAt: -1 });
}

export async function listActiveVehiclesForProvider(providerId: string) {
  return Vehicle.find({ providerId, status: 'active' }).sort({ createdAt: -1 });
}

export async function getVehicle(id: string) {
  return assertFound(await Vehicle.findById(id), 'Vehicle not found');
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
] as const;

export async function updateVehicle(providerId: string, id: string, patch: Record<string, unknown>) {
  const vehicle = assertFound(await Vehicle.findById(id), 'Vehicle not found');
  if (vehicle.providerId.toString() !== providerId) {
    throw new AppError('You cannot modify this vehicle', 403);
  }

  const update: Record<string, unknown> = {};
  for (const field of VEHICLE_PROVIDER_FIELDS) {
    if (patch[field] !== undefined) update[field] = patch[field];
  }
  if (update.seatCount == null && patch.totalSeats != null) {
    update.seatCount = patch.totalSeats;
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
  await vehicle.save();
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
