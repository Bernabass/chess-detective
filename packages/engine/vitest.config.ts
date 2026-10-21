import { defineConfig } from 'vitest/config';

// Fast suite: everything except *.slow.test.ts.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.slow.test.ts'],
  },
});
