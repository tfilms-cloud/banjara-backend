import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { User } from '../src/models/User';
import { hashPassword } from '../src/utils/password';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser } from './helpers/auth';

const register = (app: ReturnType<typeof createApp>, password: string) =>
  request(app).post('/api/auth/register').send({
    name: 'Policy Test',
    email: `policy-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    phone: '03001234567',
    password,
  });

describe('Security — password policy', () => {
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

  it.each([
    ['too short', 'abc12'],
    ['letters only', 'onlyletters'],
    ['digits only', '1234567890'],
    ['over bcrypt limit', `a1${'x'.repeat(80)}`],
  ])('rejects a %s password at registration', async (_label, password) => {
    const res = await register(app, password);
    expect(res.status).toBe(422);
  });

  it('accepts a password with 8+ characters, a letter and a number', async () => {
    const res = await register(app, 'Travel2026');
    expect(res.status).toBe(201);
  });

  it('rejects a weak new password on change', async () => {
    const user = await makeUser(app, 'customer');
    const res = await authed(app, user.token)
      .put('/api/users/me/password')
      .send({ currentPassword: 'Password123', newPassword: 'weakpass' });
    expect(res.status).toBe(422);
  });

  it('still lets an account created under the old 6-character rule sign in', async () => {
    await User.create({
      name: 'Legacy',
      email: 'legacy@example.com',
      phone: '03001234567',
      passwordHash: await hashPassword('abc123'),
      role: 'customer',
      status: 'active',
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'legacy@example.com', password: 'abc123' });
    expect(res.status).toBe(200);
  });
});
