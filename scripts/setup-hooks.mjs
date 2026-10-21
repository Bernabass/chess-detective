// `prepare` step of `pnpm install`: points git at the repo's hooks so the
// commit-msg hook (which strips AI attribution) is always active.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

if (!existsSync(join(root, '.git'))) {
  // e.g. a Docker build or a tarball: nothing to configure.
  console.log('setup-hooks: not a git checkout, skipping.');
  process.exit(0);
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) {
  console.error(`setup-hooks: could not run git (${result.error.message}). Is Git installed?`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (process.platform !== 'win32') {
  chmodSync(join(root, '.githooks', 'commit-msg'), 0o755);
}
console.log('setup-hooks: core.hooksPath = .githooks');
