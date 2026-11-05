export const text = (value: unknown) => String(value ?? '').trim();
export const phone = (value: unknown) =>
  /^\+?\d{10,15}$/.test(text(value).replace(/[\s()-]/g, ''));
const year = (value: unknown) =>
  /^\d{4}$/.test(text(value)) &&
  Number(value) >= 1980 &&
  Number(value) <= new Date().getFullYear() + 1;
const image = (value: unknown) => /^https?:\/\//i.test(text(value));

/** Used for checkpoints and submission; saving a draft alone never completes a step. */
export function transportErrors(details: Record<string, unknown> = {}) {
  const errors: string[] = [];
  const labels: Record<string, string> = {
    ownerName: 'Vehicle owner name',
    vehicleModel: 'Vehicle model',
    engineNumber: 'Engine number',
    registrationNumber: 'Registration number',
    driverName: 'Driver name',
    driverPermanentAddress: 'Driver permanent address',
    driverLicenseNumber: 'Driver license number',
    insuranceCompany: 'Insurance company',
    insuranceNumber: 'Insurance policy number',
  };
  for (const [key, label] of Object.entries(labels))
    if (!text(details[key])) errors.push(`${label} is required.`);
  if (
    ![
      'car',
      'jeep',
      'suv',
      'van',
      'mini_bus',
      'minibus',
      'bus',
      'coaster',
      'tourVehicle',
      'other',
    ].includes(text(details.vehicleClass))
  )
    errors.push('Select a vehicle type.');
  if (!year(details.vehicleMakeYear))
    errors.push('Enter a valid vehicle model year.');
  if (!phone(details.driverPhone))
    errors.push('Enter a valid driver phone number (10–15 digits).');
  if (!phone(details.driverEmergencyContact))
    errors.push('Enter a valid emergency contact (10–15 digits).');
  if (text(details.driverCnic).replace(/\D/g, '').length !== 13)
    errors.push('Driver CNIC must contain 13 digits.');
  if (
    text(details.driverEmail) &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(details.driverEmail))
  )
    errors.push('Enter a valid driver email.');
  if (details.hasInsurance !== 'yes')
    errors.push('Valid vehicle insurance is required.');
  if (!year(details.insuranceYear))
    errors.push('Enter a valid insurance year.');
  if (
    !/^\d+$/.test(text(details.driverExperienceYears)) ||
    Number(details.driverExperienceYears) > 80
  )
    errors.push('Driver experience must be a whole number from 0 to 80.');
  if (!image(details.vehicleImageFront) || !image(details.vehicleImageBack))
    errors.push('Upload both front and back vehicle photos.');
  return errors;
}

export function transportPricingErrors(details: Record<string, unknown> = {}) {
  const errors: string[] = [];
  if (
    !['per_seat', 'per_vehicle', 'negotiable'].includes(
      text(details.pricingMethod),
    )
  )
    errors.push('Select a pricing method.');
  if (
    details.pricingMethod !== 'negotiable' &&
    !(Number.isFinite(details.priceAmount) && Number(details.priceAmount) > 0)
  )
    errors.push('Enter a positive fare or choose Negotiable.');
  if (
    details.pricePercent != null &&
    (!Number.isFinite(details.pricePercent) ||
      Number(details.pricePercent) < 0 ||
      Number(details.pricePercent) > 100)
  )
    errors.push('Advance payment must be between 0 and 100.');
  if (
    !Number.isInteger(details.vehicleCount) ||
    Number(details.vehicleCount) < 1
  )
    errors.push('Vehicle count must be a positive whole number.');
  return errors;
}

export function vehicleRegistrationErrors(vehicle: {
  name: string;
  year: number;
  registrationNumber: string;
  vehicleModel: string;
  seatCount: number;
  images: string[];
  verificationDetails?: Record<string, unknown>;
}) {
  const details = vehicle.verificationDetails ?? {};
  const errors = transportErrors(details);
  if (text(vehicle.name).length < 2)
    errors.push('Vehicle name must contain at least two characters.');
  if (!Number.isInteger(vehicle.seatCount) || vehicle.seatCount < 1)
    errors.push('Enter the passenger seat capacity.');
  if (
    !year(vehicle.year) ||
    text(vehicle.year) !== text(details.vehicleMakeYear) ||
    text(vehicle.vehicleModel) !== text(details.vehicleModel) ||
    text(vehicle.registrationNumber) !== text(details.registrationNumber)
  )
    errors.push('Vehicle identity must match the registration details.');
  if (
    !vehicle.images.includes(text(details.vehicleImageFront)) ||
    !vehicle.images.includes(text(details.vehicleImageBack))
  )
    errors.push('Include both front and back photos in the vehicle gallery.');
  return errors;
}
