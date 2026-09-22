import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser } from './helpers/auth';

describe('Audit regressions — final surface probes', () => {
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

  it('does not pollute Object.prototype via preferences', async () => {
    const customer = await makeUser(app, 'customer');

    const res = await authed(app, customer.token)
      .put('/api/users/me')
      .send({ preferences: { __proto__: { polluted: true }, theme: 'dark' } });
    expect(res.status).not.toBe(500);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('hotel quote does not 500 on a malformed body', async () => {
    const res = await request(app).post('/api/hotels/quote').send({ rooms: 'lots' });
    expect(res.status).toBeLessThan(500);
  });

  it('malformed ids return a 4xx, never a 500', async () => {
    const admin = await makeUser(app, 'admin');
    const customer = await makeUser(app, 'customer');

    const responses = await Promise.all([
      request(app).get('/api/hotels/not-an-id'),
      request(app).get('/api/trips/not-an-id'),
      authed(app, customer.token).get('/api/bookings/not-an-id'),
      authed(app, admin.token).get('/api/payments/not-an-id'),
      authed(app, admin.token).put('/api/support/not-an-id').send({ status: 'closed' }),
      authed(app, admin.token).get('/api/admin/providers/not-an-id'),
    ]);

    for (const res of responses) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it('a non-existent but valid payment id returns 404, not 403', async () => {
    const admin = await makeUser(app, 'admin');
    const res = await authed(app, admin.token).get('/api/payments/000000000000000000000000');
    expect(res.status).toBe(404);
  });
});
