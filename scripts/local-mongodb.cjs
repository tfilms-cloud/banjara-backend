// Local development only. Never connects to an external database.
const { MongoClient, BSON } = require('mongodb');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const uri = 'mongodb://127.0.0.1:27018/banjara?replicaSet=banjara-test&directConnection=true';
const root = path.resolve(__dirname, '..');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const options = { serverSelectionTimeoutMS: 2000, promoteValues: false };

async function initialize() {
  const client = new MongoClient(uri, options);
  try {
    let connected = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await client.connect(); connected = true; break; }
      catch { await wait(500); }
    }
    if (!connected) throw new Error('Local MongoDB did not start on port 27018.');
    const admin = client.db('admin');
    const hello = await admin.command({ hello: 1 });
    if (hello.setName && hello.setName !== 'banjara-test') throw new Error('Port 27018 belongs to another replica set.');
    if (!hello.setName) {
      await admin.command({ replSetInitiate: { _id: 'banjara-test', members: [{ _id: 0, host: 'localhost:27018' }] } });
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = await admin.command({ hello: 1 });
      if (state.isWritablePrimary && state.setName === 'banjara-test') {
        console.log('Local test replica set: READY');
        console.log(`Compass connection: ${uri}`);
        return;
      }
      await wait(500);
    }
    throw new Error('Local replica set did not elect a primary.');
  } finally { await client.close(); }
}

async function digest(collection) {
  const hash = createHash('sha256');
  let count = 0;
  for await (const document of collection.find({}).sort({ _id: 1 })) {
    hash.update(BSON.EJSON.stringify(document, { relaxed: false }));
    count++;
  }
  return { count, hash: hash.digest('hex') };
}

async function copyExisting() {
  const envPath = path.join(root, '.env');
  const envText = readFileSync(envPath, 'utf8');
  const sourceUri = dotenv.parse(envText).MONGODB_URI;
  const parsed = new URL(sourceUri);
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.port !== '27017' || parsed.pathname !== '/banjara') {
    throw new Error('Copy requires the existing local banjara database on port 27017.');
  }
  const source = new MongoClient(sourceUri, options);
  const target = new MongoClient(uri, options);
  let locked = false;
  try {
    await source.connect();
    await target.connect();
    const destination = target.db('banjara');
    if ((await destination.listCollections().toArray()).length) throw new Error('Destination is not empty; refusing to overwrite data.');
    const collections = await source.db('banjara').listCollections().toArray();
    if (collections.some((item) => item.type !== 'collection')) throw new Error('Views or special collections require a dedicated migration.');
    await target.db('admin').command({ setParameter: 1, ttlMonitorEnabled: false });
    // Briefly block source writes so related payment, booking and inventory documents agree.
    await source.db('admin').command({ fsync: 1, lock: true });
    locked = true;
    let documents = 0;
    for (const item of collections) {
      const original = source.db('banjara').collection(item.name);
      const copied = await destination.createCollection(item.name, item.options);
      let batch = [];
      for await (const document of original.find({})) {
        batch.push(document);
        if (batch.length === 500) { await copied.insertMany(batch); batch = []; }
      }
      if (batch.length) await copied.insertMany(batch);
      for (const index of await original.listIndexes().toArray()) {
        if (index.name === '_id_') continue;
        const { key, v, ns, ...indexOptions } = index;
        await copied.createIndex(key, indexOptions);
      }
      const before = await digest(original);
      const after = await digest(copied);
      if (before.count !== after.count || before.hash !== after.hash) throw new Error(`Verification failed for ${item.name}.`);
      documents += after.count;
    }
    const backupPath = path.join(root, '.local-mongodb', 'original.env');
    if (!existsSync(backupPath)) writeFileSync(backupPath, envText, { flag: 'wx' });
    if (!/^MONGODB_URI=/m.test(envText)) throw new Error('MONGODB_URI line was not found.');
    writeFileSync(envPath, envText.replace(/^MONGODB_URI=.*$/m, `MONGODB_URI=${uri}`));
    console.log(`Copied and SHA-256 verified ${documents} documents in ${collections.length} collections.`);
    console.log('Backend .env now uses the local test replica set. Original database preserved on port 27017.');
  } finally {
    if (locked) await source.db('admin').command({ fsyncUnlock: 1 });
    await target.db('admin').command({ setParameter: 1, ttlMonitorEnabled: true }).catch(() => {});
    await Promise.all([source.close(), target.close()]);
  }
}

const action = process.argv[2];
(action === 'init' ? initialize() : action === 'copy-existing' ? copyExisting() : Promise.reject(new Error('Use init or copy-existing.')))
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
