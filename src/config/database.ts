import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Whether the booking flow is wrapped in a MongoDB transaction. It currently is not —
 * production topology is unconfirmed and a standalone node cannot run transactions.
 * Set this to true if/when the booking flow is made transactional; the startup check
 * will then refuse to boot a standalone server in production.
 */
export const TRANSACTIONS_REQUIRED = false;

/** A `hello` response identifies a replica set via its `setName`. */
export function isReplicaSetHello(hello: { setName?: unknown } | null | undefined): boolean {
  return typeof hello?.setName === 'string' && hello.setName.length > 0;
}

/** True when the connected server can run multi-document transactions. */
export async function supportsTransactions(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) return false;
  const db = mongoose.connection.db;
  if (!db) return false;
  const hello = await db.admin().command({ hello: 1 });
  return isReplicaSetHello(hello);
}

async function assertTransactionCapability(): Promise<void> {
  const supported = await supportsTransactions();
  if (supported) return;

  const message =
    'MongoDB is running as a standalone node: multi-document transactions are unavailable. ' +
    'Booking consistency currently relies on compensating actions. Use a replica set in production.';

  if (TRANSACTIONS_REQUIRED && env.NODE_ENV === 'production') {
    logger.error(message);
    process.exit(1);
  }
  logger.warn(message);
}

export async function connectDatabase(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  const connection = await mongoose.connect(env.MONGODB_URI);
  logger.info(`MongoDB connected: ${connection.connection.host}/${connection.connection.name}`);
  await assertTransactionCapability();
  return connection;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
