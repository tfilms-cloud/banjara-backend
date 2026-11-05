import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { makeUser, type TestUser } from './helpers/auth';

type Role = 'anonymous' | 'customer' | 'provider' | 'admin';
type Endpoint = { method: 'get' | 'post' | 'put' | 'delete'; path: string; allowed: Role[] };

const FAKE_ID = '507f1f77bcf86cd799439011';

/**
 * One representative endpoint per area and verb. A role outside `allowed` must get 401
 * (anonymous) or 403 (signed in), whatever the body. An allowed role must never get
 * 401/403 (it may get 404/422 for the fake ids and empty bodies used here).
 */
const ENDPOINTS: Endpoint[] = [
  // Admin
  { method: 'get', path: '/api/admin/dashboard', allowed: ['admin'] },
  { method: 'get', path: '/api/admin/customers', allowed: ['admin'] },
  { method: 'get', path: '/api/admin/payments', allowed: ['admin'] },
  { method: 'get', path: '/api/admin/audit-logs', allowed: ['admin'] },
  { method: 'put', path: `/api/admin/providers/${FAKE_ID}/approve`, allowed: ['admin'] },
  { method: 'put', path: `/api/admin/providers/${FAKE_ID}/suspend`, allowed: ['admin'] },
  { method: 'post', path: '/api/auth/2fa/setup', allowed: ['admin'] },
  { method: 'put', path: `/api/support/${FAKE_ID}`, allowed: ['admin'] },
  // Provider
  { method: 'get', path: '/api/providers/dashboard', allowed: ['provider'] },
  { method: 'get', path: '/api/providers/bookings', allowed: ['provider'] },
  { method: 'get', path: '/api/providers/earnings', allowed: ['provider'] },
  { method: 'put', path: `/api/providers/bookings/${FAKE_ID}/status`, allowed: ['provider'] },
  { method: 'post', path: '/api/trips', allowed: ['provider'] },
  { method: 'put', path: `/api/trips/${FAKE_ID}`, allowed: ['provider'] },
  { method: 'post', path: '/api/vehicles', allowed: ['provider'] },
  { method: 'post', path: '/api/hotels', allowed: ['provider'] },
  { method: 'get', path: '/api/verification/cnic', allowed: ['provider'] },
  // Customer
  { method: 'post', path: '/api/bookings', allowed: ['customer'] },
  { method: 'get', path: '/api/bookings/my-bookings', allowed: ['customer'] },
  { method: 'get', path: '/api/favorites', allowed: ['customer'] },
  { method: 'post', path: '/api/reviews', allowed: ['customer'] },
  // Any signed-in user
  { method: 'get', path: '/api/auth/me', allowed: ['customer', 'provider', 'admin'] },
  { method: 'get', path: '/api/auth/sessions', allowed: ['customer', 'provider', 'admin'] },
  { method: 'get', path: '/api/users/me', allowed: ['customer', 'provider', 'admin'] },
  { method: 'get', path: '/api/notifications', allowed: ['customer', 'provider', 'admin'] },
];

describe('Security — role matrix (every role × every area)', () => {
  const app = createApp();
  const users: Partial<Record<Role, TestUser>> = {};

  beforeAll(async () => {
    await setupTestDb();
    await clearDatabase();
    users.customer = await makeUser(app, 'customer');
    // A hotel provider: a transport provider's dashboard also needs finished onboarding
    // (a business rule, deliberately 403), which is not what this matrix is about.
    users.provider = await makeUser(app, 'provider', { approved: true, service: 'hotel' });
    users.admin = await makeUser(app, 'admin');
  });
  afterAll(async () => {
    await teardownTestDb();
  });

  const roles: Role[] = ['anonymous', 'customer', 'provider', 'admin'];

  for (const endpoint of ENDPOINTS) {
    for (const role of roles) {
      const allowed = endpoint.allowed.includes(role);
      it(`${role.padEnd(9)} ${allowed ? 'may' : 'may not'} ${endpoint.method.toUpperCase()} ${endpoint.path}`, async () => {
        let req = request(app)[endpoint.method](endpoint.path);
        const user = role === 'anonymous' ? undefined : users[role];
        if (user) req = req.set('Authorization', `Bearer ${user.token}`);
        const res = await req.send({});
        if (allowed) {
          expect([401, 403]).not.toContain(res.status);
        } else {
          expect(res.status).toBe(role === 'anonymous' ? 401 : 403);
        }
      });
    }
  }
});
