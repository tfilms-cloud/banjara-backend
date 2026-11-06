import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { ProviderProfile } from '../src/models/ProviderProfile';
import { Vehicle } from '../src/models/Vehicle';
import { Trip } from '../src/models/Trip';
import mongoose from 'mongoose';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser, type TestUser } from './helpers/auth';

// Exercise the real multipart route, matching, persistence and progress logic.
// Only the OCR vendor boundary is deterministic; no real identity documents are used.
vi.mock('../src/services/ocr/ocr.service', () => ({
  extractCNICData: vi.fn(async () => ({
    cnicNumber: '3520212345671',
    fatherName: 'MUHAMMAD ALI',
    expiryDate: '2031-08-15',
    confidence: { cnicNumber: 99, fatherName: 99, expiryDate: 99 },
    provider: 'test',
  })),
}));

const details = {
  businessName: 'Test Transport',
  vehicleClass: 'van',
  vehicleTypes: ['van'],
  vehicleCount: 1,
  ownershipType: 'owned',
  operatingCities: ['Islamabad'],
  pricingMethod: 'per_seat',
  priceAmount: 4500,
  pricePercent: 20,
  ownerName: 'Test Owner',
  vehicleModel: 'Toyota Hiace',
  vehicleMakeYear: '2022',
  engineNumber: 'ENGINE-001',
  registrationNumber: 'TEST-123',
  driverName: 'Test Driver',
  driverPhone: '03001234567',
  driverPermanentAddress: 'Test Road Islamabad',
  driverCnic: '35202-7654321-1',
  driverLicenseNumber: 'LICENSE-123',
  driverExperienceYears: '0',
  driverEmergencyContact: '03007654321',
  hasInsurance: 'yes',
  insuranceCompany: 'Test Insurance',
  insuranceNumber: 'POLICY-123',
  insuranceYear: String(new Date().getFullYear()),
  vehicleImageFront: 'https://example.com/front.jpg',
  vehicleImageBack: 'https://example.com/back.jpg',
};

