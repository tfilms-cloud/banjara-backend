import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';
import { AppError } from '../utils/AppError';
import { sniffImageType } from '../utils/imageSignature';

export type UploadFolder = 'avatars' | 'vehicles' | 'hotels' | 'rooms' | 'logos' | 'chat';

export const UPLOAD_FOLDERS: UploadFolder[] = [
  'avatars',
  'vehicles',
  'hotels',
  'rooms',
  'logos',
  'chat',
];

let supabase: SupabaseClient | null = null;
let bucketReady = false;

export function isSupabaseConfigured() {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new AppError('Supabase Storage is not configured on the server', 503);
  }
  if (!supabase) {
    supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
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
    return (
      'Supabase rejected the API key (Invalid JWT). In Supabase Dashboard → Project Settings → API, ' +
      'copy the legacy service_role key (starts with eyJ...) into SUPABASE_SERVICE_ROLE_KEY, ' +
      'or use a valid secret key. Then restart the backend.'
    );
  }

  if (lower.includes('bucket') && (lower.includes('not found') || lower.includes('not exist'))) {
    return (
      `Storage bucket "${env.SUPABASE_STORAGE_BUCKET}" was not found. ` +
      'Create a public bucket with that exact name in Supabase → Storage, then retry.'
    );
  }

  if (lower.includes('row-level security') || lower.includes('rls') || lower.includes('policy')) {
    return (
      'Supabase Storage blocked the upload (RLS/policy). Use the service_role/secret key on the server, ' +
      'and ensure the bucket allows uploads.'
    );
  }

  return message;
}

async function ensureBucket(client: SupabaseClient) {
  if (bucketReady) return;
  const bucket = env.SUPABASE_STORAGE_BUCKET;

  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) {
    console.error('[supabase] listBuckets failed:', listError);
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
        console.error('[supabase] createBucket failed:', createError);
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
      console.warn('[supabase] could not make bucket public:', updateError.message);
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
    console.error('[supabase] upload failed:', error);
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
        console.error('[supabase] upload retry failed:', retry.error);
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
