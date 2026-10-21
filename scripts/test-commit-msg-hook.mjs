// Proves the commit-msg hook strips AI attribution, without ever putting such a
// commit in this repository: the test commit is made in a throwaway repo in the
// OS temp folder that borrows this repo's .githooks directory.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hooksDir = join(root, '.githooks');

// Variables a parent git process may set; they would redirect our git calls.
const env = { ...process.env };
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY']) {
  delete env[name];
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

const failures = [];

// 1. `pnpm install` configured this checkout.
if (existsSync(join(root, '.git'))) {
  const hooksPath = git(root, ['config', '--get', 'core.hooksPath']).trim();
  if (hooksPath !== '.githooks') {
    failures.push(`core.hooksPath is "${hooksPath}", expected ".githooks" (run pnpm install)`);
  }
}

// 2. The hook strips AI attribution and keeps everything else.
const dir = mkdtempSync(join(tmpdir(), 'retrograde-hook-test-'));
try {
  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'user.name', 'Hook Test']);
  git(dir, ['config', 'user.email', 'hook-test@example.invalid']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', hooksDir.replaceAll('\\', '/')]);

  const message = [
    'feat: test commit',
    '',
    'Body line stays.',
    '',
    'Generated with [Claude Code](https://claude.com/claude-code)',
    'Claude-Session: https://claude.ai/code/session_example',
    'Co-Authored-By: Jane Doe <jane@example.com>',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    '',
  ].join('\n');
  git(dir, ['commit', '--allow-empty', '--quiet', '--message', message]);
  const stored = git(dir, ['log', '-1', '--format=%B']);

  for (const banned of ['Co-Authored-By: Claude', 'Generated with', 'Claude-Session']) {
    if (stored.includes(banned)) failures.push(`stored message still contains "${banned}"`);
  }
  for (const kept of ['feat: test commit', 'Body line stays.', 'Co-Authored-By: Jane Doe']) {
    if (!stored.includes(kept)) failures.push(`stored message lost "${kept}"`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('commit-msg hook test FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  'commit-msg hook test passed: hooks path set, AI attribution stripped, other lines kept.',
);
