import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // The repo-root .env holds PORT for the Go API; real environment variables win.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
  const host = env.HOST && env.HOST !== '0.0.0.0' && env.HOST !== '::' ? env.HOST : '127.0.0.1';
  const apiHost = host.includes(':') ? `[${host}]` : host; // IPv6 needs brackets in a URL
  const apiPort = env.PORT ?? '8080';
  const apiProxy: Record<string, string> = { '/api': `http://${apiHost}:${apiPort}` };

  return {
    plugins: [react(), tailwindcss()],
    // The engine worker is an ES module (it imports the engine and Comlink).
    worker: { format: 'es' },
    server: {
      port: 5173,
      strictPort: true,
      proxy: apiProxy,
    },
    preview: {
      port: 4173,
      strictPort: true,
      // e2e runs have no API server: let /api requests fail fast instead of logging proxy errors.
      proxy: env.E2E === '1' ? {} : apiProxy,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
