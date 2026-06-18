import { defineConfig } from '@playwright/test';

/**
 * Smoke harness config. Single browser (chromium), single worker, no retries —
 * the harness is designed to surface regressions, not paper over flakes.
 *
 * Override host URLs / credentials via environment variables — see README.md.
 */
const FRONTEND_URL = process.env.NRSA_FRONTEND_URL || 'http://localhost:8000';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,           // generous: includes login + backfill + 2 sends
  expect: { timeout: 10_000 },
  retries: 0,                // a flaky smoke is a real signal — investigate
  workers: 1,                // single worker so test data tagging stays clean
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: FRONTEND_URL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
