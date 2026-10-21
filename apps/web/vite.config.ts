import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // The repo-root .env holds PORT for the Go API; real environment variables win.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
  const apiHost = env.HOST && env.HOST !== '0.0.0.0' ? env.HOST : '127.0.0.1';
  const apiPort = env.PORT ?? '8080';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': `http://${apiHost}:${apiPort}`,
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
