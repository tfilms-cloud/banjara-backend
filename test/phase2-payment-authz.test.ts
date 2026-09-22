import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../src/app';
import { Payment } from '../src/models/Payment';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser } from './helpers/auth';

async function makePayment(customerId: string, providerProfileId: string, status = 'paid') {
  return Payment.create({
    bookingId: new mongoose.Types.ObjectId(),
    customerId,
    providerId: providerProfileId,
    amount: 1000,
    method: 'card',
    status,
  });
}

describe('Phase 2.1 — payment read/refund authorization', () => {
  const app = createApp();

  beforeAll(async () => {
    await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await clearDatabase();
  });

  it("returns 404 when a customer reads another customer's payment", async () => {
    const customerA = await makeUser(app, 'customer');
    const customerB = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider');
    const payment = await makePayment(customerB.id, provider.providerId!);

    const res = await authed(app, customerA.token).get(`/api/payments/${payment._id}`);
    expect(res.status).toBe(404);
  });

  it('lets a customer read their own payment', async () => {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider');
    const payment = await makePayment(customer.id, provider.providerId!);

    const res = await authed(app, customer.token).get(`/api/payments/${payment._id}`);
    expect(res.status).toBe(200);
  });

  it("returns 404 when a provider reads another provider's payment", async () => {
    const customer = await makeUser(app, 'customer');
    const providerX = await makeUser(app, 'provider');
    const providerY = await makeUser(app, 'provider');
    const payment = await makePayment(customer.id, providerY.providerId!);

    const res = await authed(app, providerX.token).get(`/api/payments/${payment._id}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when a provider refunds another provider's payment", async () => {
    const customer = await makeUser(app, 'customer');
    const providerX = await makeUser(app, 'provider');
    const providerY = await makeUser(app, 'provider');
    const payment = await makePayment(customer.id, providerY.providerId!);

    const res = await authed(app, providerX.token).post(`/api/payments/${payment._id}/refund`);
    expect(res.status).toBe(404);

    const after = await Payment.findById(payment._id);
    expect(after?.status).toBe('paid');
  });

  it("lets a provider refund their own booking's payment", async () => {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider');
    const payment = await makePayment(customer.id, provider.providerId!);

    const res = await authed(app, provider.token).post(`/api/payments/${payment._id}/refund`);
    expect(res.status).toBe(200);

    const after = await Payment.findById(payment._id);
    expect(after?.status).toBe('refunded');
  });

  it('forbids a customer from refunding even their own payment', async () => {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider');
    const payment = await makePayment(customer.id, provider.providerId!);

    const res = await authed(app, customer.token).post(`/api/payments/${payment._id}/refund`);
    expect(res.status).toBe(403);
  });

  it('lets an admin read and refund any payment', async () => {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider');
    const admin = await makeUser(app, 'admin');
    const payment = await makePayment(customer.id, provider.providerId!);

    const read = await authed(app, admin.token).get(`/api/payments/${payment._id}`);
    expect(read.status).toBe(200);

    const refund = await authed(app, admin.token).post(`/api/payments/${payment._id}/refund`);
    expect(refund.status).toBe(200);
  });

  it('requires authentication', async () => {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider');
    const payment = await makePayment(customer.id, provider.providerId!);

    const res = await authed(app).get(`/api/payments/${payment._id}`);
    expect(res.status).toBe(401);
  });

  it('handles a malformed payment id without a 500', async () => {
    const admin = await makeUser(app, 'admin');
    const res = await authed(app, admin.token).get('/api/payments/not-a-valid-id');
    expect(res.status).toBeLessThan(500);
  });
});
