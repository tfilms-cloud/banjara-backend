import mongoose, { type ClientSession } from 'mongoose';
import { supportsTransactions } from '../config/database';
import { AppError } from './AppError';

/** Fail closed rather than partially confirming money, booking and inventory. */
export async function paymentTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  if (!await supportsTransactions()) {
    throw new AppError('Payments require a MongoDB replica set. Please contact support.', 503);
  }
  return mongoose.connection.transaction(work, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
}
