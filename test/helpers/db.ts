import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replset: MongoMemoryReplSet | null = null;
let connected = false;

/**
 * Starts a single-member replica set (not a standalone node) and connects mongoose.
 *
 * A standalone mongod cannot run transactions — `startSession().withTransaction()`
 * fails with "Transaction numbers are only allowed on a replica set member or mongos".
 * Phase 3 tests depend on transactions and realistic concurrency, so the replset is
 * mandatory here and is also a constraint on the owner's production database.
 */
export async function setupTestDb(): Promise<string> {
  if (!replset) {
    replset = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
  }
  const uri = replset.getUri();
  if (!connected) {
    await mongoose.connect(uri);
    connected = true;
  }
  return uri;
}

export async function teardownTestDb(): Promise<void> {
  if (connected) {
    await mongoose.disconnect();
    connected = false;
  }
  if (replset) {
    await replset.stop();
    replset = null;
  }
}

/**
 * Clears every registered collection without dropping the database.
 *
 * `dropDatabase()` would also drop indexes, and several suites rely on unique
 * indexes existing (e.g. `Review.bookingId`). `deleteMany({})` leaves indexes intact.
 */
export async function clearDatabase(): Promise<void> {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

/**
 * Forces index construction to finish. Mongoose builds indexes asynchronously, so a
 * uniqueness test on a fresh database can pass spuriously before the index exists.
 */
export async function ensureIndexes(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}
