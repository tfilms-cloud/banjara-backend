import mongoose, { type Model } from 'mongoose';
import { User } from '../models/User';
import { ProviderProfile } from '../models/ProviderProfile';
import { Vehicle } from '../models/Vehicle';
import { Route } from '../models/Route';
import { PickupPoint } from '../models/PickupPoint';
import { Trip } from '../models/Trip';
import { Hotel } from '../models/Hotel';
import { Room } from '../models/Room';
import { RoomAvailability } from '../models/RoomAvailability';
import { TourItinerary } from '../models/TourItinerary';
import { ProviderPaymentAccount } from '../models/ProviderPaymentAccount';
import { ServiceCatalog } from '../models/ServiceCatalog';
import { DEMO_NAMESPACE, type DemoModel, type DemoPlan } from './demoCatalog';

// The fixture map intentionally spans heterogeneous Mongoose document types.
export const demoModels: Record<DemoModel, Model<any>> = {
  User, ProviderProfile, Vehicle, Route, PickupPoint, Trip, Hotel, Room,
  RoomAvailability, TourItinerary, ProviderPaymentAccount, ServiceCatalog,
};

/** Validate all documents before any upload/database mutation. */
export async function validateDemoPlan(plan: DemoPlan) {
  const keys = new Set<string>();
  for (const record of plan.records) {
    const key = `${record.model}:${record.data._id}`;
    if (keys.has(key)) throw new Error(`Duplicate demo record key: ${key}`);
    keys.add(key);
    await new demoModels[record.model](record.data).validate();
  }
}

export async function assertDemoOwnership(plan: DemoPlan, session?: mongoose.ClientSession) {
  const accounts = await User.find({ $or: [
    { email: { $in: plan.accounts.map(account => account.email) } },
    { _id: { $in: plan.accounts.map(account => account.userId) } },
  ] }).session(session ?? null).lean();
  for (const existing of accounts) {
    const expected = plan.accounts.find(account => account.userId === existing._id.toString());
    if (!expected || existing.email !== expected.email || existing.preferences?.demoSeed !== DEMO_NAMESPACE) {
      throw new Error('A demo ID/email belongs to an existing unrelated account. No account will be overwritten.');
    }
  }
  for (const [modelName, model] of Object.entries(demoModels)) {
    if (modelName === 'User' || modelName === 'ServiceCatalog') continue;
    const records = plan.records.filter(record => record.model === modelName);
    const byId = new Map(records.map(record => [record.data._id.toString(), record.data]));
    const existing = await model.find({ _id: { $in: records.map(record => record.data._id) } })
      .session(session ?? null).lean();
    for (const row of existing) {
      const expected = byId.get(String(row._id))!;
      for (const field of ['userId', 'providerId', 'hotelId', 'roomId', 'vehicleId', 'date', 'departureDate']) {
        if (expected[field] !== undefined && String(row[field]) !== String(expected[field])) {
          throw new Error(`Refusing demo seed collision in ${modelName}.${field}. Existing records are preserved.`);
        }
      }
    }
  }
}

/** Insert-only, atomic fixture load. Re-running never resets bookings, passwords or inventory. */
export async function applyDemoCatalog(plan: DemoPlan) {
  await validateDemoPlan(plan);
  // Create collections/indexes outside the transaction, including on an empty test database.
  await Promise.all(Object.values(demoModels).map(model => model.init()));
  return mongoose.connection.transaction(async session => {
    await assertDemoOwnership(plan, session);
    const inserted: Partial<Record<DemoModel, number>> = {};
    for (const [modelName, model] of Object.entries(demoModels) as [DemoModel, Model<any>][]) {
      const records = plan.records.filter(record => record.model === modelName);
      if (!records.length) continue;
      const operations = [];
      for (const record of records) {
        const instance = new model(record.data);
        // Keep pre-validation transforms, including PickupPoint's GeoJSON synchronization.
        await instance.validate();
        const document = instance.toObject();
        operations.push({ updateOne: {
          filter: modelName === 'ServiceCatalog' ? { key: record.data.key } : { _id: record.data._id },
          update: { $setOnInsert: document }, upsert: true,
        } });
      }
      // Native bulkWrite avoids Mongoose adding updatedAt to existing rows on a no-op upsert.
      const result = await model.collection.bulkWrite(operations, { session });
      inserted[modelName] = result.upsertedCount;
    }
    return inserted;
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
}
