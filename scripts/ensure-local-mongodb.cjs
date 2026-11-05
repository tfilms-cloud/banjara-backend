const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

function usesManagedLocalDatabase(environment, platform) {
  if (platform !== 'win32' || (environment.NODE_ENV || 'development') !== 'development') return false;
  try {
    const uri = new URL(environment.MONGODB_URI);
    return uri.protocol === 'mongodb:' &&
      ['127.0.0.1', 'localhost'].includes(uri.hostname) &&
      uri.port === '27018' && uri.pathname === '/banjara' &&
      uri.searchParams.get('replicaSet') === 'banjara-test';
  } catch { return false; }
}

function main() {
  const root = path.resolve(__dirname, '..');
  let fileEnvironment = {};
  try { fileEnvironment = dotenv.parse(readFileSync(path.join(root, '.env'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const environment = { ...fileEnvironment, ...process.env };
  if (!usesManagedLocalDatabase(environment, process.platform)) return;

  console.log('Ensuring the local test MongoDB replica set is running...');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'start-local-mongodb.ps1'),
  ], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 90_000 });
  if (result.error || result.status !== 0) {
    console.error('Local MongoDB startup failed. Check .local-mongodb/mongod.log, then run npm run db:local.');
    process.exitCode = 1;
  }
}

module.exports = { usesManagedLocalDatabase };
if (require.main === module) main();
