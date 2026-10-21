import { defineConfig } from 'vitest/config';

// Slow suite (pnpm --filter @retrograde/engine test:slow, nightly in CI).
export default defineConfig({
  test: {
    include: ['test/**/*.slow.test.ts'],
    // Phase 0 has no slow tests yet; Phase 1 adds deep perft runs.
    passWithNoTests: true,
    testTimeout: 0,
  },
});
