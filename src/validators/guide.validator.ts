import { z } from 'zod';

const stringList = z.array(z.string()).optional();

const languageSchema = z.object({
  language: z.string().min(1),
  proficiency: z.enum(['basic', 'conversational', 'fluent', 'native']),
});

const documentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['cnic', 'guide_license', 'tourism_cert', 'first_aid', 'mountain_cert', 'other']),
  label: z.string().optional(),
  number: z.string().optional(),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
  fileUrl: z.string().min(1),
  status: z.enum(['pending', 'verified', 'rejected', 'expired']).default('pending'),
  rejectionReason: z.string().optional(),
});

const photoSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  category: z.enum([
    'profile',
    'action',
    'mountains',
    'destinations',
    'trekking',
    'tours',
    'other',
  ]),
  caption: z.string().optional(),
});

const offeredServiceObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2),
  category: z.enum([
    'local',
    'tour',
    'trekking',
    'hiking',
    'cultural',
    'adventure',
    'mountain',
    'photography',
    'other',
  ]),
  description: z.string().default(''),
  durationLabel: z.string().min(1),
  durationHours: z.number().positive().optional(),
  price: z.number().nonnegative(),
  pricingType: z.enum(['per_person', 'per_group', 'per_hour', 'per_day', 'custom']),
  currency: z.string().default('PKR'),
  minGuests: z.number().int().positive().default(1),
  maxGuests: z.number().int().positive(),
  included: z.array(z.string()).default([]),
  excluded: z.array(z.string()).default([]),
  meetingPoint: z.string().optional(),
  availableLocations: z.array(z.string()).default([]),
  notes: z.string().optional(),
  active: z.boolean().default(true),
});

function refineGuestLimits(
  data: { minGuests?: number; maxGuests?: number },
  ctx: z.RefinementCtx
) {
  if (
    data.minGuests != null &&
    data.maxGuests != null &&
    data.maxGuests < data.minGuests
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'maxGuests must be >= minGuests',
      path: ['maxGuests'],
    });
  }
}

const offeredServiceSchema = offeredServiceObjectSchema.superRefine(refineGuestLimits);

const dayAvailabilitySchema = z
  .object({
    day: z.enum([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]),
    enabled: z.boolean(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .superRefine((data, ctx) => {
    if (data.enabled && data.endTime <= data.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endTime must be after startTime',
        path: ['endTime'],
      });
    }
  });

export const guideAvailabilitySchema = z.object({
  weekly: z.array(dayAvailabilitySchema).min(1),
  minBookingHours: z.number().positive().optional(),
  maxBookingHours: z.number().positive().optional(),
  advanceBookingHours: z.number().nonnegative().optional(),
  availableFrom: z.string().optional(),
  availableUntil: z.string().optional(),
  blockedDates: z.array(z.string()).default([]),
});

export const guideDetailsSchema = z
  .object({
    profileStatus: z
      .enum(['draft', 'pending', 'changes_requested', 'approved', 'rejected', 'suspended'])
      .optional(),
    changesRequestedNote: z.string().optional(),
    fullName: z.string().optional(),
    profilePhoto: z.string().optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    dateOfBirth: z.string().optional(),
    age: z.number().int().positive().max(120).optional(),
    phone: z.string().optional(),
    whatsapp: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    cnicNumber: z.string().optional(),
    cnicFrontUrl: z.string().optional(),
    cnicBackUrl: z.string().optional(),
    country: z.string().optional(),
    province: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
    currentLocation: z.string().optional(),
    areasCovered: stringList,
    pickupLocations: stringList,
    guideTypes: z
      .array(
        z.enum([
          'local',
          'tour',
          'trekking',
          'hiking',
          'cultural',
          'adventure',
          'mountain',
          'photography',
          'other',
        ])
      )
      .optional(),
    customGuideType: z.string().optional(),
    yearsExperience: z.number().nonnegative().optional(),
    shortBio: z.string().optional(),
    detailedDescription: z.string().optional(),
    specialSkills: stringList,
    areasOfExpertise: stringList,
    certifications: stringList,
    training: stringList,
    awards: stringList,
    languages: z.array(languageSchema).optional(),
    documents: z.array(documentSchema).optional(),
    photos: z.array(photoSchema).optional(),
    services: z.array(offeredServiceSchema).optional(),
    availability: guideAvailabilitySchema.optional(),
    dailyHireRate: z.number().nonnegative().optional(),
  })
  .passthrough()
  .optional();

export const guideOfferedServiceCreateSchema = offeredServiceSchema;
export const guideOfferedServiceUpdateSchema = offeredServiceObjectSchema
  .partial()
  .extend({
    id: z.string().min(1),
  })
  .superRefine(refineGuestLimits);

export const submitGuideForReviewSchema = z.object({
  note: z.string().optional(),
});
