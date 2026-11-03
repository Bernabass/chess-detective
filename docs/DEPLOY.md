# Deploying Retrograde

Production is **https://retrograde-chess.vercel.app**, on free plans:

- **Vercel** (Hobby): the web app from its CDN and the Go API as a function, in one project and on one domain.
- **Neon** (Free): PostgreSQL.

Both run in Frankfurt. Nothing deploys by itself: GitHub Actions deploys only after every CI check has passed. A pull request gets a preview; `main` goes to production. How it fits together is in [ARCHITECTURE.md §11.5](ARCHITECTURE.md); this page is the step-by-step.

The same API also runs from the container image on any other host: see [Running the container elsewhere](#running-the-container-elsewhere).

## One-time setup

You need three accounts: GitHub (already there), Neon and Vercel. Neither Neon nor Vercel needs a card.

### 1. Neon: the database

1. Go to [neon.com](https://neon.com) → **Sign up** → **Continue with GitHub**.
2. **Create a project**:
   - **Project name:** `retrograde`.
   - **Postgres version:** 18 (or the newest offered; 17 also works).
   - **Cloud provider:** AWS.
   - **Region:** Europe Central 1 (Frankfurt).
3. Keep the free compute within budget. Open **Branches** → `main` → **Computes** → **Edit**, and set both minimum and maximum to **0.25 CU**. Scale to zero after 5 minutes stays on. The free plan's 100 compute-hours a month then go a long way: the database sleeps when nobody plays and wakes in well under a second.
4. Copy the production connection strings. On the project dashboard, click **Connect** (branch `main`, database `neondb`, role `neondb_owner`):
   - with **Connection pooling** on: the **pooled** string, whose host contains `-pooler`. This is Vercel's `DATABASE_URL` for production.
   - with it off: the **direct** string. This is GitHub's `DATABASE_URL_DIRECT` for production; migrations need a direct connection.
5. Create the preview database. Go to **Branches** → **New branch**: name `preview`, parent `main`. Do this before launch, while `main` holds no players: a branch starts as a copy of its parent's data. Click **Connect** again with branch `preview` and copy its pooled and direct strings too.

Use the strings as Neon gives them (`sslmode=require` and `channel_binding=require` are fine). Don't add `pool_*` parameters: the API's startup migration check would pass them to the server, which rejects them.

### 2. Vercel: the site and the API

1. Go to [vercel.com/signup](https://vercel.com/signup) → **Hobby** → **Continue with GitHub**.
2. **Add New…** → **Project** → **Import** next to `Bernabass/chess-detective`. If asked, install the Vercel GitHub app for this repository only.
3. On the import screen:
   - **Project Name:** `retrograde-chess`. This gives the address `retrograde-chess.vercel.app`.
   - **Framework Preset:** **Services**, which reads `vercel.json`. If it isn't offered, choose **Other**.
   - **Root Directory:** `./`.
   - Open **Environment Variables** and add the production values from step 6.
   - Click **Deploy**. This first deployment is the only one made from Vercel's side; after it, `vercel.json` turns Vercel's own Git deployments off. Its API refuses to start until the database is migrated (its log says so): that's expected until you've run the **Launch** steps below.
4. **Settings → Build and Deployment → Node.js Version:** 24.x.
5. **Settings → Functions → Function Region:** Frankfurt, Germany (fra1). Leave Fluid compute on.
6. **Settings → Environment Variables.** Don't set `PORT` (Vercel provides it) or `HOST` (on Vercel it defaults to `0.0.0.0`).

   | Name | Production | Preview |
   |---|---|---|
   | `DATABASE_URL` | Neon `main`, pooled | Neon `preview`, pooled |
   | `BASE_URL` | `https://retrograde-chess.vercel.app` | leave unset (each preview uses its own deployment address) |
   | `COOKIE_SECURE` | `true` | `true` |
   | `LAUNCH_DATE` | the launch day, e.g. `2026-11-10` | 14 days before you first load the preview data, so previews have an archive |
   | `CRON_SECRET` | a new random secret (below) | another random secret |
   | `CLIENT_IP_HEADER` | `X-Real-IP` | `X-Real-IP` |
   | `LOG_LEVEL` | `info` | `info` |

   To create a secret, run this in a terminal:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   Each value matters: the API refuses to start on Vercel with an unsafe or missing setting, and its log says which one.
7. **Settings → Deployment Protection:**
   - Leave **Vercel Authentication** on for previews (Standard Protection), so only you can open them.
   - Under **Protection Bypass for Automation**, click **Add** and copy the secret. GitHub uses it to smoke-test previews.
8. **Account → Settings → Tokens:** create a token named `github-actions`, scoped to your Hobby team, expiring in a year. Copy it.
9. Copy two IDs:
   - **Settings → General → Project ID** of the project;
   - **Settings → General → Team ID** of your Hobby team (the team, not the project).
10. Optional, if your plan shows it: **Firewall → Configure → New Rule**. Name it "Sign-in rate limit": if **Request Path** starts with `/api/auth/`, then **Rate Limit**, fixed window, 60 seconds, 30 requests, keyed by IP. Then **Save** and **Publish**. Unlike the API's own limits, the firewall's apply across all instances ([ARCHITECTURE.md §10.6](ARCHITECTURE.md)).

### 3. GitHub: secrets and environments

In the repository, open **Settings**.

1. **Secrets and variables → Actions → Repository secrets:** `VERCEL_TOKEN` (step 2.8), `VERCEL_ORG_ID` (the Team ID), `VERCEL_PROJECT_ID` (the Project ID).
2. **Environments → New environment → `production`:**
   - **Deployment branches and tags:** Selected branches → add `main`.
   - **Environment secret:** `DATABASE_URL_DIRECT` = Neon `main`, direct.
   - **Environment variable:** `LAUNCH_DATE` = the same launch day as on Vercel.
3. **Environments → New environment → `preview`:**
   - **Environment secrets:** `DATABASE_URL_DIRECT` = Neon `preview`, direct; `VERCEL_AUTOMATION_BYPASS_SECRET` (step 2.7).
   - **Environment variable:** `LAUNCH_DATE` = the preview's launch day, as on Vercel.
4. Last, **Secrets and variables → Actions → Repository variables:** `PRODUCTION_URL` = `https://retrograde-chess.vercel.app`. The deploy jobs are skipped until this variable exists, so CI stays green while the setup is unfinished.

## Launch

1. **Load the puzzles.** Go to **Actions → Puzzle data → Run workflow**, choose target **production** and 365 days, and run it. Then run it again with target **preview**. Each run applies the migrations, imports the 500 puzzles and schedules a year of dailies from that environment's `LAUNCH_DATE`. It's idempotent, so running it twice changes nothing.
2. **Deploy.** Go to **Actions → CI → Run workflow** on `main`, or push to `main`. After the checks, **Deploy to production** applies migrations, deploys, and smoke-tests the live site. It checks the page headers, a client route, `/api/health`, real database queries through Neon's pooler, and that the cleanup endpoint refuses a request without the secret.
3. **Check it** in a browser: open the daily, play a guess, sign in with Lichess. Lichess needs no registration; the consent page names the app by its address.
4. **The daily cleanup** appears under the project's **Settings → Cron Jobs** once production is deployed. It runs at 03:00 UTC (Hobby crons run once a day, at some point in the hour), and **Run** triggers it by hand.

## Everyday

- **A pull request** from this repository gets a preview after CI passes: **View deployment** on the pull request opens it. Previews use the Neon `preview` branch. Pull requests from forks get no preview, because they can't see the secrets.
- **Merging to `main`** deploys to production after CI passes.
- **Migrations** run before the new version is deployed, while the old one still serves traffic. So a migration must keep the previous version working: add tables and columns, and remove things only in a later release.
- **Rolling back:** in Vercel, **Deployments** → the previous production deployment → **Instant Rollback**. Database migrations don't roll back; they are forward-only.
- **Logs:** Vercel → the project → **Logs**. Hobby keeps an hour. The application never logs IP addresses.
- **Running low on puzzles:** the cleanup job and the server's startup log a warning when fewer than 30 days remain scheduled. A year from launch uses about 365 of the 500 puzzles. Generate more with the generator, add them to `data/`, then rerun **Puzzle data** with more days: days already scheduled are kept.

**What the free plans include,** monthly:
- **Vercel Hobby:** 1,000,000 function invocations, 4 CPU-hours, 100 GB transfer, one cron a day per job. Hobby is for personal, non-commercial projects.
- **Neon Free:** 1 GB of storage and 100 compute-hours per project.

If a limit runs out, that service pauses until the next month.

## Running the container elsewhere

The `Dockerfile` builds one image with the API and the web app, for any container host:

```sh
docker build -t retrograde .
# release step: apply migrations
docker run --rm -e DATABASE_URL=... retrograde migrate
# once: load the puzzles and schedule a year
docker run --rm -e DATABASE_URL=... retrograde import-puzzles /data/puzzles-v1.jsonl
docker run --rm -e DATABASE_URL=... -e LAUNCH_DATE=2026-11-10 retrograde schedule --from 2026-11-10 --days 365
# serve on port 8080
docker run -d -p 8080:8080 \
  -e APP_ENV=production -e DATABASE_URL=... -e BASE_URL=https://your.domain \
  -e COOKIE_SECURE=true -e LAUNCH_DATE=2026-11-10 \
  retrograde
```

- Put it behind a TLS-terminating proxy, and set `TRUSTED_PROXIES` to that proxy's address so rate limits see the real client IP.
- Without Vercel's cron, the server runs the cleanup job itself every hour.
- On Vercel, the same image can replace the Go runtime if ever needed: set the `api` service in `vercel.json` to the container runtime with this Dockerfile.

To try the production build without Docker, run `pnpm build`, then `pnpm start` ([RUNNING.md](RUNNING.md)).
