import { defineConfig } from '@playwright/test';

/**
 * Playwright Electron smoke test config.
 *
 * Tests live in `tests/e2e/`. The Electron app is launched per test via
 * `_electron.launch()` inside the test itself — we don't need the browser
 * `projects` array.
 *
 * Run: `npm run test:e2e`
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Electron is heavy; run one window at a time
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
