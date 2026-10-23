// `pnpm try:api`: walks through the API without a UI, printing every request and response.
// It builds and starts its own API server on port 8091 (your `pnpm dev` can keep running), then
// plays today's puzzle as a new guest: a wrong guess, a hint, the solution, registering, and the
// leaderboards. Run `pnpm seed` first so there is a puzzle today. Each run registers a new
// try_<time> account in the development database, so they show up on the local leaderboards.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './env.mjs';

const PORT = 8091;
const BASE = `http://127.0.0.1:${PORT}`;
const puzzlesFile = fileURLToPath(new URL('../data/puzzles-v1.jsonl', import.meta.url));

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const red = paint('31');

// --- Start a server of our own -------------------------------------------------------------

const binDir = mkdtempSync(join(tmpdir(), 'retrograde-try-'));
const bin = join(binDir, process.platform === 'win32' ? 'retrograde.exe' : 'retrograde');
console.log(dim('Building the API…'));
const build = spawnSync('go', ['-C', 'services/api', 'build', '-o', bin, './cmd/retrograde'], {
  cwd: root,
  stdio: 'inherit',
});
if (build.error || build.status !== 0) {
  console.error(
    build.error
      ? `try:api: could not run go (${build.error.message}). Install Go from https://go.dev/dl/.`
      : 'try:api: the API did not build.',
  );
  process.exit(1);
}

// Another server (an earlier run that didn't exit?) on the port would answer our requests.
try {
  await fetch(`${BASE}/api/health`);
  console.error(
    red(`try:api: port ${PORT} is already in use. Stop whatever is listening on it and try again.`),
  );
  rmSync(binDir, { recursive: true, force: true });
  process.exit(1);
} catch {
  // Nothing there: good.
}

// Real environment variables beat .env, so these override it for this server only. BASE_URL is
// this server, because POSTs must come from the BASE_URL origin.
const server = spawn(bin, ['serve'], {
  cwd: root,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT), BASE_URL: BASE, LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
let serverExited = false;
const serverExit = new Promise((resolve) => {
  server.on('exit', () => {
    serverExited = true;
    resolve();
  });
});

/** Stops the server, waits for it to exit (Windows keeps a running .exe locked), cleans up and exits. */
async function stop(code) {
  if (!serverExited) server.kill();
  await Promise.race([serverExit, new Promise((r) => setTimeout(r, 3000))]);
  try {
    rmSync(binDir, { recursive: true, force: true });
  } catch {
    // Still locked: it's in the temp folder anyway.
  }
  process.exit(code);
}
process.on('SIGINT', () => void stop(130));
// Whatever goes wrong, never leave the server running: Windows doesn't stop a child with its parent.
process.on('uncaughtException', (err) => {
  console.error(
    red(`
try:api: ${err?.stack ?? err}`),
  );
  void stop(1);
});
process.on('unhandledRejection', (err) => {
  console.error(
    red(`
try:api: ${err?.stack ?? err}`),
  );
  void stop(1);
});
process.on('exit', () => {
  if (!serverExited) server.kill();
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (serverExited) return false;
    try {
      await fetch(`${BASE}/api/health`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return false;
}

// --- A tiny HTTP client with a cookie jar ----------------------------------------------------

let session = ''; // the rg_session cookie
let failures = 0;
let step = 0;

/** Sends a request like the web app does and prints it. `expect` is the expected status. */
async function call(title, method, path, { body, expect = 200 } = {}) {
  step++;
  console.log(`\n${bold(`${step}. ${title}`)}`);
  const headers = {};
  if (session) headers.Cookie = `rg_session=${session}`;
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers.Origin = BASE;
  }
  const shown = body && 'password' in body ? { ...body, password: '********' } : body;
  console.log(dim(`→ ${method} ${path}${shown ? ` ${JSON.stringify(shown)}` : ''}`));
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) {
    const m = /^rg_session=([^;]*)/.exec(c);
    if (!m) continue;
    session = m[1];
    // Never print the token itself: it's a password for this session.
    console.log(dim(`  Set-Cookie: rg_session=… (${m[1] ? 'new session' : 'cleared'})`));
  }
  const text = await res.text();
  const ok = res.status === expect;
  if (!ok) failures++;
  const status = `← ${res.status} ${res.statusText}`;
  console.log(ok ? green(status) : red(`${status} (expected ${expect})`));
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.log(text);
    }
  }
  return data;
}

