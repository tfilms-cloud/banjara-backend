import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { User } from '../src/models/User';
import { comparePassword } from '../src/utils/password';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser } from './helpers/auth';

describe('Phase 1.1 — privilege escalation via PUT /api/users/me', () => {
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

  it('does not let a customer promote themselves to admin, and admin routes stay 403', async () => {
    const customer = await makeUser(app, 'customer');

    const res = await authed(app, customer.token).put('/api/users/me').send({ role: 'admin' });
    expect(res.status).not.toBe(500);

    const dbUser = await User.findById(customer.id);
    expect(dbUser?.role).toBe('customer');

    const adminRes = await authed(app, customer.token).get('/api/admin/dashboard');
    expect(adminRes.status).toBe(403);
  });

  it('does not let a customer overwrite passwordHash', async () => {
    const customer = await makeUser(app, 'customer');

    await authed(app, customer.token).put('/api/users/me').send({ passwordHash: '$2b$fake' });

    const dbUser = await User.findById(customer.id).select('+passwordHash');
    expect(await comparePassword(customer.password, dbUser!.passwordHash)).toBe(true);
  });

  it('does not let a customer change their own status', async () => {
    const customer = await makeUser(app, 'customer');

    await authed(app, customer.token).put('/api/users/me').send({ status: 'suspended' });

    const dbUser = await User.findById(customer.id);
    expect(dbUser?.status).toBe('active');
  });

  it('does not let a customer overwrite refreshTokenHash', async () => {
    const customer = await makeUser(app, 'customer');
    const before = await User.findById(customer.id).select('+refreshTokenHash');

    await authed(app, customer.token).put('/api/users/me').send({ refreshTokenHash: 'attacker-value' });

    const after = await User.findById(customer.id).select('+refreshTokenHash');
    expect(after?.refreshTokenHash).toBe(before?.refreshTokenHash);
  });

  it('still allows a legitimate profile update', async () => {
    const customer = await makeUser(app, 'customer');

    const res = await authed(app, customer.token).put('/api/users/me').send({ name: 'New Name' });
    expect(res.status).toBe(200);

    const dbUser = await User.findById(customer.id);
    expect(dbUser?.name).toBe('New Name');
  });

  it('ignores unknown fields without 500ing', async () => {
    const customer = await makeUser(app, 'customer');

    const res = await authed(app, customer.token).put('/api/users/me').send({ nonsense: 1 });
    expect(res.status).toBeLessThan(500);
  });

  it('requires authentication', async () => {
    const res = await authed(app).put('/api/users/me').send({ name: 'x' });
    expect(res.status).toBe(401);
  });
});
