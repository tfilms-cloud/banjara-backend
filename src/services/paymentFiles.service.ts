import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { getSupabase } from '../config/supabase';
import { sniffImageType } from '../utils/imageSignature';
import { AppError } from '../utils/AppError';

const PREFIX = 'payment-file:';
let ready: Promise<void> | undefined;

export async function ensurePaymentBucket() {
  if (!ready) ready = (async () => {
    if (env.SUPABASE_PAYMENT_BUCKET === env.SUPABASE_STORAGE_BUCKET) {
      throw new AppError('Payment storage must use a separate private bucket', 503);
    }
    const storage = getSupabase().storage;
    const { data, error } = await storage.getBucket(env.SUPABASE_PAYMENT_BUCKET);
    if (error && !['404', '400'].includes(String(error.statusCode))) {
      throw new AppError('Payment storage is unavailable', 503);
    }
    if (!data) {
      const result = await storage.createBucket(env.SUPABASE_PAYMENT_BUCKET, {
        public: false, fileSizeLimit: '5MB',
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      });
      if (result.error) throw new AppError('Could not prepare private payment storage', 503);
    } else if (data.public) {
      const result = await storage.updateBucket(env.SUPABASE_PAYMENT_BUCKET, { public: false });
      if (result.error) throw new AppError('Could not secure payment storage', 503);
    }
  })().catch((error) => { ready = undefined; throw error; });
  return ready;
}

export function paymentFilePath(reference: string) {
  const path = reference.startsWith(PREFIX) ? reference.slice(PREFIX.length) : '';
  if (!/^payments\/[a-f\d]{24}\/[A-Za-z\d-]+\.(jpg|png|webp|gif)$/.test(path)) {
    throw new AppError('Upload this attachment again using private payment storage', 422);
  }
  return path;
}

export async function signPaymentFile(reference: string): Promise<string> {
  let ref = reference;
  // Legacy public URLs resolve ONLY to the migrated copy in the private bucket.
  if (!ref.startsWith(PREFIX)) {
    const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)}/`;
    if (!ref.startsWith(base)) return '';
    ref = PREFIX + decodeURIComponent(ref.slice(base.length));
  }
  const path = paymentFilePath(ref);
  await ensurePaymentBucket();
  const result = await getSupabase().storage.from(env.SUPABASE_PAYMENT_BUCKET)
    .createSignedUrl(path, 15 * 60);
  if (result.error || !result.data?.signedUrl) throw new AppError('Could not open payment attachment', 503);
  return result.data.signedUrl;
}

/** Only the uploader may attach a file; readers are authorized by the payment service. */
export async function assertOwnedPaymentFiles(references: string[], userId: string) {
  await ensurePaymentBucket();
  for (const reference of references) {
    const path = paymentFilePath(reference);
    if (!path.startsWith(`payments/${userId}/`)) throw new AppError('Attachment does not belong to you', 403);
    const filename = path.split('/')[2];
    const result = await getSupabase().storage.from(env.SUPABASE_PAYMENT_BUCKET)
      .list(`payments/${userId}`, { search: filename, limit: 1 });
    if (result.error) throw new AppError('Could not check payment attachment', 503);
    if (!result.data?.some((file) => file.name === filename)) throw new AppError('Payment attachment not found', 422);
  }
}

export async function uploadPaymentImage(buffer: Buffer, userId: string) {
  const mime = sniffImageType(buffer);
  if (!mime) throw new AppError('File content is not a supported image', 400);
  if (buffer.length > 5 * 1024 * 1024) throw new AppError('Maximum image size is 5MB', 422);
  await ensurePaymentBucket();
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  const path = `payments/${userId}/${randomUUID()}.${ext}`;
  const result = await getSupabase().storage.from(env.SUPABASE_PAYMENT_BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false, cacheControl: '0' });
  if (result.error) throw new AppError('Could not upload payment attachment', 503);
  const storageRef = `${PREFIX}${path}`;
  return { url: await signPaymentFile(storageRef), storageRef, path, folder: 'payments', bucket: env.SUPABASE_PAYMENT_BUCKET };
}
