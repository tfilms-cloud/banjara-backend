import { env } from '../../config/env';

/**
 * Delivery seam for password-reset tokens.
 *
 * No provider is wired here on purpose — picking and paying for an email/SMS provider
 * is the repo owner's decision (see the remediation brief, Section 2). Until they do,
 * production fails loudly rather than silently dropping resets or leaking codes.
 *
 * Dev/test: the token is printed to the server console so a developer can complete the
 * flow. Never enable stdout delivery in production.
 */
export async function deliverPasswordResetToken(email: string, token: string): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('No password reset delivery provider configured');
  }
  console.log(`[password-reset] delivery for ${email} token=${token}`);
}
