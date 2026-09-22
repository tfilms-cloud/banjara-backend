import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { makeUser } from './helpers/auth';
import { requestResetToken } from './helpers/reset';

function rawResetTokens() {
  return mongoose.connection.collection('passwordresettokens');
}

describe('Phase 1.2 — password reset account takeover', () => {
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

  it('never returns the reset code or token in the response body', async () => {
    const user = await makeUser(app, 'customer');

    const res = await request(app).post('/api/auth/forgot-password').send({ email: user.email });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('demoCode');
    expect(JSON.stringify(res.body)).not.toMatch(/[a-f0-9]{32,}/i);
  });

  it('rejects the previously hard-coded code "123456"', async () => {
    const user = await makeUser(app, 'customer');
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: '123456', newPassword: 'NewPass123' });

    expect(res.status).toBe(400);
  });

  it('accepts a delivered token exactly once', async () => {
    const user = await makeUser(app, 'customer');
    const token = await requestResetToken(app, user.email);
    expect(token).toBeTruthy();

    const first = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: token, newPassword: 'NewPass123' });
    expect(first.status).toBe(200);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'NewPass123' });
    expect(login.status).toBe(200);

    const second = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: token, newPassword: 'Another123' });
    expect(second.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    const user = await makeUser(app, 'customer');
    const token = await requestResetToken(app, user.email);
    expect(token).toBeTruthy();

    await rawResetTokens().updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: token, newPassword: 'NewPass123' });
    expect(res.status).toBe(400);
  });

  it('kills refresh tokens issued before the reset', async () => {
    const user = await makeUser(app, 'customer');
    const oldRefresh = user.refreshToken;
    const token = await requestResetToken(app, user.email);
    expect(token).toBeTruthy();

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: token, newPassword: 'NewPass123' });
    expect(reset.status).toBe(200);

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: oldRefresh });
    expect(refreshed.status).toBe(401);
  });

  it('burns the token after five failed attempts', async () => {
    const user = await makeUser(app, 'customer');
    const token = await requestResetToken(app, user.email);
    expect(token).toBeTruthy();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await request(app)
        .post('/api/auth/reset-password')
        .send({ email: user.email, code: 'deadbeefdeadbeef', newPassword: 'NewPass123' });
    }

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: token, newPassword: 'NewPass123' });
    expect(res.status).toBe(400);
  });

  it('returns the same status and body for unknown and known emails', async () => {
    const known = await makeUser(app, 'customer');
    const unknownEmail = `nobody_${Date.now()}@example.com`;

    const knownRes = await request(app).post('/api/auth/forgot-password').send({ email: known.email });
    const unknownRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: unknownEmail });

    expect(knownRes.status).toBe(200);
    expect(unknownRes.status).toBe(knownRes.status);
    expect(unknownRes.body).toEqual(knownRes.body);
  });
});
