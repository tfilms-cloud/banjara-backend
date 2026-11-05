import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase, supportsTransactions } from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { User } from '../models/User';
import { buildDemoCatalog, DEMO_NAMESPACE, type DemoPlan } from './demoCatalog';
import { assertDemoOwnership, applyDemoCatalog, validateDemoPlan } from './demoDatabase';
import { demoImageResolver, uploadDemoImages } from './demoImages';

export function assertLocalDemoSeedAllowed(environment: { NODE_ENV?: string; MONGODB_URI: string }) {
  const uri = new URL(environment.MONGODB_URI);
  if (environment.NODE_ENV === 'production' || uri.protocol !== 'mongodb:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(uri.hostname)) {
    throw new Error('Demo fixtures are restricted to non-production loopback MongoDB. No remote/production database will be seeded.');
  }
}

function summarize(plan: DemoPlan) {
  const counts: Record<string, number> = {};
  for (const record of plan.records) counts[record.model] = (counts[record.model] || 0) + 1;
  return counts;
}

async function fingerprintExisting() {
  const db = mongoose.connection.db!;
  const result = new Map<string, Map<string, string>>();
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith('system.')) continue;
    const hashes = new Map<string, string>();
    for await (const document of db.collection(name).find({})) {
      hashes.set(String(document._id), createHash('sha256').update(JSON.stringify(document)).digest('hex'));
    }
    result.set(name, hashes);
  }
  return result;
}

async function verifyPreserved(before: Awaited<ReturnType<typeof fingerprintExisting>>) {
  const db = mongoose.connection.db!;
  let checked = 0;
  for (const [name, originals] of before) {
    if (!originals.size) continue;
    let found = 0;
    for await (const document of db.collection(name).find({})) {
      const expected = originals.get(String(document._id));
      if (!expected) continue;
      found++;
      if (createHash('sha256').update(JSON.stringify(document)).digest('hex') !== expected) {
        throw new Error(`An original ${name} record changed during the seed. Check for concurrent application activity.`);
      }
    }
    if (found !== originals.size) throw new Error(`An original ${name} record disappeared during the seed.`);
    checked += found;
  }
  return checked;
}

async function run() {
  assertLocalDemoSeedAllowed(env);
  const apply = process.argv.includes('--apply');
  const resolver = demoImageResolver();
  if (!apply) {
    const plan = buildDemoCatalog({ now: new Date(), passwordHash: 'dry-run-not-a-password', image: resolver.image });
    await validateDemoPlan(plan);
    console.log(JSON.stringify({ dryRun: true, date: plan.today, providersPerCategory: 4,
      plannedRecords: summarize(plan), plannedImages: resolver.requests.size,
      message: 'No database or storage writes. Add --apply to insert missing demo fixtures.' }, null, 2));
    return;
  }

  const localDirectory = path.resolve(__dirname, '../../.local-demo');
  await mkdir(localDirectory, { recursive: true });
  const credentialsPath = path.join(localDirectory, 'credentials.json');
  let password: string;
  try {
    const existing = JSON.parse(await readFile(credentialsPath, 'utf8')) as { namespace: string; password: string };
    if (existing.namespace !== DEMO_NAMESPACE || typeof existing.password !== 'string' || existing.password.length < 16) {
      throw new Error('Existing demo credential file is invalid. It was not overwritten.');
    }
    password = existing.password;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    password = `Demo-${randomBytes(18).toString('base64url')}!`;
    await writeFile(credentialsPath, JSON.stringify({ namespace: DEMO_NAMESPACE, password }, null, 2), { flag: 'wx', mode: 0o600 });
  }
  const passwordHash = await hashPassword(password);
  const plan = buildDemoCatalog({ now: new Date(), passwordHash, image: resolver.image });
  await validateDemoPlan(plan);
  await connectDatabase();
  if (!await supportsTransactions()) throw new Error('The demo fixture load requires a local MongoDB replica set.');
  await assertDemoOwnership(plan);
  const existingDemoUsers = await User.find({ _id: { $in: plan.accounts.map(account => account.userId) } })
    .select('+passwordHash');
  for (const user of existingDemoUsers) {
    if (!await comparePassword(password, user.passwordHash)) {
      throw new Error('An existing demo password differs from the local credential file. It was not reset.');
    }
  }
  const before = await fingerprintExisting();
  const photos = await uploadDemoImages([...resolver.requests.values()], path.join(localDirectory, 'images'));
  const inserted = await applyDemoCatalog(plan);
  const preservedOriginalRecords = await verifyPreserved(before);
  const report = { namespace: DEMO_NAMESPACE, date: plan.today, inserted, photos,
    preservedOriginalRecords, accounts: plan.accounts, completedAt: new Date().toISOString() };
  await writeFile(path.join(localDirectory, 'report.json'), JSON.stringify(report, null, 2));
  const sections = ['# Banjara demo provider accounts', '',
    'Local testing only. These 20 fictional providers are approved fixtures, not verified real businesses.', '',
    `Shared demo password: \`${password}\``, '',
    'Stock photos are illustrative. Contact numbers, documents, insurance and bank details are synthetic.',
    'Never send real money to the demo receiving accounts. Existing app records were preserved.', '',
    `Seed date (Asia/Karachi): ${plan.today}. Hotel availability: 60 days. Guide availability: 90 days.`, '',
    '## Logins', ''];
  for (const account of plan.accounts) {
    sections.push(`- **${account.name}** (${account.category}): \`${account.email}\``);
  }
  sections.push('', '## Re-run', '',
    '`npm run seed:demo -- --apply` adds missing fixtures/current dated inventory without resetting existing records.',
    'Run `npm run verify:demo` to check the customer API and all provider logins.', '',
    `Photos verified: ${photos.verified}. Existing records checked unchanged: ${preservedOriginalRecords}.`, '');
  await writeFile(path.resolve(__dirname, '../../DEMO-ACCOUNTS.local.md'), sections.join('\n'), { mode: 0o600 });
  console.log(JSON.stringify({ applied: true, date: plan.today, inserted, photos, preservedOriginalRecords,
    credentials: 'DEMO-ACCOUNTS.local.md', report: '.local-demo/report.json' }, null, 2));
}

if (require.main === module) {
  run().catch(error => {
    console.error(error instanceof Error ? error.message : 'Demo seed failed');
    process.exitCode = 1;
  }).finally(async () => { await disconnectDatabase(); });
}
