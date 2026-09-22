import { z } from 'zod';

const stringList = z.array(z.string());

const transportDetailsSchema = z
  .object({
    businessName: z.string().optional(),
    vehicleTypes: stringList.optional(),
    vehicleCount: z.number().optional(),
    ownershipType: z.string().optional(),
    operatingCities: stringList.optional(),
    operatingRoutes: stringList.optional(),
    pickupLocations: stringList.optional(),
    dropoffLocations: stringList.optional(),
    description: z.string().optional(),
    pricingMethod: z.string().optional(),
    priceAmount: z.number().optional(),
    pricePercent: z.number().min(0).max(100).optional(),
  })
  .optional();

const hotelDetailsSchema = z
  .object({
    hotelName: z.string().optional(),
    hotelType: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    description: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    checkInTime: z.string().optional(),
    checkOutTime: z.string().optional(),
    amenities: stringList.optional(),
    images: stringList.optional(),
  })
  .optional();

const tourDetailsSchema = z
  .object({
    companyName: z.string().optional(),
    tourName: z.string().optional(),
    description: z.string().optional(),
    destination: z.string().optional(),
    duration: z.string().optional(),
    departureLocation: z.string().optional(),
    pickupLocations: stringList.optional(),
    price: z.number().optional(),
    maxParticipants: z.number().optional(),
    included: stringList.optional(),
    excluded: stringList.optional(),
    images: stringList.optional(),
  })
  .optional();

export const providerRegisterSchema = z.object({
  businessName: z.string().min(2),
  ownerName: z.string().min(2),
  providerType: z.array(z.string()).min(1).max(1),
  services: z.array(z.enum(['transport', 'hotel', 'tour', 'carRental', 'travelGuide'])).min(1).max(1),
  description: z.string().optional(),
  phone: z.string().min(10),
  email: z.string().email(),
  website: z.string().optional(),
  socialMedia: z.string().optional(),
  address: z.string().min(3),
  city: z.string().min(2),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  yearsExperience: z.number().optional(),
  transportDetails: transportDetailsSchema,
  hotelDetails: hotelDetailsSchema,
  tourDetails: tourDetailsSchema,
});

export const providerUpdateSchema = providerRegisterSchema.partial().extend({
  logo: z.string().url().optional().or(z.literal('')),
});
