// The API for the web app's end-to-end tests (Playwright starts it; see apps/web/playwright.config.ts).
//   1. Resets the "e2e" schema in the test database (TEST_DATABASE_URL) and loads the fixture
//      puzzles, scheduled so that today is puzzle #4 and #1-#3 are archive puzzles.
//   2. Builds the API and serves it on 127.0.0.1:8092 for the preview server's /api proxy,
//      with BASE_URL set to the preview server (POSTs must come from that origin).
// It runs until it's stopped, and stops the API with it.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDotEnv, root, setting } from './env.mjs';

export const E2E_API_PORT = 8092;
const PREVIEW = 'http://127.0.0.1:4173';
const PAST_DAYS = 3;
const DAYS = PAST_DAYS + 2; // through tomorrow, so "not released yet" can be tested
const puzzles = fileURLToPath(new URL('../apps/web/e2e/fixtures/puzzles.jsonl', import.meta.url));

const fail = (message) => {
  console.error(`e2e-api: ${message}`);
  process.exit(1);
};

const testURL = setting(readDotEnv(), 'TEST_DATABASE_URL');
if (testURL === undefined) {
  fail(
    'TEST_DATABASE_URL is not set: add it to .env (see .env.example). PostgreSQL must be running.',
  );
}
const schemaURL = new URL(testURL);
schemaURL.searchParams.set('search_path', 'e2e,public');

const today = Date.parse(new Date().toISOString().slice(0, 10));
const launch = new Date(today - PAST_DAYS * 86_400_000).toISOString().slice(0, 10);

const go = (args) => {
  const r = spawnSync('go', ['-C', 'services/api', ...args], { cwd: root, stdio: 'inherit' });
  if (r.error) fail(`could not run go (${r.error.message}). Install Go from https://go.dev/dl/.`);
  if (r.status !== 0) process.exit(r.status ?? 1);
};

go(['run', './cmd/e2e-setup', '--puzzles', puzzles, '--launch', launch, '--days', String(DAYS)]);

const binDir = mkdtempSync(join(tmpdir(), 'retrograde-e2e-'));
const bin = join(binDir, process.platform === 'win32' ? 'retrograde.exe' : 'retrograde');
go(['build', '-o', bin, './cmd/retrograde']);

const server = spawn(bin, ['serve'], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    DATABASE_URL: schemaURL.toString(),
    HOST: '127.0.0.1',
    PORT: String(E2E_API_PORT),
    BASE_URL: PREVIEW,
    LAUNCH_DATE: launch,
    COOKIE_SECURE: 'false',
    // The tests register many accounts a minute from one IP (DECISIONS 2026-10-29).
    RATE_LIMIT_SCALE: '1000',
    LOG_LEVEL: 'warn',
  },
});

let exited = false;
const cleanup = () => {
  if (!exited) server.kill();
  try {
    rmSync(binDir, { recursive: true, force: true });
  } catch {
    // Windows may still hold the binary for a moment; it's in the temp folder anyway.
  }
};
server.on('exit', (code) => {
  exited = true;
  cleanup();
  process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    cleanup();
    process.exit(0);
  });
}
process.on('exit', () => {
  if (!exited) server.kill();
});
console.log(
  `e2e-api: serving the e2e schema on http://127.0.0.1:${String(E2E_API_PORT)} (today is puzzle #${String(PAST_DAYS + 1)})`,
);
