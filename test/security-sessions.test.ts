import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Session } from '../src/models/Session';
import { User } from '../src/models/User';
import { hashPassword } from '../src/utils/password';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';

const PASSWORD = 'Password123';
const EMAIL = 'devices@example.com';

describe('Security — per-device sessions', () => {
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
      name: 'Device User',
      email: EMAIL,
      phone: '03001234567',
      passwordHash: await hashPassword(PASSWORD),
      role: 'customer',
      status: 'active',
    });
  });

  /** A "device": its own login, with tokens in the body (mobile-style). */
  async function device(userAgent = 'test-device') {
    const res = await request(app)
      .post('/api/auth/login')
      .set('User-Agent', userAgent)
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    return {
      access: res.body.data.tokens.accessToken as string,
      refresh: res.body.data.tokens.refreshToken as string,
    };
  }
  const me = (access: string) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${access}`);
  const refresh = (token: string) => request(app).post('/api/auth/refresh').send({ refreshToken: token });

  it('signing in on a second device no longer signs out the first', async () => {
    const phone = await device('phone');
    const laptop = await device('laptop');

    expect((await refresh(phone.refresh)).status).toBe(200);
    expect((await refresh(laptop.refresh)).status).toBe(200);
    expect(await Session.countDocuments({ revokedAt: null })).toBe(2);
  });

  it('a stolen refresh token used after the owner refreshed revokes the whole session', async () => {
    const victim = await device();
    const stolen = victim.refresh;

    const rotated = await refresh(victim.refresh);
    expect(rotated.status).toBe(200);
    const current = rotated.body.data.tokens.refreshToken as string;

    // Push the rotation outside the race window, as if the attacker came later.
    await Session.updateMany({}, { $set: { rotatedAt: new Date(Date.now() - 60_000) } });

    expect((await refresh(stolen)).status).toBe(401);
    // The legitimate current token is now dead too: everyone must sign in again.
    expect((await refresh(current)).status).toBe(401);
    expect((await me(rotated.body.data.tokens.accessToken)).status).toBe(401);
    const session = await Session.findOne({});
    expect(session?.revokedReason).toBe('reuse-detected');
  });

  it('a replay inside the race window is refused without killing the session', async () => {
    const d = await device();
    const rotated = await refresh(d.refresh);
    const current = rotated.body.data.tokens.refreshToken as string;

    expect((await refresh(d.refresh)).status).toBe(401);
    expect((await refresh(current)).status).toBe(200);
  });

  it('two concurrent refreshes with one token: exactly one wins', async () => {
    const d = await device();
    const results = await Promise.all([refresh(d.refresh), refresh(d.refresh)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('logout ends only this device, and its access token stops working at once', async () => {
    const phone = await device('phone');
    const laptop = await device('laptop');

    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${phone.access}`).send({});
    expect(out.status).toBe(200);

    expect((await me(phone.access)).status).toBe(401);
    expect((await refresh(phone.refresh)).status).toBe(401);
    expect((await me(laptop.access)).status).toBe(200);
  });

  it('logout-all ends every device immediately', async () => {
    const phone = await device('phone');
    const laptop = await device('laptop');

    const res = await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${laptop.access}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBe(2);

    for (const d of [phone, laptop]) {
      expect((await me(d.access)).status).toBe(401);
      expect((await refresh(d.refresh)).status).toBe(401);
    }
  });

  it('lists my devices, marks this one, and can sign out another', async () => {
    const phone = await device('Phone UA');
    const laptop = await device('Laptop UA');

    const list = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${laptop.access}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    const mine = list.body.data.find((s: { current: boolean }) => s.current);
    expect(mine.userAgent).toBe('Laptop UA');
    expect(JSON.stringify(list.body.data)).not.toMatch(/tokenHash/);

    const other = list.body.data.find((s: { current: boolean }) => !s.current);
    const del = await request(app)
      .delete(`/api/auth/sessions/${other.id}`)
      .set('Authorization', `Bearer ${laptop.access}`);
    expect(del.status).toBe(200);
    expect((await me(phone.access)).status).toBe(401);
    expect((await me(laptop.access)).status).toBe(200);
  });

  it("cannot sign out someone else's device", async () => {
    const victim = await device();
    await User.create({
      name: 'Other',
      email: 'other@example.com',
      phone: '03001234567',
      passwordHash: await hashPassword(PASSWORD),
      role: 'customer',
      status: 'active',
    });
    const attacker = await request(app).post('/api/auth/login').send({ email: 'other@example.com', password: PASSWORD });
    const victimSession = await Session.findOne({ userId: (await User.findOne({ email: EMAIL }))!._id });

    const res = await request(app)
      .delete(`/api/auth/sessions/${victimSession!._id}`)
      .set('Authorization', `Bearer ${attacker.body.data.tokens.accessToken}`);
    expect(res.status).toBe(404);
    expect((await me(victim.access)).status).toBe(200);
  });

  it('changing the password keeps this device and signs out the others', async () => {
    const phone = await device('phone');
    const laptop = await device('laptop');

    const res = await request(app)
      .put('/api/users/me/password')
      .set('Authorization', `Bearer ${laptop.access}`)
      .send({ currentPassword: PASSWORD, newPassword: 'NewPassword456' });
    expect(res.status).toBe(200);

    expect((await me(laptop.access)).status).toBe(200);
    expect((await me(phone.access)).status).toBe(401);
    expect((await refresh(phone.refresh)).status).toBe(401);
  });

  it('a suspended account cannot refresh', async () => {
    const d = await device();
    await User.updateOne({ email: EMAIL }, { status: 'suspended' });
    expect((await refresh(d.refresh)).status).toBe(401);
  });
});
