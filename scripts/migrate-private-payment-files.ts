import { createHash } from 'node:crypto';
import { env } from '../src/config/env';
import { getSupabase } from '../src/config/supabase';
import { ensurePaymentBucket, paymentFilePath } from '../src/services/paymentFiles.service';

/** Dry-run by default. Copy, verify, then remove each legacy public receipt. */
async function main() {
  const apply = process.argv.includes('--apply');
  const storage = getSupabase().storage;
  const source = storage.from(env.SUPABASE_STORAGE_BUCKET);
  const target = storage.from(env.SUPABASE_PAYMENT_BUCKET);
  const paths: string[] = [];
  async function walk(folder: string) {
    for (let offset = 0; ; offset += 100) {
      const result = await source.list(folder, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
      if (result.error) throw new Error('Could not list legacy payment files');
      for (const item of result.data ?? []) {
        const path = `${folder}/${item.name}`;
        if (!item.id) await walk(path);
        else { paymentFilePath(`payment-file:${path}`); paths.push(path); }
      }
      if ((result.data?.length ?? 0) < 100) break;
    }
  }
  await walk('payments');
  console.log(`${apply ? 'Migrating' : 'Dry run:'} ${paths.length} legacy payment files.`);
  if (!apply) { console.log('Run again with --apply to copy and verify private files, then remove the public copies.'); return; }
  await ensurePaymentBucket();
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  let moved = 0;
  for (const path of paths) {
    const old = await source.download(path);
    if (old.error || !old.data) throw new Error('Could not download a legacy receipt; migration stopped');
    const bytes = Buffer.from(await old.data.arrayBuffer());
    const copy = await target.upload(path, bytes, { contentType: old.data.type, upsert: true, cacheControl: '0' });
    if (copy.error) throw new Error('Could not copy a receipt into private storage; public copy preserved');
    const check = await target.download(path);
    if (check.error || !check.data || hash(Buffer.from(await check.data.arrayBuffer())) !== hash(bytes)) {
      throw new Error('Private copy verification failed; public copy preserved');
    }
    const removed = await source.remove([path]);
    if (removed.error) throw new Error('Private copy verified, but public copy could not be removed. Retry migration.');
    moved++;
    console.log(`Verified private copy and removed public original ${moved}/${paths.length}.`);
  }
  console.log(`Migrated and verified ${moved} private files. Purge previously cached public receipt URLs from your storage/CDN provider if needed.`);
}
main().catch(() => { console.error('Payment file migration failed. No unverified public copy was removed. Check storage access and retry.'); process.exitCode = 1; });
