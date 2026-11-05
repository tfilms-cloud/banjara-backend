import { z } from 'zod';
import { guideDetailsSchema } from './guide.validator';
import { structuredAddressSchema } from './location.validator';

const stringList = z.array(z.string());

export const transportDetailsSchema = z
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
    vehicleClass: z.string().optional(),
    ownerName: z.string().optional(),
    vehicleModel: z.string().optional(),
    vehicleMakeYear: z.string().optional(),
    engineNumber: z.string().optional(),
    registrationNumber: z.string().optional(),
    driverName: z.string().optional(),
    driverPhone: z.string().optional(),
    driverEmail: z.string().optional(),
    driverPermanentAddress: z.string().optional(),
    driverCnic: z.string().optional(),
    hasInsurance: z.string().optional(),
    insuranceCompany: z.string().optional(),
    insuranceNumber: z.string().optional(),
    insuranceYear: z.string().optional(),
    driverExperienceYears: z.string().optional(),
    driverLicenseNumber: z.string().optional(),
    vehicleImageFront: z.string().optional(),
    vehicleImageBack: z.string().optional(),
    driverPhoto: z.string().optional(),
    driverEmergencyContact: z.string().optional(),
  })
  .optional();

const hotelDetailsSchema = z
  .object({
    hotelName: z.string().optional(),
    hotelType: z.string().optional(),
    managerName: z.string().optional(),
    landline: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    village: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
    googleMapsUrl: z.string().optional(),
    businessRegistered: z.string().optional(),
    businessRegistrationNumber: z.string().optional(),
    yearsExperience: z.coerce.number().optional(),
    website: z.string().optional(),
    socialFacebook: z.string().optional(),
    socialInstagram: z.string().optional(),
    socialTiktok: z.string().optional(),
    restaurantAvailable: z.string().optional(),
    outlookImages: stringList.optional(),
    roomImages: stringList.optional(),
    restaurantImages: stringList.optional(),
    description: z.string().optional(),
    checkInTime: z.string().optional(),
    checkOutTime: z.string().optional(),
    amenities: stringList.optional(),
    images: stringList.optional(),
  })
  .passthrough()
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
    gender: z.enum(['male', 'female']).optional(),
    regionalLanguages: stringList.optional(),
    internationalLanguages: stringList.optional(),
    yearsExperience: z.number().optional(),
    experienceHistory: z.string().optional(),
    specialties: stringList.optional(),
    operatingAreas: stringList.optional(),
    certifications: stringList.optional(),
    dailyHireRate: z.number().optional(),
  })
  .optional();

const restaurantDetailsSchema = z
  .object({
    restaurantName: z.string().optional(),
    cuisineTypes: stringList.optional(),
    menuVariety: stringList.optional(),
    city: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    description: z.string().optional(),
    images: stringList.optional(),
    offers: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string(),
          type: z.enum(['sale', 'offer', 'discount']).optional(),
          discountPercent: z.number().optional(),
          description: z.string().optional(),
          active: z.boolean().optional(),
        })
      )
      .optional(),
    hours: z.string().optional(),
    website: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  })
  .optional();

export const providerRegisterSchema = z.object({
  businessName: z.string().min(2),
  ownerName: z.string().min(2),
  providerType: z.array(z.string()).min(1).max(1),
  services: z
    .array(z.enum(['transport', 'hotel', 'tour', 'carRental', 'travelGuide', 'restaurant']))
    .min(1)
    .max(1),
  description: z.string().optional(),
  phone: z.string().min(10),
  email: z.string().email(),
  website: z.string().optional(),
  socialMedia: z.string().optional(),
  address: z.string().min(3),
  city: z.string().min(2),
  structuredAddress: structuredAddressSchema.optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  yearsExperience: z.number().optional(),
  transportDetails: transportDetailsSchema,
  hotelDetails: hotelDetailsSchema,
  tourDetails: tourDetailsSchema,
  restaurantDetails: restaurantDetailsSchema,
  guideDetails: guideDetailsSchema,
});

export const providerUpdateSchema = providerRegisterSchema.partial().extend({
  logo: z.string().url().optional().or(z.literal('')),
});
