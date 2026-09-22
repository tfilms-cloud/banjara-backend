import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    // One worker so the single in-memory replica set is not contended, and so
    // suites cannot interfere via shared process-local state.
    pool: 'forks',
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      // Placeholder URI only — tests connect to the in-memory replica set directly.
      MONGODB_URI: 'mongodb://127.0.0.1:27017/banjara-test',
      JWT_ACCESS_SECRET: 'test_access_secret_0123456789abcdef',
      JWT_REFRESH_SECRET: 'test_refresh_secret_0123456789abcdef',
      PAYMENT_SECRET: 'test_payment_secret',
      CLIENT_URL: 'http://localhost:8081',
    },
  },
});
