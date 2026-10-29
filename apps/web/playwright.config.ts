import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** The e2e API (scripts/e2e-api.mjs): a fresh "e2e" schema in the test database. */
const API_PORT = 8092;

/**
 * End-to-end tests and the screenshot review, against the production build (vite build +
 * preview), so the worker bundling is exercised too, and a real API on fixture puzzles (needs
 * PostgreSQL and TEST_DATABASE_URL).
 *   pnpm --filter @retrograde/web test:e2e   e2e tests (project "e2e")
 *   pnpm --filter @retrograde/web shots      screenshots for visual review (project "shots")
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'e2e',
      testMatch: '*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'shots',
      testMatch: 'screenshots.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Always fresh, so every run starts from the same data.
      command: 'node ../../scripts/e2e-api.mjs',
      url: `http://127.0.0.1:${String(API_PORT)}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: `pnpm exec vite build && pnpm exec vite preview --port ${String(PORT)} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${String(PORT)}`,
      // Never reused: a running preview could be an old build, or proxy /api to the dev database.
      reuseExistingServer: false,
      env: { E2E: '1', E2E_API_PORT: String(API_PORT) },
      timeout: 120_000,
    },
  ],
});
