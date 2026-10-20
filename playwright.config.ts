import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A throwaway data directory per run, so e2e never touches real or demo data.
const DATA_DIR = process.env.CARECIRCLE_E2E_DATA_DIR
  ?? mkdtempSync(join(tmpdir(), 'carecircle-e2e-'));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,       // one shared database per run
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3101',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.ts/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    // Production build, so the e2e run exercises what would actually ship.
    command: 'npm run migrate --silent && npx next start -p 3101 -H 127.0.0.1',
    url: 'http://127.0.0.1:3101/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CARECIRCLE_DATA_DIR: DATA_DIR,
      NODE_ENV: 'production',
      // Lets each spec present itself as a distinct device via X-Forwarded-For,
      // so the per-device rate limits stay switched on and realistic instead of
      // every spec sharing one bucket. The app ignores the header otherwise.
      CARECIRCLE_TRUST_PROXY: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
