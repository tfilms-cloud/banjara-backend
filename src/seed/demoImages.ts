import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSupabase, buildPublicObjectUrl } from '../config/supabase';
import { env } from '../config/env';
import { sniffImageType } from '../utils/imageSignature';
import { DEMO_NAMESPACE, DEMO_PHOTOS, type DemoImage } from './demoCatalog';

export type DemoImageRequest = { path: string; photo: DemoImage; url: string };

export function demoImageResolver() {
  const requests = new Map<string, DemoImageRequest>();
  return {
    requests,
    image(userId: string, folder: string, photo: DemoImage) {
      const objectPath = `${folder}/${userId}/${DEMO_NAMESPACE}-${photo}.jpg`;
      const url = buildPublicObjectUrl(env.SUPABASE_STORAGE_BUCKET, objectPath);
      requests.set(objectPath, { path: objectPath, photo, url });
      return url;
    },
  };
}

/** Stock photographs go only into the configured existing public bucket and demo-owned paths. */
export async function uploadDemoImages(requests: DemoImageRequest[], cacheDirectory: string) {
  const client = getSupabase();
  const { data: bucket, error } = await client.storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
  if (error || !bucket?.public) throw new Error('Demo images require the configured public image bucket. No bucket settings were changed.');
  if (env.SUPABASE_STORAGE_BUCKET === env.SUPABASE_PAYMENT_BUCKET) {
    throw new Error('The public demo bucket must not be the payment-evidence bucket.');
  }
  await mkdir(cacheDirectory, { recursive: true });
  const downloads = new Map<DemoImage, Promise<Buffer>>();
  const download = (photo: DemoImage) => {
    if (!downloads.has(photo)) downloads.set(photo, (async () => {
      const cacheFile = path.join(cacheDirectory, `${photo}.jpg`);
      try {
        const cached = await readFile(cacheFile);
        if (sniffImageType(cached) === 'image/jpeg') return cached;
      } catch { /* Download only this fixed catalog asset if not cached. */ }
      const response = await fetch(`https://images.unsplash.com/${DEMO_PHOTOS[photo]}?w=960&fit=crop&auto=format&q=75&fm=jpg`,
        { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Demo photograph ${photo} returned HTTP ${response.status}.`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 5 * 1024 * 1024 || sniffImageType(buffer) !== 'image/jpeg') {
        throw new Error(`Demo photograph ${photo} is not a supported size/JPEG.`);
      }
      await writeFile(cacheFile, buffer);
      return buffer;
    })());
    return downloads.get(photo)!;
  };
  let uploaded = 0;
  for (let start = 0; start < requests.length; start += 4) {
    const results = await Promise.allSettled(requests.slice(start, start + 4).map(async request => {
      const buffer = await download(request.photo);
      const result = await client.storage.from(env.SUPABASE_STORAGE_BUCKET).upload(request.path, buffer,
        { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
      if (result.error && !/already exists|duplicate/i.test(result.error.message)) {
        throw new Error(`Could not upload demo photo ${request.photo}: ${result.error.message}`);
      }
      // Public serving is verified even for an existing object; a generated URL alone is insufficient.
      const check = await fetch(request.url, { signal: AbortSignal.timeout(20_000) });
      if (!check.ok || !(check.headers.get('content-type') || '').startsWith('image/')) {
        await check.body?.cancel();
        throw new Error(`Demo photo ${request.photo} is not publicly readable (HTTP ${check.status}).`);
      }
      await check.body?.cancel();
      if (!result.error) uploaded++;
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    console.log(`Verified demo images: ${Math.min(start + 4, requests.length)}/${requests.length}`);
  }
  return { verified: requests.length, newlyUploaded: uploaded };
}
