import crypto from 'crypto';
import { env } from '../config/env';

/**
 * AES-256-GCM for small secrets kept in the database (2-step verification keys), so a
 * database dump alone does not let anyone generate an admin's codes.
 *
 * Key: MFA_ENCRYPTION_KEY when set (recommended in production), otherwise derived from
 * JWT_REFRESH_SECRET. Changing the key makes stored 2-step secrets unreadable, so
 * those admins would need to set up 2-step verification again.
 */
function key(): Buffer {
  // A value copied unchanged from .env.example is public, so it is never used as a key.
  const configured = env.MFA_ENCRYPTION_KEY.startsWith('REPLACE_ME') ? '' : env.MFA_ENCRYPTION_KEY;
  const material = configured || `banjara-mfa:${env.JWT_REFRESH_SECRET}`;
  return crypto.createHash('sha256').update(material).digest();
}

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function open(sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable sealed value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
