/**
 * Live Storage smoke check. MongoDB is an isolated, disposable memory-server instance.
 * Only the two image objects created by this check are eligible for deletion.
 * Run with: npx tsx scripts/verify-media-deletion.ts
 */
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { getSupabase } from '../src/config/supabase';
import { User } from '../src/models/User';
import { MediaDeletion } from '../src/models/MediaDeletion';
import { cleanupRemovedMedia } from '../src/services/mediaDeletion.service';
import { setupTestDb, teardownTestDb } from '../test/helpers/db';
import { makeUser, authed } from '../test/helpers/auth';

const created: Array<{ bucket: string; path: string }> = [];
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5koAAAAASUVORK5CYII=', 'base64');

async function exists(object: { bucket: string; path: string }) {
  const split = object.path.lastIndexOf('/');
  const name = object.path.slice(split + 1);
  const result = await getSupabase().storage.from(object.bucket).list(object.path.slice(0, split), { search: name });
  assert.equal(result.error, null, 'Storage listing must succeed');
  return result.data?.some(file => file.name === name) ?? false;
}

async function main() {
  await setupTestDb();
  const app = createApp();
  const user = await makeUser(app, 'customer');
  const client = authed(app, user.token);
  const publicUpload = await client.post('/api/uploads').field('folder', 'avatars').attach('file', image, 'smoke.png');
  assert.equal(publicUpload.status, 201, 'Public test upload must succeed');
  const photo = publicUpload.body.data;
  created.push(photo);
  assert.equal(await exists(photo), true);
  await User.findByIdAndUpdate(user.id, { avatar: photo.url });
  const pending = await client.delete('/api/uploads').send({ reference: photo.url });
  assert.equal(pending.status, 200); assert.equal(pending.body.data.status, 'pending');
  assert.equal(await exists(photo), true, 'Saved photo must stay in Storage');
  await User.findByIdAndUpdate(user.id, { avatar: '' });
  await MediaDeletion.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
  assert.equal((await cleanupRemovedMedia()).deleted, 1);
  assert.equal(await exists(photo), false, 'Saved removal must delete the actual Storage object');
  console.log('Public photo: upload, saved reference protection, queued deletion and cloud removal OK');

  const privateUpload = await client.post('/api/uploads').field('folder', 'payments').attach('file', image, 'receipt.png');
  assert.equal(privateUpload.status, 201, 'Private test upload must succeed');
  const receipt = privateUpload.body.data;
  created.push(receipt);
  assert.equal(await exists(receipt), true);
  const removed = await client.delete('/api/uploads').send({ reference: receipt.storageRef });
  assert.equal(removed.status, 200); assert.equal(removed.body.data.status, 'deleted');
  assert.equal(await exists(receipt), false, 'Unsent receipt must be removed from private Storage');
  console.log('Private receipt: upload, stable reference deletion and cloud removal OK');
  assert.equal(await MediaDeletion.countDocuments(), 0);
}

main().catch(() => {
  // Vendor errors may contain credentials or signed URLs; do not print them.
  console.error('Live media deletion check failed. Inspect the failing check locally.');
  process.exitCode = 1;
}).finally(async () => {
  for (const object of created) {
    const { error } = await getSupabase().storage.from(object.bucket).remove([object.path]);
    if (error) { console.error('Could not clean up a smoke-test image.'); process.exitCode = 1; }
  }
  await teardownTestDb();
});
