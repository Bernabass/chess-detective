// `node scripts/smoke.mjs <url>`: checks a running deployment from the outside: the web app with
// its security headers and client routes, the API and its database (through whatever pooler
// sits in front of it), and that the cleanup endpoint refuses a request without the cron secret.
// Used by CI for the container image and after every Vercel deployment. A preview behind
// Vercel's login is reached with VERCEL_AUTOMATION_BYPASS_SECRET.
const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node scripts/smoke.mjs <url>');
  process.exit(2);
}
const headers = {};
if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
}

let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  failed ||= !ok;
};
const get = (path, extra = {}) =>
  fetch(base + path, { headers: { ...headers, ...extra }, redirect: 'manual' });

// The API may be starting cold (and the database waking up), so the first check waits.
let health;
for (let attempt = 1; attempt <= 30; attempt++) {
  try {
    const r = await get('/api/health');
    health = { status: r.status, body: await r.json() };
    if (r.status === 200) break;
  } catch (e) {
    health = { error: String(e) };
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
check(health?.status === 200 && health.body?.db === 'ok', `/api/health: ${JSON.stringify(health)}`);

const home = await get('/');
const csp = home.headers.get('content-security-policy') ?? '';
check(
  home.status === 200 && (home.headers.get('content-type') ?? '').includes('text/html'),
  `/ is the web app (${String(home.status)})`,
);
check(
  csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"),
  `/ sends the CSP: ${csp}`,
);
check(home.headers.get('x-content-type-options') === 'nosniff', '/ sends X-Content-Type-Options');

const route = await get('/daily/1');
check(
  route.status === 200 && (route.headers.get('content-type') ?? '').includes('text/html'),
  `/daily/1 falls back to the app (${String(route.status)})`,
);

// Real queries through the database connection (prepared statements included): today's puzzle,
// or a 404 problem before any is scheduled.
const daily = await get('/api/daily');
check(
  [200, 404].includes(daily.status) && (daily.headers.get('content-type') ?? '').includes('json'),
  `/api/daily answers from the database (${String(daily.status)})`,
);

const cleanup = await get('/api/internal/cleanup');
check(
  cleanup.status === 401,
  `/api/internal/cleanup without the secret is refused (${String(cleanup.status)})`,
);

if (failed) {
  console.error(`smoke: ${base} failed`);
  process.exit(1);
}
console.log(`smoke: ${base} is healthy`);
