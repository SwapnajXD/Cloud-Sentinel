import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/cloud_sentinel_e2e' || process.env.DATABASE_URL !== databaseUrl) {
  throw new Error('Browser smoke tests require DATABASE_URL and E2E_DATABASE_URL to match a dedicated cloud_sentinel_e2e database.');
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:43101',
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'npm run start --prefix ../gateway', url: 'http://127.0.0.1:43100/ready',
      timeout: 120_000, reuseExistingServer: false,
      env: { DATABASE_URL: databaseUrl, PORT: '43100', REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
        JWT_SECRET: process.env.JWT_SECRET || 'cloud-sentinel-e2e-only-secret-1234567890' } },
    { command: 'node .next/standalone/server.js', url: 'http://127.0.0.1:43101/login',
      timeout: 120_000, reuseExistingServer: false,
      env: { PORT: '43101', HOSTNAME: '127.0.0.1', BACKEND_URL: 'http://127.0.0.1:43100' } },
  ],
});
