import type { Express } from 'express';
import request from 'supertest';

/**
 * Calls the public forgot-password endpoint and returns the reset token, which the
 * non-production delivery seam writes to the console. Returns null when no token is
 * delivered (e.g. the pre-fix code that returns a fixed code in the response body).
 */
export async function requestResetToken(app: Express, email: string): Promise<string | null> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    await request(app).post('/api/auth/forgot-password').send({ email });
  } finally {
    console.log = original;
  }
  const line = lines.find((entry) => entry.includes('[password-reset]'));
  if (!line) return null;
  const match = line.match(/token=([a-f0-9]+)/i);
  return match ? match[1] : null;
}