/** A legal game of n plies that's almost surely wrong: knights out and back. */
function knightShuffle(n) {
  const cycle = ['b1a3', 'b8a6', 'a3b1', 'a6b8'];
  const out = [];
  while (out.length < (n % 2 === 0 ? n : n - 1)) out.push(cycle[out.length % 4]);
  if (out.length < n) out.push('h2h3');
  return out;
}

function solutionFor(target, plies) {
  for (const line of readFileSync(puzzlesFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const p = JSON.parse(line);
    if (p.target === target && p.plies === plies) return p.solution;
  }
  return null;
}

// --- The walkthrough -------------------------------------------------------------------------

if (!(await waitForServer())) {
  console.error(red('\ntry:api: the API server did not start (see its error above).'));
  await stop(1);
}

const health = await call('Is the API up?', 'GET', '/api/health');
if (health?.db !== 'ok') {
  console.error(
    red(
      '\nThe database is not reachable: check DATABASE_URL in .env and that PostgreSQL is running.',
    ),
  );
  await stop(1);
}

const today = await call("A guest gets today's puzzle (this creates nothing)", 'GET', '/api/daily');
if (!today?.target) {
  console.error(red('\nThere is no puzzle today. Run `pnpm seed` first.'));
  await stop(1);
}
const { number, plies, target } = today;
const solution = solutionFor(target, plies);
if (!solution) {
  console.error(red(`\nPuzzle #${number} isn't in data/puzzles-v1.jsonl, so I can't solve it.`));
  await stop(1);
}

await call(
  'The web app starts the puzzle: a guest session and an attempt',
  'POST',
  `/api/daily/${number}/start`,
  {
    body: {},
  },
);

const illegal = [...solution];
illegal[0] = 'e2e5';
await call(
  'An illegal move is rejected (422, with the ply) and costs no guess',
  'POST',
  `/api/daily/${number}/guesses`,
  {
    body: { moves: illegal },
    expect: 422,
  },
);

const wrong = await call(
  'A wrong guess: per-ply feedback, G/Y/X',
  'POST',
  `/api/daily/${number}/guesses`,
  {
    body: { moves: knightShuffle(plies) },
  },
);
if (wrong?.feedback) {
  console.log(
    dim(
      `  G = right move, right ply · Y = right move, another ply of that colour · X = not in the solution`,
    ),
  );
}

await call(
  'A hint (the first of three: which pieces moved)',
  'POST',
  `/api/daily/${number}/hints`,
  { body: {} },
);

const solved = await call(
  'The solving guess: the solution is revealed now that it is solved',
  'POST',
  `/api/daily/${number}/guesses`,
  {
    body: { moves: solution },
  },
);
if (solved && solved.status !== 'solved') {
  failures++;
  console.log(red(`  expected status "solved", got "${solved.status}"`));
}

const username = `try_${Date.now().toString(36)}`;
await call(
  `Register as ${username}: the guest's solve moves to the account`,
  'POST',
  '/api/auth/register',
  {
    body: { username, password: randomBytes(12).toString('base64url') },
    expect: 201,
  },
);

await call('Who am I?', 'GET', '/api/auth/me');
await call(
  `Today's leaderboard (you're under "you")`,
  'GET',
  `/api/leaderboards/daily/${number}?limit=10`,
);
await call(
  'All-time leaderboard by puzzles solved',
  'GET',
  '/api/leaderboards/all-time?metric=solved',
);

console.log(
  `\n${bold('Calling the API by hand')} (start it with ${bold('pnpm dev')}; it listens on http://127.0.0.1:8080):\n` +
    `  In Windows PowerShell 5.1, "curl" is Invoke-WebRequest. Use curl.exe or Invoke-RestMethod:\n` +
    `    curl.exe http://127.0.0.1:8080/api/daily\n` +
    `    Invoke-RestMethod http://127.0.0.1:8080/api/daily | ConvertTo-Json -Depth 5\n` +
    `  POSTs need the headers the web app sends (Content-Type: application/json and Origin: BASE_URL):\n` +
    `    curl.exe -c jar.txt -b jar.txt -X POST -H "Content-Type: application/json" -H "Origin: http://localhost:5173" -d "{}" http://127.0.0.1:8080/api/daily/1/start`,
);

if (failures > 0) {
  console.log(red(`\n${failures} step(s) didn't return what was expected.`));
  await stop(1);
}
console.log(green('\nAll steps returned what was expected.'));
await stop(0);
