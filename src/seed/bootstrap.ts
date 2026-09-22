import { connectDatabase, disconnectDatabase } from '../config/database';
import { hashPassword } from '../utils/password';
import { logger } from '../utils/logger';
import { User } from '../models/User';

/**
 * Idempotent admin bootstrap. Creates an admin ONLY if none exists, using credentials
 * supplied via env. Safe to run against production.
 *
 * The password is read from ADMIN_PASSWORD and never printed.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function bootstrap() {
  const email = requireEnv('ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');

  await connectDatabase();

  const existingAdmin = await User.findOne({ role: 'admin' });
  if (existingAdmin) {
    logger.info('An admin already exists; bootstrap is a no-op.');
    await disconnectDatabase();
    return;
  }

  const passwordHash = await hashPassword(password);
  await User.create({
    name: 'BANJARA Admin',
    email,
    phone: '',
    passwordHash,
    role: 'admin',
    status: 'active',
  });

  logger.info('Bootstrap admin created.');
  await disconnectDatabase();
}

bootstrap().catch(async (error) => {
  logger.error({ err: error }, 'Bootstrap failed');
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
