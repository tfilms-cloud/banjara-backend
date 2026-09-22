import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NextFunction, Response } from 'express';
import { createApp } from '../src/app';
import { requireApprovedProvider } from '../src/middleware/role.middleware';
import type { AuthRequest } from '../src/middleware/auth.middleware';
import { AppError } from '../src/utils/AppError';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { makeUser } from './helpers/auth';

function runMiddleware(req: AuthRequest) {
  return new Promise<{ nextCalled: boolean; error?: unknown }>((resolve) => {
    const next: NextFunction = (error?: unknown) => {
      resolve({ nextCalled: !error, error });
    };
    void requireApprovedProvider(req, {} as Response, next);
  });
}

describe('Phase 4.4 — requireApprovedProvider', () => {
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

  it('rejects a pending provider', async () => {
    const provider = await makeUser(app, 'provider', { approved: false });
    const result = await runMiddleware({
      user: { id: provider.id, role: 'provider', email: provider.email, providerId: provider.providerId },
    } as AuthRequest);

    expect(result.nextCalled).toBe(false);
    expect(result.error).toBeInstanceOf(AppError);
    expect((result.error as AppError).statusCode).toBe(403);
  });

  it('allows an approved provider', async () => {
    const provider = await makeUser(app, 'provider');
    const result = await runMiddleware({
      user: { id: provider.id, role: 'provider', email: provider.email, providerId: provider.providerId },
    } as AuthRequest);

    expect(result.nextCalled).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects a non-provider', async () => {
    const customer = await makeUser(app, 'customer');
    const result = await runMiddleware({
      user: { id: customer.id, role: 'customer', email: customer.email },
    } as AuthRequest);

    expect(result.nextCalled).toBe(false);
    expect((result.error as AppError).statusCode).toBe(403);
  });

  it('rejects a provider with no profile', async () => {
    const result = await runMiddleware({
      user: { id: '000000000000000000000000', role: 'provider', email: 'x@example.com' },
    } as AuthRequest);

    expect(result.nextCalled).toBe(false);
    expect((result.error as AppError).statusCode).toBe(403);
  });
});
