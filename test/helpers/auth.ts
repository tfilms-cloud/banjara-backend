import type { Express } from 'express';
import request from 'supertest';
import { User } from '../../src/models/User';
import { ProviderProfile } from '../../src/models/ProviderProfile';
import { hashPassword } from '../../src/utils/password';
import type { UserRole, UserStatus } from '../../src/types/auth.types';

export function authHeader(token?: string) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * supertest wrapper that attaches the auth header. Returns method helpers because
 * supertest's request object only exposes `.set()` after a method is chosen.
 */
export function authed(app: Express, token?: string) {
  const agent = request(app);
  const headers = authHeader(token);
  return {
    get: (url: string) => agent.get(url).set(headers),
    post: (url: string) => agent.post(url).set(headers),
    put: (url: string) => agent.put(url).set(headers),
    patch: (url: string) => agent.patch(url).set(headers),
    delete: (url: string) => agent.delete(url).set(headers),
  };
}

let counter = 0;
function uniqueEmail(role: string) {
  counter += 1;
  return `test_${role}_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: UserRole;
  token: string;
  refreshToken: string;
  providerId?: string;
}

export interface MakeUserOptions {
  approved?: boolean;
  status?: UserStatus;
  password?: string;
  name?: string;
  /** provider service; defaults to transport */
  service?: 'transport' | 'hotel';
}

/**
 * Creates a user of the given role and returns a valid access token.
 *
 * Tokens are always obtained through the real auth flow (register → login, or
 * login for admins, who cannot self-register). A hand-forged JWT would not catch
 * token-shape regressions.
 */
export async function makeUser(
  app: Express,
  role: UserRole,
  options: MakeUserOptions = {}
): Promise<TestUser> {
  const email = uniqueEmail(role);
  const password = options.password ?? 'Password123';
  const name = options.name ?? `Test ${role}`;
  const status: UserStatus = options.status ?? 'active';

  if (role === 'admin') {
    const passwordHash = await hashPassword(password);
    await User.create({
      name,
      email,
      phone: '+920000000000',
      passwordHash,
      role: 'admin',
      status,
    });
  } else {
    const reg = await request(app).post('/api/auth/register').send({
      name,
      email,
      phone: '+920000000000',
      password,
      role,
    });
    if (reg.status !== 201) {
      throw new Error(`makeUser register failed (${reg.status}): ${JSON.stringify(reg.body)}`);
    }
  }

  if (status !== 'active') {
    throw new Error('Non-active users cannot authenticate (auth middleware rejects them)');
  }

  const login = await request(app).post('/api/auth/login').send({ email, password });
  if (login.status !== 200) {
    throw new Error(`makeUser login failed (${login.status}): ${JSON.stringify(login.body)}`);
  }

  const token = login.body.data.tokens.accessToken as string;
  const refreshToken = login.body.data.tokens.refreshToken as string;
  const user = login.body.data.user as { id: string };

  let providerId: string | undefined;
  if (role === 'provider') {
    const service = options.service ?? 'transport';
    const providerType = service === 'hotel' ? ['hotel'] : ['busOperator'];
    const res = await request(app)
      .post('/api/providers/register')
      .set(authHeader(token))
      .send({
        businessName: `${name} Travels`,
        ownerName: name,
        providerType,
        services: [service],
        phone: '+920000000000',
        email,
        address: 'Test Address 1',
        city: 'Islamabad',
        latitude: 33.6844,
        longitude: 73.0479,
      });
    if (res.status !== 201) {
      throw new Error(`makeUser provider register failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
    providerId = res.body.data._id as string;
    if (options.approved !== false) {
      await ProviderProfile.findByIdAndUpdate(providerId, { verificationStatus: 'approved' });
    }
  }

  return { id: user.id, email, password, role, token, refreshToken, providerId };
}
