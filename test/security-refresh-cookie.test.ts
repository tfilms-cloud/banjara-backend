import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Session } from '../src/models/Session';
import { User } from '../src/models/User';
import { signTokenPair } from '../src/utils/jwt';
import { hashPassword } from '../src/utils/password';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';

const ORIGIN = 'http://localhost:8081'; // CLIENT_URL in vitest.config.mts
const PASSWORD = 'Password123';

/** The Set-Cookie header for a cookie name, or undefined. */
function cookieFrom(res: request.Response, name: string) {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}
const valueOf = (setCookie?: string) => setCookie?.split(';')[0];

describe('Security — website refresh token lives in an httpOnly cookie', () => {
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
      name: 'Web User',
      email: 'web@example.com',
      phone: '03001234567',
      passwordHash: await hashPassword(PASSWORD),
      role: 'customer',
      status: 'active',
    });
  });

  const webLogin = () =>
    request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .set('X-Session-Scope', 'site')
      .send({ email: 'web@example.com', password: PASSWORD });

  it('login sets an httpOnly cookie scoped to /api/auth and keeps the token out of the body', async () => {
    const res = await webLogin();
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(res.body.data.tokens.refreshToken).toBeUndefined();

    const cookie = cookieFrom(res, 'banjara_rt_site');
    expect(cookie).toBeTruthy();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('mobile login (no scope header) is unchanged: tokens in the body, no cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'web@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.refreshToken).toBeTruthy();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refresh with the cookie rotates it, and the old cookie stops working', async () => {
    const first = valueOf(cookieFrom(await webLogin(), 'banjara_rt_site'))!;

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', ORIGIN)
      .set('X-Session-Scope', 'site')
      .set('Cookie', first)
      .send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.tokens.accessToken).toBeTruthy();
    expect(refreshed.body.data.tokens.refreshToken).toBeUndefined();
    const second = valueOf(cookieFrom(refreshed, 'banjara_rt_site'));
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', ORIGIN)
      .set('X-Session-Scope', 'site')
      .set('Cookie', first)
      .send({});
    expect(replay.status).toBe(401);
  });

  it('ignores the cookie when the scope header is missing (CSRF: a plain cross-site POST cannot add it)', async () => {
    const cookie = valueOf(cookieFrom(await webLogin(), 'banjara_rt_site'))!;
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie).send({});
    expect(res.status).toBe(401);
  });

  it('rejects a cross-site origin before anything runs', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('X-Session-Scope', 'site')
      .send({});
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps admin and site sessions in separate cookies', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .set('X-Session-Scope', 'admin')
      .send({ email: 'web@example.com', password: PASSWORD });
    expect(cookieFrom(res, 'banjara_rt_admin')).toBeTruthy();
    expect(cookieFrom(res, 'banjara_rt_site')).toBeUndefined();
  });

  it('logout revokes the session and clears the cookie, even without an access token', async () => {
    const cookie = valueOf(cookieFrom(await webLogin(), 'banjara_rt_site'))!;

    const out = await request(app)
      .post('/api/auth/logout')
      .set('Origin', ORIGIN)
      .set('X-Session-Scope', 'site')
      .set('Cookie', cookie)
      .send({});
    expect(out.status).toBe(200);
    expect(cookieFrom(out, 'banjara_rt_site')).toMatch(/Expires=Thu, 01 Jan 1970/i);

    const after = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', ORIGIN)
      .set('X-Session-Scope', 'site')
      .set('Cookie', cookie)
      .send({});
    expect(after.status).toBe(401);
  });

  it('migrates a pre-cookie session: a body refresh token from a website tab gets a cookie back', async () => {
    const legacy = await request(app)
      .post('/api/auth/login')
      .send({ email: 'web@example.com', password: PASSWORD });
    const oldRefresh = legacy.body.data.tokens.refreshToken as string;

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', ORIGIN)
      .set('X-Session-Scope', 'site')
      .send({ refreshToken: oldRefresh });
    expect(res.status).toBe(200);
    expect(cookieFrom(res, 'banjara_rt_site')).toBeTruthy();
    expect(res.body.data.tokens.refreshToken).toBeUndefined();
  });

  it('mobile: a replaced refresh token is rejected (bcrypt 72-byte truncation regression)', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'web@example.com', password: PASSWORD });
    const first = login.body.data.tokens.refreshToken as string;
    const next = await request(app).post('/api/auth/refresh').send({ refreshToken: first });
    expect(next.status).toBe(200);
    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: first });
    expect(replay.status).toBe(401);
  });

  it('upgrades a pre-session (bcrypt-hashed, no sid) refresh token to a session, once', async () => {
    const user = await User.findOne({ email: 'web@example.com' });
    // Exactly what the API issued before per-device sessions: no `sid` claim.
    const { refreshToken: legacy } = signTokenPair({ sub: user!._id.toString(), role: 'customer', email: user!.email });
    await User.updateOne({ _id: user!._id }, { refreshTokenHash: await hashPassword(legacy) });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: legacy });
    expect(res.status).toBe(200);
    expect(await Session.countDocuments({ userId: user!._id })).toBe(1);
    const stored = await User.findById(user!._id).select('+refreshTokenHash');
    expect(stored?.refreshTokenHash).toBeUndefined();

    // The legacy token is spent.
    const again = await request(app).post('/api/auth/refresh').send({ refreshToken: legacy });
    expect(again.status).toBe(401);
  });

  it('mobile logout without any token still returns 401', async () => {
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(401);
  });
});