describe('Transportation onboarding through real authenticated APIs', () => {
  const app = createApp();
  let provider: TestUser;
  beforeAll(setupTestDb);
  afterAll(teardownTestDb);
  beforeEach(async () => {
    await clearDatabase();
    provider = await makeUser(app, 'provider', { approved: false });
    await authed(app, provider.token).put('/api/providers/me').send({ description: 'Reliable transport service', yearsExperience: 0 });
  });
  const me = () => authed(app, provider.token).get('/api/providers/me');
  const checkpoint = (step: string, vehicleId?: string) =>
    authed(app, provider.token)
      .post('/api/providers/me/onboarding/checkpoint')
      .send({ step, vehicleId });
  const submit = () =>
    authed(app, provider.token)
      .post('/api/providers/me/onboarding/submit')
      .send({});
  async function transportStep() {
    expect((await checkpoint('location')).status).toBe(200);
    expect(
      (
        await authed(app, provider.token)
          .put('/api/providers/me')
          .send({ transportDetails: details })
      ).status,
    ).toBe(200);
    const complete = await checkpoint('transport');
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
    return (await authed(app, provider.token).get('/api/vehicles')).body
      .data[0];
  }
  async function vehicleStep() {
    const vehicle = await transportStep();
    const saved = await authed(app, provider.token)
      .put(`/api/vehicles/${vehicle._id}`)
      .send({
        name: 'Primary Hiace',
        seatCount: 7,
        amenities: ['Air Conditioning'],
        verificationDetails: details,
        images: [details.vehicleImageFront, details.vehicleImageBack],
        status: 'active',
      });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.status).toBe('pending');
    expect((await checkpoint('vehicle', vehicle._id)).status).toBe(200);
    return vehicle;
  }
  async function verify() {
    // JPEG signature passes the upload boundary; OCR is injected above.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
    const response = await authed(app, provider.token)
      .post('/api/verification/cnic')
      .field('cnicNumber', '35202-1234567-1')
      .field('fatherName', 'MUHAMMAD ALI')
      .field('expiryDate', '15.08.2031')
      .attach('front', jpeg, {
        filename: 'front.jpg',
        contentType: 'image/jpeg',
      })
      .attach('back', jpeg, {
        filename: 'back.jpg',
        contentType: 'image/jpeg',
      });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.verified).toBe(true);
  }

  it('keeps public driver details separate from the gallery and excludes private driver information', async () => {
    await ProviderProfile.findByIdAndUpdate(provider.providerId, {
      transportDetails: { ...details, driverPhoto: 'https://example.com/driver.jpg' },
    });
    const response = await request(app).get(`/api/providers/public/${provider.providerId}`);
    expect(response.status).toBe(200);
    const profile = response.body.data;
    expect(profile.transportDetails).toMatchObject({
      driverName: details.driverName,
      driverPhoto: 'https://example.com/driver.jpg',
      driverExperienceYears: '0',
    });
    expect(profile.galleryImages).toEqual(expect.arrayContaining([details.vehicleImageFront, details.vehicleImageBack]));
    expect(profile.galleryImages).not.toContain('https://example.com/driver.jpg');
    for (const field of ['driverCnic', 'driverLicenseNumber', 'driverPhone', 'driverPermanentAddress', 'driverEmergencyContact']) {
      expect(profile.transportDetails).not.toHaveProperty(field);
    }
  });

  it('resumes the exact incomplete step, retains vehicle details, and gates the dashboard through submission and approval', async () => {
    expect((await me()).body.data.onboardingProgress.nextStep).toBe('location');
    expect((await checkpoint('transport')).status).toBe(422);
    expect((await submit()).status).toBe(422);
    const vehicle = await vehicleStep();
    expect((await me()).body.data.onboardingProgress.nextStep).toBe(
      'verification',
    );
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: provider.email, password: provider.password });
    provider.token = login.body.data.tokens.accessToken;
    expect((await me()).body.data.onboardingProgress.nextStep).toBe(
      'verification',
    );
    const stored = (
      await authed(app, provider.token).get(`/api/vehicles/${vehicle._id}`)
    ).body.data;
    expect(stored.seatCount).toBe(7);
    expect(stored.verificationDetails.engineNumber).toBe(details.engineNumber);
    expect(stored.amenities).toEqual(['Air Conditioning']);
    expect(
      (await authed(app, provider.token).get('/api/providers/dashboard'))
        .status,
    ).toBe(403);
    await verify();
    expect((await me()).body.data.onboardingProgress.nextStep).toBe('review');
    expect((await me()).body.data.transportDetails.driverCnic).toBe(
      details.driverCnic,
    );
    const submitted = await submit();
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.onboardingProgress.completed).toBe(true);
    const timestamp = submitted.body.data.onboardingProgress.submittedAt;
    expect((await submit()).body.data.onboardingProgress.submittedAt).toBe(
      timestamp,
    );
    expect(
      (await authed(app, provider.token).get('/api/providers/dashboard'))
        .status,
    ).toBe(403);
    await ProviderProfile.findByIdAndUpdate(provider.providerId, {
      verificationStatus: 'approved',
    });
    expect(
      (await authed(app, provider.token).get('/api/providers/dashboard'))
        .status,
    ).toBe(200);
    await Vehicle.findByIdAndDelete(vehicle._id);
    expect((await me()).body.data.onboardingProgress.nextStep).toBe('vehicle');
    expect(
      (await authed(app, provider.token).get('/api/providers/dashboard'))
        .status,
    ).toBe(403);
  });

  it('saving partial or failed submissions does not complete signup, even if admin approved the profile early', async () => {
    await ProviderProfile.findByIdAndUpdate(provider.providerId, {
      verificationStatus: 'approved',
    });
    await authed(app, provider.token)
      .put('/api/providers/me')
      .send({
        onboarding: { submittedAt: new Date(), locationConfirmed: true },
        identityVerification: { cnicVerified: true },
      });
    expect((await me()).body.data.onboardingProgress.nextStep).toBe('location');
    expect(
      (await checkpoint('location')).body.data.onboardingProgress.nextStep,
    ).toBe('transport');
    await authed(app, provider.token)
      .put('/api/providers/me')
      .send({ transportDetails: { vehicleModel: 'Incomplete' } });
    expect((await checkpoint('transport')).status).toBe(422);
    expect((await submit()).status).toBe(422);
    expect((await me()).body.data.onboardingProgress.completed).toBe(false);
    expect(
      (await authed(app, provider.token).get('/api/providers/dashboard'))
        .status,
    ).toBe(403);
  });

  it.each([
    ['driverPhone', '123'],
    ['driverEmergencyContact', 'invalid'],
    ['driverCnic', '123'],
    ['vehicleMakeYear', 'wrong'],
    ['driverExperienceYears', '-1'],
    ['hasInsurance', 'no'],
    ['vehicleImageBack', 'file:///local.jpg'],
    ['priceAmount', 0],
    ['vehicleCount', 1.5],
  ])('rejects invalid %s without advancing', async (field, value) => {
    await checkpoint('location');
    await authed(app, provider.token)
      .put('/api/providers/me')
      .send({ transportDetails: { ...details, [field]: value } });
    expect((await checkpoint('transport')).status).toBe(422);
    expect((await me()).body.data.onboardingProgress.nextStep).toBe(
      'transport',
    );
  });

  it('pending providers can add a complete vehicle, but cannot self-approve or edit another provider vehicle', async () => {
    const input = {
      name: 'Extra vehicle',
      type: 'van',
      vehicleModel: 'Toyota Hiace',
      year: 2022,
      registrationNumber: details.registrationNumber,
      seatCount: 7,
      verificationDetails: details,
      images: [details.vehicleImageFront, details.vehicleImageBack],
      status: 'active',
    };
    const invalid = await authed(app, provider.token)
      .post('/api/vehicles')
      .send({ ...input, verificationDetails: undefined });
    expect(invalid.status).toBe(422);
    const created = await authed(app, provider.token)
      .post('/api/vehicles')
      .send(input);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.status).toBe('pending');
    const id = created.body.data._id;
    for (const patch of [
      { seatCount: 0 },
      { seatCount: 1.5 },
      { year: 'wrong' },
      { verificationDetails: { hasInsurance: 'no' } },
    ]) {
      expect(
        (
          await authed(app, provider.token)
            .put(`/api/vehicles/${id}`)
            .send(patch)
        ).status,
      ).toBe(422);
    }
    const other = await makeUser(app, 'provider', { approved: false });
    expect(
      (
        await authed(app, other.token)
          .put(`/api/vehicles/${id}`)
          .send({ name: 'Stolen' })
      ).status,
    ).toBe(403);
    expect((await checkpoint('vehicle', id)).status).toBe(422);
    expect(
      (await authed(app, other.token).get(`/api/vehicles/${id}`)).body.data
        .verificationDetails,
    ).toBeUndefined();
    const customer = await makeUser(app, 'customer');
    expect(
      (await authed(app, customer.token).get('/api/vehicles')).body.data[0]
        .verificationDetails,
    ).toBeUndefined();
    expect(
      (await authed(app, customer.token).get(`/api/vehicles/${id}`)).body.data
        .verificationDetails,
    ).toBeUndefined();
  });

  it('a complete application can be submitted before the CNIC check passes, and is marked unverified', async () => {
    // Still refused while the application itself is incomplete.
    expect((await submit()).status).toBe(422);
    await vehicleStep();
    expect((await me()).body.data.onboardingProgress.nextStep).toBe('verification');

    const submitted = await submit();
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const progress = submitted.body.data.onboardingProgress;
    expect(progress.nextStep).toBe('submitted');
    expect(progress.completed).toBe(true);
    expect(progress.cnicVerified).toBe(false);
    expect(progress.completedSteps).not.toContain('verification');

    // Verifying afterwards keeps it submitted and records the CNIC as verified.
    await verify();
    const after = (await me()).body.data.onboardingProgress;
    expect(after.nextStep).toBe('submitted');
    expect(after.cnicVerified).toBe(true);
    expect(after.completedSteps).toContain('verification');
  });

  it('a driver can register only one vehicle; changing the plate updates it instead of adding another', async () => {
    const primary = await vehicleStep();
    const second = await authed(app, provider.token)
      .post('/api/vehicles')
      .send({
        name: 'Second vehicle',
        type: 'car',
        vehicleModel: 'Toyota Corolla',
        year: 2021,
        registrationNumber: 'SECOND-1',
        seatCount: 4,
        verificationDetails: { ...details, registrationNumber: 'SECOND-1' },
        images: [details.vehicleImageFront, details.vehicleImageBack],
      });
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.message).toMatch(/one vehicle/i);

    await authed(app, provider.token)
      .put('/api/providers/me')
      .send({ transportDetails: { ...details, registrationNumber: 'NEW-PLATE-9' } });
    const list = (await authed(app, provider.token).get('/api/vehicles')).body.data;
    expect(list).toHaveLength(1);
    expect(String(list[0]._id)).toBe(String(primary._id));
  });

  it('public trips never expose the driver identity documents', async () => {
    await vehicleStep();
    const profile = await ProviderProfile.findOne({ userId: provider.id });
    const tripId = new mongoose.Types.ObjectId();
    await Trip.collection.insertOne({
      _id: tripId,
      providerId: profile!._id,
      origin: 'Islamabad',
      destination: 'Hunza',
      status: 'scheduled',
    });
    const response = await request(app).get(`/api/trips/${tripId}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const transport = response.body.data.providerId.transportDetails;
    expect(transport.driverName).toBe(details.driverName);
    for (const secret of [
      'driverCnic',
      'driverLicenseNumber',
      'driverPermanentAddress',
      'driverEmergencyContact',
      'engineNumber',
      'insuranceNumber',
      'registrationNumber',
    ]) {
      expect(transport, secret).not.toHaveProperty(secret);
    }
  });

  it('repeated list/refresh calls preserve edited fields, photos and rejection state', async () => {
    const vehicle = await vehicleStep();
    await Vehicle.findByIdAndUpdate(vehicle._id, {
      status: 'rejected',
      rejectionReason: 'Check documents',
    });
    await authed(app, provider.token).get('/api/vehicles');
    const saved = await Vehicle.findById(vehicle._id);
    expect(saved?.name).toBe('Primary Hiace');
    expect(saved?.seatCount).toBe(7);
    expect(saved?.status).toBe('rejected');
    expect(
      await Vehicle.countDocuments({ providerId: provider.providerId }),
    ).toBe(1);
  });

  it('requires an explicit vehicle save, rather than accepting capacity guessed during signup', async () => {
    const vehicle = await transportStep();
    expect(vehicle.registrationCompletedAt).toBeUndefined();
    expect((await checkpoint('vehicle', vehicle._id)).status).toBe(422);
    expect((await me()).body.data.onboardingProgress.nextStep).toBe('vehicle');
  });

  it('rolls back a failed checkpoint and safely retries concurrent confirmations without duplicating the primary vehicle', async () => {
    await checkpoint('location');
    await authed(app, provider.token)
      .put('/api/providers/me')
      .send({ transportDetails: details });
    const fail = vi
      .spyOn(Vehicle.prototype, 'save')
      .mockRejectedValueOnce(new Error('Simulated interrupted save'));
    const failed = await checkpoint('transport');
    fail.mockRestore();
    expect(failed.status).toBe(500);
    expect((await me()).body.data.onboardingProgress.nextStep).toBe(
      'transport',
    );
    const results = await Promise.all([
      checkpoint('transport'),
      checkpoint('transport'),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(
      await Vehicle.countDocuments({ providerId: provider.providerId }),
    ).toBe(1);
    expect((await me()).body.data.onboardingProgress.nextStep).toBe('vehicle');
    expect((await me()).body.data.onboardingProgress.completedSteps).toEqual([
      'business',
      'location',
      'transport',
    ]);
  });

  it('keeps the map address and city consistent after saving and restoring the profile', async () => {
    const address = {
      city: 'Gilgit',
      street: 'Test Street',
      formattedAddress: 'Test Street, Gilgit',
      country: 'Pakistan',
    };
    const saved = await authed(app, provider.token)
      .put('/api/providers/me')
      .send({
        city: address.city,
        address: address.formattedAddress,
        structuredAddress: address,
        latitude: 35.9,
        longitude: 74.3,
      });
    expect(saved.status).toBe(200);
    const restored = (await me()).body.data;
    expect(restored.city).toBe('Gilgit');
    expect(restored.structuredAddress).toMatchObject(address);
    expect(restored.location.coordinates).toEqual([74.3, 35.9]);
  });

  it('keeps the primary vehicle consistent with profile edits without duplicating it or overwriting capacity, name and amenities', async () => {
    const vehicle = await vehicleStep();
    const changed = {
      ...details,
      registrationNumber: 'CORRECTED-456',
      driverName: 'Updated Driver',
    };
    expect(
      (
        await authed(app, provider.token)
          .put('/api/providers/me')
          .send({ transportDetails: changed })
      ).status,
    ).toBe(200);
    const saved = await Vehicle.findById(vehicle._id).select(
      '+verificationDetails',
    );
    expect(saved?.registrationNumber).toBe(changed.registrationNumber);
    expect(saved?.verificationDetails?.driverName).toBe(changed.driverName);
    expect(saved?.name).toBe('Primary Hiace');
    expect(saved?.seatCount).toBe(7);
    expect(saved?.amenities).toEqual(['Air Conditioning']);
    expect(
      await Vehicle.countDocuments({ providerId: provider.providerId }),
    ).toBe(1);
    expect((await me()).body.data.onboardingProgress.nextStep).toBe(
      'verification',
    );
    const admin = await makeUser(app, 'admin');
    const reviewed = await authed(app, admin.token).get(
      `/api/admin/vehicles/${vehicle._id}`,
    );
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.vehicle.verificationDetails.driverName).toBe(
      changed.driverName,
    );
  });

  it('leaves the existing hotel provider flow available', async () => {
    const hotel = await makeUser(app, 'provider', { service: 'hotel' });
    const profile = await authed(app, hotel.token).get('/api/providers/me');
    // Lodging has its own steps now (see lodging-lifecycle.test.ts), never transport's.
    expect(profile.body.data.onboardingProgress?.service).toBe('hotel');
    expect(profile.body.data.onboardingProgress?.nextStep).not.toBe('transport');
    expect(
      (await authed(app, hotel.token).get('/api/providers/dashboard')).status,
    ).toBe(200);
  });
});
