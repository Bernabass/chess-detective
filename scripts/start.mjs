// `pnpm start`: runs the production build (`pnpm build`) locally on http://localhost:8090, the
// API and the web app from one binary, against the database in .env. It applies pending
// migrations first. Port 8090 leaves `pnpm dev` (5173 and 8080) free to keep running.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './env.mjs';

const PORT = '8090';
const bin = join(
  root,
  'services',
  'api',
  'bin',
  process.platform === 'win32' ? 'retrograde.exe' : 'retrograde',
);
if (!existsSync(bin)) {
  console.error('start: no production build yet. Run pnpm build first.');
  process.exit(1);
}

// Real environment variables beat .env, so these apply to this server only. BASE_URL is this
// server, because state-changing requests must come from its origin.
const env = { ...process.env, PORT, BASE_URL: `http://localhost:${PORT}` };

const migrate = spawnSync(bin, ['migrate'], { cwd: root, env, stdio: 'inherit' });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

console.log(`start: open http://localhost:${PORT}`);
const server = spawn(bin, ['serve'], { cwd: root, env, stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
