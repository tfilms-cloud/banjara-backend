import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Payment confirmation, cancellation and expiry require multi-document transactions.
 * Refuse a standalone database in production rather than partially applying them.
 */
export const TRANSACTIONS_REQUIRED = true;

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
    'Payment transitions require a replica set. Payment mutations will refuse to run on a standalone node.';

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
