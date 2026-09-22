import { describe, expect, it } from 'vitest';
import { validateProductionEnv } from '../src/config/env';

const base = {
  NODE_ENV: 'production' as const,
  JWT_ACCESS_SECRET: 'access-secret-value-that-is-long-enough-123',
  JWT_REFRESH_SECRET: 'refresh-secret-value-that-is-long-enough-456',
  PAYMENT_SECRET: 'a-real-payment-secret',
  MONGODB_URI: 'mongodb://db.internal:27017/banjara',
  CLIENT_URL: 'https://banjara.app',
};

describe('Phase 2.2 — validateProductionEnv', () => {
  it('accepts a valid production configuration', () => {
    expect(validateProductionEnv(base)).toEqual([]);
  });

  it('does not apply production checks outside production', () => {
    const failures = validateProductionEnv({
      ...base,
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'dev_access_secret_change_me_32',
      PAYMENT_SECRET: 'mock_payment_secret',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/banjara',
    });
    expect(failures).toEqual([]);
  });

  it('rejects short JWT secrets', () => {
    const failures = validateProductionEnv({ ...base, JWT_ACCESS_SECRET: 'short' });
    expect(failures.join(' ')).toMatch(/JWT_ACCESS_SECRET/);
  });

  it('rejects published placeholder JWT secrets', () => {
    const failures = validateProductionEnv({
      ...base,
      JWT_ACCESS_SECRET: 'dev_access_secret_change_me_32',
      JWT_REFRESH_SECRET: 'change_me_refresh_secret_min_32_chars',
    });
    expect(failures.join(' ')).toMatch(/placeholder/i);
  });

  it('rejects identical access and refresh secrets', () => {
    const shared = 'same-secret-value-that-is-long-enough-123';
    const failures = validateProductionEnv({
      ...base,
      JWT_ACCESS_SECRET: shared,
      JWT_REFRESH_SECRET: shared,
    });
    expect(failures.join(' ')).toMatch(/differ|equal|same/i);
  });

  it('rejects the mock payment secret', () => {
    const failures = validateProductionEnv({ ...base, PAYMENT_SECRET: 'mock_payment_secret' });
    expect(failures.join(' ')).toMatch(/PAYMENT_SECRET/);
  });

  it('rejects a localhost database URI', () => {
    const failures = validateProductionEnv({ ...base, MONGODB_URI: 'mongodb://127.0.0.1:27017/banjara' });
    expect(failures.join(' ')).toMatch(/MONGODB_URI/);
  });

  it('rejects a localhost client URL', () => {
    const failures = validateProductionEnv({ ...base, CLIENT_URL: 'http://localhost:8081' });
    expect(failures.join(' ')).toMatch(/CLIENT_URL/);
  });

  it('never includes the secret value in a failure message', () => {
    const secret = 'dev_access_secret_change_me_32';
    const failures = validateProductionEnv({ ...base, JWT_ACCESS_SECRET: secret });
    expect(failures.join(' ')).not.toContain(secret);
  });
});
