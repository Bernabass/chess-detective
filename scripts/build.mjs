// `pnpm build`: the production build. Builds the web app, copies it into the Go module (go:embed
// can't read outside it) and compiles services/api/bin/retrograde with the web app embedded, the
// same binary the Dockerfile builds. `pnpm start` runs it.
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './env.mjs';

const check = (r, what) => {
  if (r.error) {
    console.error(`build: could not run ${what} (${r.error.message})`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const run = (cmd, args) => check(spawnSync(cmd, args, { cwd: root, stdio: 'inherit' }), cmd);

// pnpm is a .cmd file on Windows, which only a shell can start; the command is a fixed string.
check(
  spawnSync('pnpm --filter @retrograde/web build', { cwd: root, stdio: 'inherit', shell: true }),
  'pnpm',
);

const embedDir = join(root, 'services', 'api', 'internal', 'webui', 'dist');
rmSync(embedDir, { recursive: true, force: true });
cpSync(join(root, 'apps', 'web', 'dist'), embedDir, { recursive: true });

const bin = process.platform === 'win32' ? 'bin/retrograde.exe' : 'bin/retrograde';
run('go', ['-C', 'services/api', 'build', '-tags', 'webui', '-o', bin, './cmd/retrograde']);
console.log(`build: services/api/${bin} (API and web app); run it with pnpm start`);
