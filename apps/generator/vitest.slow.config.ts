import { defineConfig } from 'vitest/config';

// Slow suite (pnpm --filter @retrograde/generator test:slow, nightly in CI).
export default defineConfig({
  test: {
    include: ['test/**/*.slow.test.ts'],
    testTimeout: 0,
  },
});
