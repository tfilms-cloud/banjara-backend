import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { getSupabase, isSupabaseConfigured } from '../src/config/supabase';
import { supportsTransactions } from '../src/config/database';
import { supabaseCredentialIssue } from '../src/utils/supabaseCredentials';

async function main() {
  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    console.log('Database connection: OK');
    const transactions = await supportsTransactions();
    console.log(`Payment transactions: ${transactions ? 'OK (replica set)' : 'UNAVAILABLE (standalone MongoDB)'}`);
    if (!transactions) process.exitCode = 1;
    const storageIssue = supabaseCredentialIssue(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    if (storageIssue) {
      console.log(`Image storage configuration: INVALID — ${storageIssue}`);
      process.exitCode = 1;
    } else if (isSupabaseConfigured()) {
      const images = await getSupabase().storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
      const publicImages = !images.error && images.data && images.data.public;
      console.log(`Public image storage: ${publicImages ? 'OK' : 'UNAVAILABLE'}`);
      if (!publicImages) process.exitCode = 1;
      const bucket = await getSupabase().storage.getBucket(env.SUPABASE_PAYMENT_BUCKET);
      const privateBucket = !bucket.error && bucket.data && !bucket.data.public;
      console.log(`Private receipt storage: ${privateBucket ? 'OK' : 'UNAVAILABLE'}`);
      if (!privateBucket) process.exitCode = 1;
    } else {
      console.log('Private receipt storage: NOT CONFIGURED');
      process.exitCode = 1;
    }
  } finally { await mongoose.disconnect(); }
}

main().catch((error: unknown) => {
  // Never print connection strings, credentials or complete remote error objects.
  console.error(`Runtime dependency check failed (${error instanceof Error ? error.name : 'unknown error'}).`);
  process.exitCode = 1;
});
