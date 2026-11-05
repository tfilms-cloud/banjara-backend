import mongoose from 'mongoose';
import { env } from '../config/env';
import { getSupabase, UPLOAD_FOLDERS } from '../config/supabase';
import { MediaDeletion } from '../models/MediaDeletion';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

export type StorageObject = { projectOrigin: string; bucket: string; path: string };

function projectOrigin() {
  try { return new URL(env.SUPABASE_URL.trim()).origin; }
  catch { throw new AppError('Photo storage is temporarily unavailable.', 503); }
}

/** Resolve only our own storage URLs. Never accept arbitrary buckets or object paths. */
export function parseStorageObject(reference: string): StorageObject | null {
  const origin = projectOrigin();
  let bucket: string;
  let path: string;
  if (reference.startsWith('payment-file:')) {
    bucket = env.SUPABASE_PAYMENT_BUCKET;
    path = reference.slice('payment-file:'.length);
  } else {
    try {
      // Reject traversal before URL() normalizes dot segments.
      if (/%2e|%2f|%5c|\\|\/\.\.?\//i.test(reference)) return null;
      const url = new URL(reference);
      if (url.origin !== origin || url.username || url.password) return null;
      const match = /^\/storage\/v1\/object\/(public|sign)\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (!match) return null;
      bucket = decodeURIComponent(match[2]);
      path = decodeURIComponent(match[3]);
    } catch { return null; }
  }
  const parts = path.split('/');
  if (parts.length !== 3 || !UPLOAD_FOLDERS.includes(parts[0] as typeof UPLOAD_FOLDERS[number]) ||
      !/^[a-f\d]{24}$/.test(parts[1]) || !/^[A-Za-z\d-]+\.(jpg|png|webp|gif)$/.test(parts[2])) return null;
  if (bucket !== env.SUPABASE_STORAGE_BUCKET && bucket !== env.SUPABASE_PAYMENT_BUCKET) return null;
  if (bucket === env.SUPABASE_PAYMENT_BUCKET && parts[0] !== 'payments') return null;
  return { projectOrigin: origin, bucket, path };
}

function objectKey(object: StorageObject) {
  return `${object.projectOrigin}/${object.bucket}/${object.path}`;
}

// Project only fields which can contain media, including saved booking/payment history.
// Stream once per cleanup batch rather than loading whole collections per image.
const MEDIA_FIELDS: Record<string, string[]> = {
  users: ['avatar', 'preferences'],
  providerprofiles: ['logo', 'transportDetails', 'hotelDetails', 'tourDetails', 'restaurantDetails', 'guideDetails'],
  vehicles: ['images', 'verificationDetails'], hotels: ['images'], rooms: ['images'], pickuppoints: ['images'],
  touritineraries: ['coverImage', 'images'],
  payments: ['proof', 'refund', 'timeline'], paymentmessages: ['imageUrl'],
  messages: ['attachments', 'message'],
  bookings: ['transportBooking', 'hotelBooking', 'packageBooking', 'guideBooking'],
  notifications: ['data'], adminauditlogs: ['meta'],
};

async function referencedObjects(objects: StorageObject[]) {
  const wanted = new Set(objects.map(objectKey));
  const referenced = new Set<string>();
  const inspect = (value: unknown): void => {
    if (typeof value === 'string') {
      if (!value.startsWith('payment-file:') && !value.startsWith('http')) return;
      const object = parseStorageObject(value);
      if (object && wanted.has(objectKey(object))) referenced.add(objectKey(object));
      // Migrated private receipts can still have their original public URL in history.
      if (object?.path.startsWith('payments/')) {
        const privateKey = objectKey({ ...object, bucket: env.SUPABASE_PAYMENT_BUCKET });
        if (wanted.has(privateKey)) referenced.add(privateKey);
      }
    } else if (Array.isArray(value)) value.forEach(inspect);
    else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
  };
  const db = mongoose.connection.db;
  if (!db) throw new AppError('Cannot check saved photos right now. Please try again.', 503);
  for (const [collection, fields] of Object.entries(MEDIA_FIELDS)) {
    const projection = Object.fromEntries(fields.map(field => [field, 1]));
    const cursor = db.collection(collection).find({}, { projection: { _id: 0, ...projection } });
    try {
      for await (const doc of cursor) {
        inspect(doc);
        if (referenced.size === wanted.size) return referenced;
      }
    } finally { await cursor.close(); }
  }
  return referenced;
}

type DeletionRequest = StorageObject & { _id: unknown; attempts?: number };

async function attemptDeletions(requests: DeletionRequest[]) {
  const referenced = await referencedObjects(requests);
  let deleted = 0;
  for (const request of requests) {
    if (referenced.has(objectKey(request))) {
      await MediaDeletion.updateOne({ _id: request._id }, { $set: { nextAttemptAt: new Date(Date.now() + 60_000) } });
      continue;
    }
    try {
      const { error } = await getSupabase().storage.from(request.bucket).remove([request.path]);
      if (error) throw error;
      await MediaDeletion.deleteOne({ _id: request._id });
      deleted++;
    } catch {
      // Do not leak credentials, signed URLs or vendor diagnostics into the client/logs.
      const delay = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(request.attempts ?? 0, 6));
      await MediaDeletion.updateOne({ _id: request._id }, {
        $inc: { attempts: 1 }, $set: { nextAttemptAt: new Date(Date.now() + delay) },
      });
      logger.warn({ deletionId: String(request._id) }, '[media] storage cleanup queued for retry');
    }
  }
  return deleted;
}

export async function requestMediaDeletion(reference: string, ownerId: string) {
  const object = parseStorageObject(reference);
  if (!object) throw new AppError('This photo cannot be removed from this storage account.', 422);
  if (object.path.split('/')[1] !== ownerId) throw new AppError('You can only remove your own uploaded photos.', 403);
  const request = await MediaDeletion.findOneAndUpdate(object, {
    $setOnInsert: { ...object, ownerId, nextAttemptAt: new Date() },
  }, { upsert: true, returnDocument: 'after' });
  // Once accepted, the durable job survives server restarts and failed form saves.
  const deleted = await attemptDeletions([request]);
  return { status: deleted ? 'deleted' as const : 'pending' as const };
}

export async function cleanupRemovedMedia() {
  if (!env.SUPABASE_URL) return { deleted: 0 };
  const requests = await MediaDeletion.find({
    projectOrigin: projectOrigin(),
    bucket: { $in: [env.SUPABASE_STORAGE_BUCKET, env.SUPABASE_PAYMENT_BUCKET] },
    nextAttemptAt: { $lte: new Date() },
  }).sort({ nextAttemptAt: 1 }).limit(25);
  if (!requests.length) return { deleted: 0 };
  return { deleted: await attemptDeletions(requests) };
}
