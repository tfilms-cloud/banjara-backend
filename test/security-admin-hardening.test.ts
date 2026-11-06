import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { AdminAuditLog } from '../src/models/AdminAuditLog';
import { User } from '../src/models/User';
import { hashPassword } from '../src/utils/password';
import { base32Encode, currentStep, matchTotp, totpAt } from '../src/utils/totp';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { makeUser } from './helpers/auth';

const ADMIN_EMAIL = 'root@example.com';
const PASSWORD = 'Password123';

describe('Security — TOTP implementation', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    // RFC 6238 Appendix B (8-digit values; ours are the last 6 digits).
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [seconds, code] of vectors) {
      expect(totpAt(secret, Math.floor(seconds / 30))).toBe(code);
    }
  });

  it('accepts one step of clock drift but not two', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = Date.now();
    const step = currentStep(now);
    expect(matchTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, totpAt(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, totpAt(secret, step - 2), now)).toBeNull();
    expect(matchTotp(secret, 'abcdef', now)).toBeNull();
  });
});

describe('Security — account lockout and admin 2-step verification', () => {
  const app = createApp();

  beforeAll(async () => {
    await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await clearDatabase();
    await User.create({
      name: 'Root Admin',
      email: ADMIN_EMAIL,
      phone: '03001234567',
      passwordHash: await hashPassword(PASSWORD),
      role: 'admin',
      status: 'active',
    });
  });
  afterEach(() => {
    env.ADMIN_REQUIRE_2FA = false;
  });

  const login = (password = PASSWORD, email = ADMIN_EMAIL) =>
    request(app).post('/api/auth/login').send({ email, password });
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Signs in and turns on 2-step verification; returns the secret and recovery codes. */
  async function enrol() {
    const access = (await login()).body.data.tokens.accessToken as string;
    const setup = await request(app).post('/api/auth/2fa/setup').set(bearer(access)).send({});
    expect(setup.status).toBe(200);
    const secret = setup.body.data.secret as string;
    expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\/BANJARA%3Aroot%40example\.com\?secret=/);
    const enable = await request(app)
      .post('/api/auth/2fa/enable')
      .set(bearer(access))
      .send({ code: totpAt(secret, currentStep()) });
    expect(enable.status).toBe(200);
    return { secret, recoveryCodes: enable.body.data.recoveryCodes as string[], access };
  }

  it('locks an account for 15 minutes after 5 wrong passwords, even with the right one after', async () => {
    for (let i = 0; i < 4; i += 1) expect((await login('WrongPass1')).status).toBe(401);
    const fifth = await login('WrongPass1');
    expect(fifth.status).toBe(429);
    expect(fifth.body.message).toMatch(/Try again in 15 minutes/);

    expect((await login()).status).toBe(429);

    // Once the lock runs out, the right password works and the counter resets.
    await User.updateOne({ email: ADMIN_EMAIL }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await login()).status).toBe(200);
    const user = await User.findOne({ email: ADMIN_EMAIL }).select('+failedLoginAttempts +lockedUntil');
    expect(user?.failedLoginAttempts).toBe(0);
    expect(user?.lockedUntil).toBeUndefined();
  });

  it('a successful sign-in resets the failure count', async () => {
    for (let i = 0; i < 4; i += 1) await login('WrongPass1');
    expect((await login()).status).toBe(200);
    for (let i = 0; i < 4; i += 1) expect((await login('WrongPass1')).status).toBe(401);
  });

  it('with 2-step on, the password alone gives no tokens, only a short-lived step token', async () => {
    const { secret } = await enrol();
    const first = await login();
    expect(first.status).toBe(200);
    expect(first.body.data.mfaRequired).toBe(true);
    expect(first.body.data.tokens).toBeUndefined();
    const mfaToken = first.body.data.mfaToken as string;

    // The step token is not an access token.
    expect((await request(app).get('/api/auth/me').set(bearer(mfaToken))).status).toBe(401);
    expect((await request(app).get('/api/admin/dashboard').set(bearer(mfaToken))).status).toBe(401);

    const done = await request(app)
      .post('/api/auth/login/2fa')
      .send({ mfaToken, code: totpAt(secret, currentStep() + 1) });
    expect(done.status).toBe(200);
    expect(done.body.data.tokens.accessToken).toBeTruthy();
    expect(done.body.data.user.twoFactorEnabled).toBe(true);
  });

  it('a 2-step code cannot be used twice', async () => {
    const { secret } = await enrol();
    // Replay the exact code enrol() used (its step is stored), whatever the clock says now.
    const raw = await User.collection.findOne({ email: ADMIN_EMAIL });
    const usedStep = raw?.twoFactor?.lastUsedStep as number;
    const mfaToken = (await login()).body.data.mfaToken as string;
    const reused = await request(app)
      .post('/api/auth/login/2fa')
      .send({ mfaToken, code: totpAt(secret, usedStep) });
    expect(reused.status).toBe(401);
  });

  it('wrong 2-step codes count toward the lockout', async () => {
    await enrol();
    const mfaToken = (await login()).body.data.mfaToken as string;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await request(app).post('/api/auth/login/2fa').send({ mfaToken, code: '000000' })).status);
    }
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(statuses[4]).toBe(429);
  });

  it('a recovery code works once', async () => {
    const { recoveryCodes } = await enrol();
    expect(recoveryCodes).toHaveLength(10);
    const code = recoveryCodes[0];

    const t1 = (await login()).body.data.mfaToken as string;
    expect((await request(app).post('/api/auth/login/2fa').send({ mfaToken: t1, code })).status).toBe(200);

    const t2 = (await login()).body.data.mfaToken as string;
    expect((await request(app).post('/api/auth/login/2fa').send({ mfaToken: t2, code })).status).toBe(401);

    // A different recovery code still works, and the count went down.
    const t3 = (await login()).body.data.mfaToken as string;
    const signedIn = await request(app).post('/api/auth/login/2fa').send({ mfaToken: t3, code: recoveryCodes[1] });
    expect(signedIn.status).toBe(200);
    const status = await request(app).get('/api/auth/2fa').set(bearer(signedIn.body.data.tokens.accessToken));
    expect(status.body.data).toMatchObject({ enabled: true, recoveryCodesLeft: 8 });
  });

  it('stores the 2-step secret encrypted, never in plain text', async () => {
    const { secret } = await enrol();
    const raw = await User.collection.findOne({ email: ADMIN_EMAIL });
    const stored = JSON.stringify(raw?.twoFactor);
    expect(stored).not.toContain(secret);
    expect(raw?.twoFactor?.secret).toMatch(/^v1\./);
  });

  it('turning it off needs the password and a valid code', async () => {
    const { secret } = await enrol();
    const t = (await login()).body.data.mfaToken as string;
    const done = await request(app)
      .post('/api/auth/login/2fa')
      .send({ mfaToken: t, code: totpAt(secret, currentStep() + 1) });
    const access = done.body.data.tokens.accessToken as string;

    const noCode = await request(app)
      .post('/api/auth/2fa/disable')
      .set(bearer(access))
      .send({ password: PASSWORD, code: '123456' });
    expect(noCode.status).toBe(400);

    const wrongPass = await request(app)
      .post('/api/auth/2fa/disable')
      .set(bearer(access))
      .send({ password: 'WrongPass1', code: totpAt(secret, currentStep() - 1) });
    expect(wrongPass.status).toBe(400);
  });

  it('2-step endpoints are admin-only', async () => {
    const customer = await makeUser(app, 'customer');
    const res = await request(app).post('/api/auth/2fa/setup').set(bearer(customer.token)).send({});
    expect(res.status).toBe(403);
  });

  it('when required, an admin without 2-step can sign in but not use the admin API', async () => {
    env.ADMIN_REQUIRE_2FA = true;
    const first = await login();
    expect(first.status).toBe(200);
    expect(first.body.data.user.twoFactorSetupRequired).toBe(true);
    const access = first.body.data.tokens.accessToken as string;

    const blocked = await request(app).get('/api/admin/dashboard').set(bearer(access));
    expect(blocked.status).toBe(403);
    expect(blocked.body.errors).toEqual([{ code: 'TWO_FACTOR_SETUP_REQUIRED' }]);

    // Setup itself stays reachable.
    const setup = await request(app).post('/api/auth/2fa/setup').set(bearer(access)).send({});
    expect(setup.status).toBe(200);
    await request(app)
      .post('/api/auth/2fa/enable')
      .set(bearer(access))
      .send({ code: totpAt(setup.body.data.secret, currentStep()) });

    expect((await request(app).get('/api/admin/dashboard').set(bearer(access))).status).toBe(200);
  });

  it('the 2-step rule also covers admin use of shared routes (support, payments, bookings)', async () => {
    env.ADMIN_REQUIRE_2FA = true;
    const access = (await login()).body.data.tokens.accessToken as string;
    const customer = await makeUser(app, 'customer');
    const ticket = await request(app)
      .post('/api/support')
      .set(bearer(customer.token))
      .send({ category: 'booking', subject: 'Late pickup', message: 'Driver was late' });
    expect(ticket.status).toBe(201);
    const ticketId = ticket.body.data._id as string;

    for (const call of [
      request(app).put(`/api/support/${ticketId}`).set(bearer(access)).send({ status: 'resolved' }),
      request(app).get('/api/support').set(bearer(access)),
      request(app).get('/api/payments/000000000000000000000000').set(bearer(access)),
      request(app).post('/api/payments/000000000000000000000000/refund').set(bearer(access)).send({}),
    ]) {
      const res = await call;
      expect(res.status).toBe(403);
      expect(res.body.errors).toEqual([{ code: 'TWO_FACTOR_SETUP_REQUIRED' }]);
    }
    // Other roles are unaffected, and /api/auth stays usable for setup.
    expect((await request(app).get('/api/support').set(bearer(customer.token))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(access))).status).toBe(200);
    // Public routes: the admin just browses as a guest.
    expect((await request(app).get('/api/hotels').set(bearer(access))).status).toBe(200);
  });

  it('audits admin changes made through shared routes, but never other roles', async () => {
    const access = (await login()).body.data.tokens.accessToken as string;
    const customer = await makeUser(app, 'customer');
    const ticket = await request(app)
      .post('/api/support')
      .set(bearer(customer.token))
      .send({ category: 'booking', subject: 'Late pickup', message: 'Driver was late' });
    const ticketId = ticket.body.data._id as string;
    const res = await request(app).put(`/api/support/${ticketId}`).set(bearer(access)).send({ status: 'resolved' });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 200)); // the audit write runs after the response
    const entry = await AdminAuditLog.findOne({ action: 'PUT /support/:id' }).lean();
    expect(entry?.entityType).toBe('support');
    expect(entry?.entityId?.toString()).toBe(ticketId);
    expect(JSON.stringify(entry?.meta)).toContain('resolved');
    // The customer's own POST /api/support is not an admin action.
    expect(await AdminAuditLog.countDocuments({ adminId: customer.id })).toBe(0);
    expect(await AdminAuditLog.countDocuments({ action: 'POST /support' })).toBe(0);
  });

  it('records admin sign-ins, failures and changes in the audit log', async () => {
    await login('WrongPass1');
    const access = (await login()).body.data.tokens.accessToken as string;
    const customer = await makeUser(app, 'customer');
    await request(app)
      .put(`/api/admin/support/${customer.id}`)
      .set(bearer(access))
      .send({ status: 'resolved' });

    const ok = await request(app).get('/api/admin/audit-logs').set(bearer(access));
    expect(ok.status).toBe(200);
    const actions = (await AdminAuditLog.find({}).lean()).map((e) => e.action);
    expect(actions).toContain('auth.login.failed');
    expect(actions).toContain('auth.login');
    // A customer signing in is never written to the admin audit log.
    expect(await AdminAuditLog.countDocuments({ adminId: customer.id })).toBe(0);
  });

  it('audits a successful admin change with who, what and where, without secrets', async () => {
    const access = (await login()).body.data.tokens.accessToken as string;
    const provider = await makeUser(app, 'provider');
    const res = await request(app)
      .put(`/api/admin/providers/${provider.providerId}/approve`)
      .set(bearer(access))
      .send({ note: 'checked documents', password: 'should-not-be-stored' });
    expect(res.status).toBeLessThan(400);

    await new Promise((r) => setTimeout(r, 200)); // the audit write runs after the response
    const entry = await AdminAuditLog.findOne({ action: 'PUT /providers/:id/approve' }).lean();
    expect(entry).toBeTruthy();
    expect(entry?.entityType).toBe('providers');
    expect(entry?.entityId?.toString()).toBe(provider.providerId);
    expect(JSON.stringify(entry?.meta)).toContain('checked documents');
    expect(JSON.stringify(entry?.meta)).not.toContain('should-not-be-stored');
  });
});
