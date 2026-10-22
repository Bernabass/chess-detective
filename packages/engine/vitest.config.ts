import { defineConfig } from 'vitest/config';

// Fast suite: everything except *.slow.test.ts.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.slow.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary'],
      // ARCHITECTURE.md §11.2: engine statement coverage at least 90%.
      thresholds: { statements: 90 },
    },
  },
});
