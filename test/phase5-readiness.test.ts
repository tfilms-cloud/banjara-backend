import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

/**
 * No database is started here: mongoose is disconnected on purpose.
 */
describe('Phase 5 — health vs readiness', () => {
  const app = createApp();

  it('keeps liveness at 200 when the database is disconnected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.database).toBe('disconnected');
  });

  it('fails readiness with 503 when the database is disconnected', async () => {
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(503);
    expect(res.body.data.database).toBe('disconnected');
  });
});
