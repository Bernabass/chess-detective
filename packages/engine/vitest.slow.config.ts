import { defineConfig } from 'vitest/config';

// Slow suite (pnpm --filter @retrograde/engine test:slow, nightly in CI).
export default defineConfig({
  test: {
    include: ['test/**/*.slow.test.ts'],
    // No slow tests yet; deep perft runs come with move generation.
    passWithNoTests: true,
    testTimeout: 0,
  },
});
