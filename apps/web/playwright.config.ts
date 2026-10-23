import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * End-to-end tests and the screenshot review, against the production build (vite build +
 * preview), so the worker bundling is exercised too.
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
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --port ${String(PORT)} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    env: { E2E: '1' },
    timeout: 120_000,
  },
});
