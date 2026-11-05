import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { sniffImageType } from '../utils/imageSignature';
import { STORAGE_UNAVAILABLE_MESSAGE, supabaseCredentialIssue } from '../utils/supabaseCredentials';

export type UploadFolder =
  | 'avatars'
  | 'vehicles'
  | 'hotels'
  | 'rooms'
  | 'logos'
  | 'chat'
  | 'tours'
  | 'guides'
  | 'restaurants'
  | 'payments';

export const UPLOAD_FOLDERS: UploadFolder[] = [
  'avatars',
  'vehicles',
  'hotels',
  'rooms',
  'logos',
  'chat',
  'tours',
  'guides',
  'restaurants',
  'payments',
];

let supabase: SupabaseClient | null = null;
let bucketReady = false;

export function isSupabaseConfigured() {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabase() {
  const issue = supabaseCredentialIssue(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  if (issue) {
    logger.error({ configuration: issue }, '[supabase] invalid server upload configuration');
    throw new AppError(STORAGE_UNAVAILABLE_MESSAGE, 503);
  }
  if (!supabase) {
    supabase = createClient(env.SUPABASE_URL.trim(), env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

function extensionFromMime(mime: string) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

function describeStorageError(error: {
  message?: string;
  name?: string;
  statusCode?: string | number;
  error?: string;
  originalError?: unknown;
}) {
  const message = error.message || error.error || 'Failed to upload image';
  const lower = message.toLowerCase();
  const cause =
    error.originalError && typeof error.originalError === 'object'
      ? (error.originalError as { cause?: { code?: string; hostname?: string }; code?: string; hostname?: string })
      : undefined;
  const nested = cause?.cause ?? cause;
  const dnsHost = nested?.hostname;
  const dnsCode = nested?.code;

  if (dnsCode === 'ENOTFOUND' || lower.includes('fetch failed') || lower.includes('enotfound')) {
    return (
      `Cannot reach Supabase host${dnsHost ? ` (${dnsHost})` : ''}. ` +
      'Check SUPABASE_URL in banjara-backend/.env — copy the exact Project URL from ' +
      'Supabase Dashboard → Project Settings → API (https://YOUR_REF.supabase.co). ' +
      'If the project was paused/deleted, restore it or create a new project.'
    );
  }

  if (lower.includes('invalid jwt') || lower.includes('jwt')) {
    return STORAGE_UNAVAILABLE_MESSAGE;
  }

  if (lower.includes('bucket') && (lower.includes('not found') || lower.includes('not exist'))) {
    return (
      `Storage bucket "${env.SUPABASE_STORAGE_BUCKET}" was not found. ` +
      'Create a public bucket with that exact name in Supabase → Storage, then retry.'
    );
  }

  if (lower.includes('row-level security') || lower.includes('rls') || lower.includes('policy')) {
    return STORAGE_UNAVAILABLE_MESSAGE;
  }

  return message;
}

async function ensureBucket(client: SupabaseClient) {
  if (bucketReady) return;
  const bucket = env.SUPABASE_STORAGE_BUCKET;

  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) {
    logger.error({ err: listError }, '[supabase] listBuckets failed');
    throw new AppError(describeStorageError(listError), 502);
  }

  const existing = (buckets ?? []).find((item) => item.name === bucket);
  if (!existing) {
    const { error: createError } = await client.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: '5MB',
      allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
    });
    if (createError) {
      const msg = createError.message?.toLowerCase() ?? '';
      if (!msg.includes('already') && !msg.includes('exists')) {
        logger.error({ err: createError }, '[supabase] createBucket failed');
        throw new AppError(describeStorageError(createError), 502);
      }
    }
  } else if (!existing.public) {
    const { error: updateError } = await client.storage.updateBucket(bucket, {
      public: true,
      fileSizeLimit: '5MB',
      allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
    });
    if (updateError) {
      logger.warn({ err: updateError }, '[supabase] could not make bucket public');
    }
  }

  bucketReady = true;
}

/** Build a mobile-safe public URL (spaces/special chars must be encoded). */
export function buildPublicObjectUrl(bucket: string, objectPath: string) {
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath = objectPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${base}/storage/v1/object/public/${encodedBucket}/${encodedPath}`;
}

export async function uploadImageBuffer(input: {
  buffer: Buffer;
  mime: string;
  folder: UploadFolder;
  userId: string;
  originalName?: string;
}) {
  if (input.folder === 'payments') {
    throw new AppError('Payment files must use private payment storage', 400);
  }
  if (!input.mime.startsWith('image/')) {
    throw new AppError('Only image uploads are allowed', 400);
  }

  // Trust the magic bytes, not the client-supplied multipart MIME type.
  const detected = sniffImageType(input.buffer);
  if (!detected) {
    throw new AppError('File content is not a supported image (jpeg, png, webp, gif)', 400);
  }

  const client = getSupabase();
  await ensureBucket(client);

  const bucket = env.SUPABASE_STORAGE_BUCKET;
  const ext = extensionFromMime(detected);
  // Filename is generated server-side; the client's originalname never reaches the path.
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const path = `${input.folder}/${input.userId}/${safeName}`;

  const { error } = await client.storage.from(bucket).upload(path, input.buffer, {
    contentType: detected,
    upsert: false,
    cacheControl: '3600',
  });

  if (error) {
    logger.error({ err: error }, '[supabase] upload failed');
    const lower = (error.message || '').toLowerCase();
    if (lower.includes('bucket') && lower.includes('not found')) {
      bucketReady = false;
      await ensureBucket(client);
      const retry = await client.storage.from(bucket).upload(path, input.buffer, {
        contentType: detected,
        upsert: false,
        cacheControl: '3600',
      });
      if (retry.error) {
        logger.error({ err: retry.error }, '[supabase] upload retry failed');
        throw new AppError(describeStorageError(retry.error), 502);
      }
    } else {
      throw new AppError(describeStorageError(error), 502);
    }
  }

  // Prefer manually encoded URL — getPublicUrl leaves spaces unencoded which breaks RN Image.
  const url = buildPublicObjectUrl(bucket, path);

  return {
    url,
    path,
    folder: input.folder,
    bucket,
  };
}
