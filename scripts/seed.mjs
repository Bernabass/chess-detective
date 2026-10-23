// `pnpm seed`: gets the local database ready to play.
//   1. Applies the migrations.
//   2. If LAUNCH_DATE isn't set, adds LAUNCH_DATE=<14 days ago> to .env (and says so), so there
//      are past puzzles for the archive.
//   3. Imports data/puzzles-v1.jsonl (idempotent).
//   4. Schedules every day from LAUNCH_DATE through 30 days from today (days already scheduled
//      are kept).
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { envPath, readDotEnv, root, setting } from './env.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS = 14;
const FUTURE_DAYS = 30;
const puzzles = fileURLToPath(new URL('../data/puzzles-v1.jsonl', import.meta.url));

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function retrograde(...args) {
  console.log(`\n> retrograde ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
  const result = spawnSync('go', ['-C', 'services/api', 'run', './cmd/retrograde', ...args], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(
      `seed: could not run go (${result.error.message}). Install Go from https://go.dev/dl/.`,
    );
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const dotEnv = readDotEnv();
if (dotEnv === null) {
  console.error('seed: there is no .env file. Copy .env.example to .env and fill in DATABASE_URL.');
  process.exit(1);
}

const todayMs = Date.parse(isoDay(Date.now())); // UTC midnight, like the API's days
let launch = setting(dotEnv, 'LAUNCH_DATE');
if (launch === undefined) {
  launch = isoDay(todayMs - PAST_DAYS * DAY_MS);
  const text = readFileSync(envPath, 'utf8');
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  appendFileSync(
    envPath,
    `${sep}\n# Added by pnpm seed: puzzle #1's day, ${PAST_DAYS} days before the first seed.\nLAUNCH_DATE=${launch}\n`,
  );
  console.log(
    `seed: LAUNCH_DATE wasn't set, so I added LAUNCH_DATE=${launch} (${PAST_DAYS} days ago) to .env.`,
  );
} else {
  console.log(`seed: using LAUNCH_DATE=${launch}.`);
}
const launchMs = Date.parse(launch);
if (!/^\d{4}-\d{2}-\d{2}$/.test(launch) || Number.isNaN(launchMs)) {
  console.error(`seed: LAUNCH_DATE must be a date like 2026-11-01, got "${launch}".`);
  process.exit(1);
}

retrograde('migrate');
retrograde('import-puzzles', puzzles);

const lastMs = todayMs + FUTURE_DAYS * DAY_MS;
const days = Math.round((lastMs - launchMs) / DAY_MS) + 1;
if (days < 1) {
  console.log(
    `\nseed: LAUNCH_DATE ${launch} is more than ${FUTURE_DAYS} days away, so nothing to schedule yet.`,
  );
} else {
  retrograde('schedule', '--from', launch, '--days', String(days));
  const today = Math.round((todayMs - launchMs) / DAY_MS) + 1;
  console.log(
    `\nseed: done. Scheduled ${launch} to ${isoDay(lastMs)}` +
      (today >= 1 ? `; today is puzzle #${today}.` : `; puzzle #1 is on ${launch}.`),
  );
}
