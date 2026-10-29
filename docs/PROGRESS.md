# Progress

Claude Code updates this file at the end of every phase. Newest phase at the top.

## Status

| Phase | Name | Status | Tag |
|---|---|---|---|
| 0 | Foundations | done (2026-10-22) | `phase-0` |
| 1 | Engine core | done (2026-10-22) | `phase-1` |
| 2 | Retro analysis | done (2026-10-22) | `phase-2` |
| 3 | Proof-game solver | done (2026-10-22) | `phase-3` |
| 4 | Puzzle generator | done (2026-10-23) | `phase-4` |
| 5 | Web shell and Lab | done (2026-10-23) | `phase-5` |
| 6 | API core | done (2026-10-23) | `phase-6` |
| 7 | Daily UI, leaderboards, profiles, archive | done (2026-10-29) | `phase-7` |
| 8 | Sign in with Lichess | not started | |
| 9 | Polish and ship | not started | |

## Measurements

| Metric | Value | Date |
|---|---|---|
| Perft nodes/second (Node, start position depth 5) | ≈4.0M nodes/s (median of 3 runs: 3.4M, 4.0M, 4.2M); Kiwipete depth 4: 5.4M. Node 24.13, owner's Windows 10 machine, `pnpm --filter @retrograde/engine perft 5` | 2026-10-22 |
| Solver median / p95 at N = 6, 8, 10 | find-one: 2 / 6 ms, 2 / 11 ms, 4 / 191 ms. count (cap 2): 2 / 5 ms, 2 / 33 ms, 2 / 167 ms (worst 436 ms). Median nodes 7–14. 50 targets of uniformly random games per N, `pnpm --filter @retrograde/engine bench` | 2026-10-22 |
| Generator acceptance rate and time per candidate by N | Beam (W = 180, 200,000-node limit, `--jobs 4`), accepted / candidates and mean ms per candidate per job: N = 6: 68% / 20 ms, 7: 79% / 123 ms, 8: 58% / 282 ms, 9: 59% / 1.2 s, 10: 35% / 2.6 s, 11: 28% / 3.9 s, 12: 14% / 4.1 s. Whole 500-puzzle pool: 72 min; `verify` of the pool: 227 s. Heavy 8-ply uniqueness count (118,811 nodes): 2,328 ms with engine 0.3.0 → 1,250 ms with the incremental bound | 2026-10-23 |
| Main-thread JS bundle (gzipped) | Main `index` 118.96 KB; `/daily` adds DailyPage 8.29 KB plus the shared board chunk (16.96 KB); `/lab` about 144 KB of JS in total; CSS 11.90 KB; engine worker separate, 16.5 KB gzip. `pnpm --filter @retrograde/web build` | 2026-10-29 |
| Lighthouse accessibility, /daily and /lab | | |

## Phase log

### Phase 7: Daily UI, leaderboards, profiles, archive (2026-10-29)

**Before the phase:** your Phase 6 check is done. A skipped day already ended the streak everywhere; `TestSkippedDayEndsTheStreak` now proves it for `/auth/me`, profiles and the all-time board, up to the midnight boundary (commit `8873703`).

**Done, by acceptance criterion**
- **Daily play end to end** (`/daily`, `/daily/:number`):
  - board input with only legal moves, a promotion picker, and typed SAN or UCI as the keyboard alternative;
  - ply counter, SAN move list, Undo and Reset;
  - difference overlay;
  - Submit enabled only at exactly N plies, and only once the attempt has started;
  - feedback rows with colour, icon (✓ ↔ ✕) and words per ply, plus an `aria-live` announcement;
  - the three hints;
  - won and lost screens with solution playback (`ProofPlayer`).
  - Tests: `DailyPage.test.tsx` (11 tests) and `moves.test.ts`; e2e `daily.spec.ts` (a guest solves the seeded daily with a drag and typed moves; six wrong guesses on an archive puzzle; the promotion picker; keyboard-only play; an unreleased puzzle).
- **Share card exactly per §8.6:** `share.test.ts` checks the spec's example string exactly, `X/6`, no 🔍 without hints, and the practice variant. The e2e test reads the real clipboard after Copy.
- **Register/login pages; header shows guest vs user; guest progress survives signing up.**
  - Real forms, with server errors (taken name, wrong password, 429 with the wait).
  - `?next=` accepts paths on this site only.
  - The header shows the username and Sign out; on phones, a user icon plus the menu.
  - Tests: `pages.test.tsx`; e2e `accounts.spec.ts` › "a guest who solves and then registers keeps the result, and the leaderboard shows them".
- **Leaderboards, profile with guess distribution, archive list and archive play.**
  - Daily board (any puzzle, you marked "You", your rank shown even outside the top 100) and all-time boards (current streak, best streak, solved).
  - Profile with stat tiles and a guess-distribution chart (single hue, validated with the dataviz checks, plus a table for screen readers).
  - Archive with your results, pages of 30, and "Today".
  - Tests: `pages.test.tsx`; e2e `boards.spec.ts`.
- **Playwright journeys from the spec:** guest solves the seeded daily (`daily.spec.ts`); a user registers, keeps the result and the leaderboard shows them (`accounts.spec.ts`).
- **Your additions:**
  1. **How to play:** opens on the first visit, reopens from a button, and is a native `<dialog>` (focus trap, Escape). The example is 1.e4 e5 2.Ke2 Ke7 with the guess 1.Nf3 e5 2.e4 Ke7 shown as ✕ ✓ ↔ ✓. `howto.test.ts` proves with the solver that it's a unique shortest proof game, and checks its feedback with the reference implementation, now in the engine as `dailyFeedback`.
  2. **Countdown** to the next UTC midnight, shown in local time ("Next puzzle in 4:12:09 (at 03:00 your time)"). It counts from the finished puzzle's own day, so a puzzle finished after midnight says at once that the next one is out. Tests: `nextPuzzle.test.ts` (Tokyo, New York, year end) and `DailyPage.test.tsx`.
  3. **Screenshot review** (below).
  - Also from your approval: `RATE_LIMIT_SCALE` logs a warning at startup when it isn't 1 (`TestStartupWarnsAboutScaledRateLimits`), and leaderboard times show h:mm:ss past an hour (`format.test.ts`, `pages.test.tsx`).

**How e2e works now:** Playwright starts `scripts/e2e-api.mjs`. It resets an `e2e` schema in your test database (refusing any database not named `*_test`), loads 10 fixture puzzles so today is #4, and serves the API on port 8092 for `vite preview`. So `pnpm test:e2e` needs PostgreSQL running, like `pnpm test:api`.

**Visual review** (`pnpm --filter @retrograde/web shots`: 21 states × 360 and 1280 px × light and dark = 84 images, all looked at)
- **Round 1 found 13 problems:**
  - the game's columns were centred, out of line with the title;
  - the difference overlay was hard to see in dark mode;
  - "…" split from its move in guess rows;
  - "9 plies" broke across lines;
  - the move field's placeholder was cut off at 360 px;
  - "what happened.." had two full stops;
  - leaderboard rows didn't reach the card edges (padding override lost);
  - the archive didn't mark today;
  - the metric buttons wrapped 2 + 1 at 360 px;
  - signed-in players saw no sign of it in the phone header;
  - the screenshot run couldn't show the "Copied" state (no clipboard permission) or sign in at 360 px.
- **Round 2 found 1:** the share preview's first line was cut off at 360 px (it now wraps).
- **Round 3:** nothing left to fix.
- Also found by the 360 px checks: the leaderboard and a 20-character username widened the page. Now covered by `routes.spec.ts`.
- Final images: `docs/screenshots/daily-*.png`, `leaderboard-1280-light.png`, `profile-360-dark.png`, `archive-1280-dark.png`.

**Evidence**
- `pnpm check`: green in 77–89 s.
  - Engine 269 + 34, generator 37, web 88; golangci-lint `0 issues`; Go tests ok; hook test passed.
  - The web suite moved to Vitest's `vmThreads` pool, 31 s → 14 s; without that, `pnpm check` was 146 s.
- `pnpm test:api`: all 9 Go packages ok, including the new `cmd/e2e-setup`.
- `pnpm test:e2e`: 63 passed (2.1 min).
- Bundle (`vite build`):
  - main `index` 118.96 KB gzip (+2.3 KB);
  - DailyPage 8.29 KB, Leaderboard 2.20 KB, Profile 1.47 KB, Archive 1.46 KB, Auth 1.32 KB gzip;
  - the board chunk is shared with the Lab.
- **Self-review** (separate review agent, read-only; reran `pnpm check` and `pnpm test:api`). Fixed, from its findings:
  1. The countdown counted from the clock, not the puzzle's day: a daily finished after midnight showed a full day to wait. Fixed, with tests.
  2. If re-reading the puzzle failed after a guess or hint was recorded, the page said it failed, so a retry could spend another guess or hint. Fixed; a test fails without the fix.
  3. Playwright could reuse a stale preview server (or one proxying to the dev database). It never reuses one now.
  4. A failed start (network, 429) couldn't be retried without reloading. There's a Try again button, with a test.
  5. Focus:
     - the promotion picker keeps Tab inside, Escape works anywhere, and focus returns to the move field;
     - when the last guess ends the game, focus moves to the result heading (test).
  6. The difficulty stars' `aria-label` needed `role="img"` to be read.
  7. `e2e-setup` checked the URL's database name, but pgx also honours `?dbname=`. It now checks `current_database()`, with an integration test.
  8. e2e tests hardcoded today as #4. They now read it from the API, so a run that crosses midnight UTC passes.
  - Also:
    - no guest-prompt flash for signed-in players;
    - the puzzle isn't refetched on window focus (it would swap the board for the new day's);
    - typed `0-0` and `e8=q` are pinned by tests.
- Also fixed during the phase:
  - a race where a fast Submit could precede the start (found by e2e; test fails without the fix);
  - 4xx responses are no longer retried by the query client, so "not released" shows at once;
  - the play board fits a 720 px-tall screen;
  - API problem `detail`s are now UI sentences.
- **CI caught a racy unit test** after the phase commits (`8ccee2f`).
  - `pages.test.tsx` › "shows the user in the header, and signs out" failed on both CI jobs: `expected '/about' to be '/'`.
  - Signing out first refreshes the header's data (`/auth/me`), then redirects home. The test checked the URL as soon as the header said "Sign in", and on CI's faster machines that came before the redirect. Locally it always passed.
  - The app was right; the test now waits for the redirect (`4a6185d`, "test(web): wait for the redirect after signing out"). It passed 3 runs in a row locally, then CI passed on both jobs. `phase-7` is tagged on that commit.

**Known issues / follow-ups**
- Sign in with Lichess stays disabled ("coming soon") until Phase 8.
- Lighthouse scores are for Phase 9; axe scans cover daily (How to play, in progress, won), leaderboard, all-time, profile, archive, login and register in both themes.
- The share link uses the page's origin; in production that's `BASE_URL`.

**How to try it** (VS Code terminal, PowerShell, in the project folder; PostgreSQL running)

1. If you haven't since Phase 6, load the puzzles: `pnpm seed`.
2. Start everything:
   ```powershell
   pnpm dev
   ```
   Open http://localhost:5173/daily.
3. **First visit:** How to play opens. Read the example (✕ ✓ ↔ ✓) and press **Start playing**.
4. **Play a guess:**
   - drag pieces, or type moves in the field (e4, Nf3, O-O);
   - tick **Show differences from the target** to see which squares still differ;
   - when the counter reads N / N, press **Submit guess**.

   A row of squares appears, each with ✓, ↔ or ✕. Tap the row to load that guess back onto the board.
5. Take a hint, then keep going until you solve it, or use all six guesses. You'll see:
   - Case closed or unsolved, with the solution to step through;
   - your share card (**Copy result**);
   - "Next puzzle in h:mm:ss (at HH:MM your time)".
6. As a guest, press **Create an account** on the result. After registering you're back on the daily with the same result, your name in the header, and a 1-day streak.
7. Look around:
   - **Leaderboard**: you're marked "You";
   - **All time**;
   - your profile (click your name): guess distribution;
   - **Archive**: play an earlier day as practice.
8. Tests:
   ```powershell
   pnpm check
   pnpm test:api
   pnpm test:e2e                                   # needs PostgreSQL; about 2 minutes
   pnpm --filter @retrograde/web shots             # optional: 84 screenshots into apps/web/screenshots/
   ```

### Phase 6: API core (2026-10-23)

**Done, by acceptance criterion**
- **Go replay matches `fixtures/replay-vectors.json`** (built first, as you asked).
  - `internal/chessrules` wraps `corentings/chess/v2` v2.6.0 (MIT, GPL-compatible).
  - It agrees with the engine on all 652 vectors: 520 legal games (final position and the SAN of every move) and 132 illegal ones (rejected at the right ply). No disagreement was found.
  - Test: `TestReplayMatchesEngineVectors`.
- **Migrations for §10.3; `import-puzzles` (idempotent) and `schedule`.**
  - `00002_schema.sql` adds the full data model, plus `hint_move_ply`, `hints_total` and indexes (DECISIONS).
  - `import-puzzles` replays every solution and is all or nothing.
  - `schedule` follows the weekly ramp, is all or nothing, rejects days before `LAUNCH_DATE`, and always prints the pool left.
  - Tests: `TestImportIsIdempotent`, `TestImportRejectsABadSolutionAtomically`, `TestSchedule`, `TestQueriesUseIndexes` (`EXPLAIN` with sequential scans off).
- **Every §10.4 endpoint except Lichess, matching `openapi.yaml`.**
  - The Go strict server and the TypeScript types are generated from the contract, and every request is validated against it (kin-openapi).
  - `GET`s create nothing (your change 2); `POST /daily/{n}/start` is idempotent.
  - Tests: `TestGetCreatesNothing`, `TestStart`, plus one or more integration tests for every endpoint.
- **Guests, register, login, logout, guest merge, session rotation.**
  - Passwords: argon2id. Session cookie: HttpOnly, SameSite=Lax. Only the sha256 of each token is stored, and the expiry slides.
  - Requests are CSRF-checked (Origin and JSON content type).
  - Tests: `TestRegisterMergesGuestAndRotates`, `TestLoginLogout`, `TestLoginKeepsTheAccountsOwnAttempt`, `TestCSRF`, `TestSlidingExpiry`, `TestCookieMaxAgeUsesTheClock`, `TestSecurityHeaders`.
- **Guess submission per §10.5 with feedback vectors; hints; streaks and stats; daily and all-time leaderboards.**
  - Tests: `TestFeedbackMatchesTheVectors` (14 vectors from the TS reference), `TestGuessFlow`, `TestTranspositionSolves`, `TestSixWrongGuessesFail`, `TestHints` (hint 3 stays stable), `TestStreaksAndAllTime` (crosses midnight with the fake clock), `TestFailureEndsTheStreak`, `TestArchiveAttemptsCountInNoStats`, `TestDailyLeaderboard` (ties and the caller's rank; guests excluded), `TestProfile`, `TestArchive`.
- **Integration tests for every endpoint, including the no-solution-leak test and concurrent guess submission.**
  - `TestNoSolutionLeak` scans every response before the end of the attempt.
  - `TestConcurrentSixthGuess`: one 200, one 409, six guesses stored.
  - `TestConcurrentHints`: hints 1 and 2, never 1 twice.
  - Also `TestRateLimits`, `TestRateLimitPerUsername`, `TestBodyLimit`, `TestCleanup` and `TestClientIP`.
  - Each test runs in a fresh schema of `retrograde_test`, dropped afterwards (0 left over, checked).
- **`pnpm seed` imports the puzzles and schedules them for local dev** (your change 1).
  - If `LAUNCH_DATE` is missing, it adds `LAUNCH_DATE=<14 days ago>` to `.env` and says so.
  - Then it schedules from `LAUNCH_DATE` through 30 days ahead. Running it again changes nothing.
- **Your additions:**
  - `pnpm try:api` walks through the daily flow without a UI.
  - The cleanup (expired sessions; guests older than 30 days with no guesses) runs at startup and then hourly in `serve`, and on demand as `retrograde cleanup`.

**Evidence**
- `pnpm check`: green in 79 s.
  - Engine 267 + 34 tests, generator 37, web 42.
  - golangci-lint `0 issues`; Go unit tests ok; hook test passed.
- `pnpm test:api`: all 8 Go packages ok (63 top-level tests), 18 s.
- `pnpm seed` (first run, on your machine):
  ```
  seed: LAUNCH_DATE wasn't set, so I added LAUNCH_DATE=2026-10-09 (14 days ago) to .env.
  imported 500 puzzles (0 already present)
  scheduled 45 days (0 already scheduled) from 2026-10-09; LAUNCH_DATE 2026-10-09 is puzzle #1
  unscheduled puzzles left: ★ 65 · ★★ 131 · ★★★ 130 · ★★★★ 65 · ★★★★★ 64
  seed: done. Scheduled 2026-10-09 to 2026-11-22; today is puzzle #15.
  ```
  The second run printed `imported 0 puzzles (500 already present)` and `scheduled 0 days (45 already scheduled)`.
- `pnpm try:api`: all 11 steps returned the expected status ("All steps returned what was expected."). No temp folder or `retrograde.exe` was left behind.
- **Self-review** (separate review agent: read-only, reran the checks). Fixed, from its findings:
  1. The cookie's `Max-Age` used the wall clock instead of the injected clock. The integration tests would have started failing in December 2026. Now uses the clock, with `TestCookieMaxAgeUsesTheClock`.
  2. A failed daily didn't end the current streak until the next day. It now ends at once; there's a unit test and `TestFailureEndsTheStreak`.
  3. Client-IP handling behind trusted proxies was untested. `TestClientIP` covers a spoofed `X-Forwarded-For`, multi-hop chains, malformed hops and IPv4-mapped addresses.
  4. The per-username login limit was untested. `TestRateLimitPerUsername` is case-insensitive.
  5. `try:api` could leave its server running after an unexpected error (Windows doesn't stop a child with its parent), and it left its temp binary behind. It now always stops the server, waits for it, and refuses to start if port 8091 is busy.
  6. DECISIONS now lists every new Go module.
  - Also:
    - `BASE_URL` with a default port (`:443`) no longer rejects every POST;
    - `scripts/env.mjs` parses `.env` exactly like Go (BOM, `export`, inline comments);
    - `daily.Ramp` is a function instead of a mutable map;
    - dead code was removed;
    - `TestConcurrentHints` and `TestBodyLimit` were added.
- **CI caught a race that local runs hid.**
  - On CI's brand-new database, parallel test schemas all ran the migration's `CREATE EXTENSION IF NOT EXISTS citext` at once, and two failed with a duplicate-key error. Locally the extension already existed.
  - `dbtest` now creates citext first, under a Postgres advisory lock.
  - Reproduced locally on a fresh throwaway database with 8 schemas migrating at once: failed in 5 of 5 runs before the fix, 0 of 5 after.
  - Production is unaffected (it runs one migration at a time).
- Also fixed during the phase:
  - Timestamps came back in this machine's time zone (`+03:00`). The store now scans `timestamptz` as UTC.
  - The 422 `ply` is 1-based, like the hint plies.

**Decisions to confirm** (in DECISIONS 2026-10-23; both confirmed by the owner on 2026-10-29)
- Archive (practice) attempts count in **no** stats: not in played, solved or the distribution either, not just streaks and leaderboards as SPEC §1 / §8.7 say.
- A failed daily ends the current streak immediately (Wordle-style).

**Known issues / follow-ups**
- Lichess sign-in is Phase 8 (`oauth_states` and its cleanup already exist).
- The web app doesn't call the API yet (Phase 7). It must call `POST /daily/{n}/start` before the first guess.
- `pnpm check` is 79–93 s depending on caches, around the 90 s target.

**How to try it** (VS Code terminal, PowerShell, in the project folder; PostgreSQL running)

1. Load the puzzles (safe to repeat):
   ```powershell
   pnpm seed
   ```
   You should see `imported … puzzles`, `scheduled … days`, the pool left per difficulty, and `today is puzzle #N`. The first time, it also says it added `LAUNCH_DATE` to `.env`.
2. Walk through the API:
   ```powershell
   pnpm try:api
   ```
   It builds and starts its own API on port 8091 (your `pnpm dev` can keep running) and prints 11 numbered steps, each with its request and the JSON response:
   - a guest gets the puzzle (`GET /api/daily`: no `solution` field);
   - `start` sets a session cookie (shown as `rg_session=…`, never the token);
   - an illegal move gets a 422 with `"ply": 1`;
   - a wrong guess gets feedback like `"XXXXXXXX"`;
   - the first hint says which pieces moved;
   - the solving guess gets `"GGGGGGGG"`, `"status": "solved"` and the solution;
   - registering as `try_…` gets a 201 with `"solved": 1, "currentStreak": 1`;
   - `/auth/me`, then the daily leaderboard (you're under `"you"`) and the all-time leaderboard.

   It ends with "All steps returned what was expected." Each run adds a `try_…` account to your development database.
3. Call it by hand (in PowerShell 5.1 `curl` is `Invoke-WebRequest`, so use `curl.exe` or `Invoke-RestMethod`):
   ```powershell
   pnpm dev                                   # in one terminal (API on 8080, web on 5173)
   Invoke-RestMethod http://127.0.0.1:8080/api/daily | ConvertTo-Json -Depth 5
   curl.exe http://127.0.0.1:8080/api/archive
   curl.exe "http://127.0.0.1:8080/api/leaderboards/all-time?metric=solved"
   ```
   POSTs need `-H "Content-Type: application/json" -H "Origin: http://localhost:5173"`; without them you get a 415 or a 403.
4. Tests:
   ```powershell
   pnpm test:api
   pnpm check
   ```
   Expect every Go package `ok`.

### Phase 5: Web shell and Lab (2026-10-23)

**Done, by acceptance criterion**
- **Routing and layout for every route.**
  - Routes: `/`, `/daily`, `/daily/:number`, `/archive`, `/lab`, `/leaderboard`, `/u/:username`, `/login`, `/register`, `/about` and a 404 page, each lazily loaded (`apps/web/src/router.tsx`).
  - Header with navigation, a mobile menu and a light / system / dark theme toggle; a footer with the server status.
  - Pages that need the API are explanatory placeholders, and login and register show the disabled form layout.
  - Tests: `routes.test.tsx` and `e2e/routes.spec.ts`.
- **Visual design system** (SPEC §11.4).
  - A "casebook" palette as CSS tokens, with paper in light mode and ink in dark mode.
  - Fonts: Fraunces, Inter and IBM Plex Mono, self-hosted.
  - A CSS-drawn board in matching colours, with the **cburnett** pieces bundled in chessground (GPLv2+; checked against Lichess's `COPYING.md`, recorded in DECISIONS).
  - The theme is applied before first paint by an external blocking script, so the CSP needs no inline script (your addition 2).
- **The Lab: edit, paste FEN, auto-analysis, detective notes with highlights, last moves with take-back, Prove with progress and Cancel, permalinks, example gallery.**
  - **Editing:** drag on the board; drag from the palette; click-to-place (keyboard-usable, Escape disarms).
  - **FEN field:** accepts partial FENs and shows parse errors inline. Side to move, castling and en passant controls. Start, Clear and Flip.
  - **Analysis** runs in a Web Worker 300 ms after each edit.
  - **Report:**
    - a verdict banner (icon + word + colour);
    - grouped notes that highlight squares and arrows on hover, focus or tap;
    - last moves at depth 1–6, with Take it back (Back undoes it);
    - Prove up to 16 plies in a second worker, with progress ("Searching 12-ply games…"), Cancel, and a proof player with a scrubber.
  - **Links:** `/lab?fen=…` permalinks, plus "Copy link" and "Open in Lichess" (your addition 3).
  - **Gallery:** 10 examples, including "A dead end two moves back" (your addition 1).
  - Tests:
    - `e2e/lab.spec.ts` (12 tests, including every example's verdict, the palette drag, click-to-place on a flipped board, no auto-castle, Cancel then Prove again, and Copy link);
    - `Report.test.tsx`, `ProofPlayer.test.tsx`, `FenField.test.tsx`, `labState.test.ts`;
    - `useEngine.test.tsx` (hook races);
    - `api.test.ts` and `client.test.ts`.
- **Works at 360 px; keyboard accessible; component tests for the report and notes.**
  - Every route at 360 px has no horizontal scroll (e2e).
  - axe finds no serious or critical violations on `/`, `/about`, `/login` and the Lab with a report, in both themes.
  - A keyboard-only Lab session (skip link, FEN entry, click-to-place by keyboard, note highlight on focus) passes.
  - `Report.test.tsx` covers the verdict banner, notes and last moves.
- **Playwright: open the Lab with an illegal example, see the verdict and reason.** `lab.spec.ts` › "an illegal example shows the verdict and the reason": *Three pawns, two files* → "Illegal" plus "…the pawn on a3 has no possible starting file".
- **/about** explains retrograde analysis with 3 interactive boards: reveal the last move, the capture count, and a playable proof game (e2e: `about page`).
- **Also:**
  - The engine's `onProgress` reports the ply count being searched; engine still 0.4.0.
  - The fast suite was trimmed and the lint caches added, so `pnpm check` is about 70 s.
  - CI runs the e2e suite.
  - `.claude/rules/engine.md` was clarified (generator: node limits only).

**Visual review (Playwright screenshots, 360 and 1280 px × light and dark, 44 per round)**
- **Round 1 found 7 problems:**
  - the gallery and proof-player boards showed coordinates (chessground draws them only at creation);
  - file letters sat outside the board ("H" past the edge at 360 px);
  - castling checkboxes wrapped one word per line;
  - last-move rows collapsed to one word per line at 360 px;
  - the rule badge overflowed its card;
  - black palette pieces were nearly invisible in dark mode;
  - the last-move highlight was too faint.
- **Round 2 found 4 more:**
  - click-to-place had no visual cue on the board;
  - "…" separated from its move at line breaks;
  - castling options were cramped at 1280 px;
  - the "first move" icon looked like a "K".
- **Round 3:** nothing left to fix.
- Final images: `docs/screenshots/lab-{360,1280}-{light,dark}.png`.

**Evidence**
- `pnpm check`: all green in 73 s warm (lint 5 s with caches, typecheck 11 s, tests about 50 s, Go 6 s, hooks 1 s).
  - Engine: 267 unit tests, statements 93.1%, plus 34 property tests.
  - Generator: 37 tests. Web: 8 files, 42 tests. golangci-lint `0 issues`, Go tests ok, hook test passed.
- `pnpm test:e2e`: 35 passed.
- Slow suites: not rerun this phase. The phase's only engine change is the additive `plies` field in `onProgress`, covered by a new fast test (`search.test.ts`). The changed slow tests (solver brute force, wismuth N ≤ 5, generator slow suite) last passed at `2d0cc24`, before this phase began.
- Bundle (`vite build`):
  - main `index` 370 KB raw / **116.65 KB gzip**;
  - `/lab` adds LabPage 10.05 KB, Board (chessground + piece set) 16.17 KB and ProofPlayer 1.03 KB, all gzip;
  - CSS 10.6 KB gzip;
  - engine worker 44.13 KB raw (16.5 KB gzip), loaded separately.
- **Self-review** (separate review agent).
  - It reran unit tests, typecheck, lint and e2e (33/33 at the time), and checked the built `index.html` (no inline script or style), hygiene and licenses.
  - Fixed, from its findings:
    1. Prove could stick on "Searching…" after leaving a position and coming back (no worker running). Abandoned runs now clear their state; there's a hook test for A → B → A.
    2. While re-analysing, the old position's notes, take-backs and proof stayed clickable. The stale report is now dimmed and `inert`.
    3. Chessground's `autoCastle` moved the rook when a king was dragged two squares in the editor. It's now off, with an e2e test.
    4. The piece images are `data:` SVG, so the future CSP needs `img-src 'self' data:`. SPEC §11.1 and DECISIONS now say so.
  - Smaller fixes:
    - a worker that fails to load now rejects its calls instead of hanging;
    - Prove progress is no longer announced on every update;
    - the FEN error is a polite live region instead of an alert on every keystroke;
    - Escape returns focus to the palette;
    - Copy link works on insecure origins and with repeated clicks;
    - gallery boards are hidden from screen readers (the link names them);
    - the example e2e test iterates `EXAMPLES`;
    - Cancel is followed by a second Prove;
    - click-to-place is tested with the board flipped.

**After tagging `phase-5`**
- The first CI run with e2e passed with one *flaky* test: click-to-place once also dropped a queen on c6.
- Cause: chessground caches the board's screen position and refreshes it on scroll and resize only. When the web fonts finished loading, the page title grew and the board moved down, so the stale position mapped the pointer to the wrong square.
- Fix: the board remeasures whenever a pointer goes down on it, and before a palette drag. A regression test shifts the layout on purpose. Without the fix the piece lands on a7 instead of a8; with it the test passes 5 out of 5.
- The fix is in the commit after the tag (the tag isn't moved). `pnpm test:e2e`: 36 passed.

**Known issues / follow-ups**
- Lighthouse scores aren't recorded yet (planned with Phase 9's production server); axe covers the same accessibility rules in the e2e suite.
- The Go server doesn't serve the web app yet (Phase 9 Dockerfile), so deep links like `/lab?fen=…` work in `pnpm dev` / `vite preview` only.
- The board itself can't be operated by keyboard (chessground); the FEN field and click-to-place cover every edit.

**How to try it** (VS Code terminal, PowerShell, in the project folder)

1. Start the app:
   ```powershell
   pnpm --filter @retrograde/web dev
   ```
   Open http://localhost:5173. The footer says "Server: offline" unless the Go API is also running (`pnpm dev` starts both).
2. In the Lab (`/lab`), click *Three pawns, two files* under "Cases to crack". You should see:
   - **✗ Illegal** with the reason;
   - hovering the first note outlines a2, b2 and a3 in red.
3. Open *The bishop that ate the rook* and press **Prove it**. Within a second it finds a 12-ply proof. Drag the scrubber or click a move (5.O-O) to step through it.
4. Edit: drag a black rook from the palette onto the board, or click the white knight in the palette and then click a square. The verdict updates by itself.
5. Click **Take it back** on any possible last move, then press the browser's Back button to return.
6. Press **Copy link** and paste it into a new tab: the same position opens. **Open in Lichess** opens it in Lichess's editor.
7. Try `/about` (press **Reveal** and **Play the proof**), and the theme buttons in the header.
8. Tests:
   ```powershell
   pnpm --filter @retrograde/web exec playwright install chromium   # once
   pnpm test:e2e
   pnpm --filter @retrograde/web shots                              # optional: screenshots into apps/web/screenshots/
   ```
   Expect `36 passed`. `pnpm check` should pass in about 75 s.
### Phase 4: Puzzle generator (2026-10-23)

**Done, by acceptance criterion**
- **`generate`, `verify` and `stats` work; output is deterministic for a seed.**
  - CLI: `apps/generator/src/main.ts` (SPEC §7.1).
  - `generate` grows candidates with a beam search (prefix property, diverse frontier) plus biased random games. Each candidate is fully verified by the solver: a free transposition test, then uniqueness, then the shortest checks. The pool is chosen by ply quotas with at most 3 puzzles per 6-ply prefix, scored, and given stars by rank.
  - `test/generate.test.ts` checks the output is byte-identical for `--jobs 1` and `--jobs 2` (real worker threads) and differs for another seed.
- **Every emitted puzzle passes `verify`.** `verify` replays each solution and re-runs uniqueness and shortest. It also recomputes features, score and stars.
  - `pnpm --filter @retrograde/generator start -- verify data/puzzles-v1.jsonl --jobs 4` → `ok: 500 puzzles verified` (227 s).
  - Tests: `verify` on a committed 20-puzzle fixture, plus a tampered-record test.
  - `verifyCandidate` against brute force on 479 sampled 4-ply targets.
  - The prefix property on random games the beam didn't build.
- **A pool of ≥ 500 puzzles covering all 5 levels with the weekly-ramp cut points**, committed as `data/puzzles-v1.jsonl` (137 KB, seed 1), with its generation report in `data/puzzles-v1.jsonl.stats.json`.
  - Distribution: ★ 71, ★★ 143, ★★★ 143, ★★★★ 72, ★★★★★ 71 (needed: ≥ 53 / 105 / 105 / 53 / 53).
  - Puzzles per ply count:

    | Plies | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
    |---|---|---|---|---|---|---|---|
    | Puzzles | 75 | 95 | 54 | 75 | 52 | 79 | 70 |

  - Quotas: all filled except 10–11 plies, 131 of 140; shorter puzzles topped up the rest.
  - Diversity: 12 different first moves, 38 two-ply openings, 220 six-ply prefixes, at most 3 per prefix.
- **Owner's additions.**
  - Uniqueness runs before the shortest checks (`verify.ts`).
  - Speed was measured first, and the incremental bound came first (see Measurements and DECISIONS).
  - The external check reproduces wismuth.com's diagram table: N ≤ 4 in the fast suite, N = 5 in the slow suite.
  - Sample puzzles are below.
- Also:
  - Engine 0.4.0: incremental bound, frozen-pawn distances, pooled tables, one-ply shortcut, `minimumPlies`. Replay vectors were regenerated; only `engineVersion` changed.
  - `stats --samples N`.
  - CLAUDE.md's generator command is fixed.

**External check (wismuth.com, diagram table)**

A "diagram" there is the 64 squares only. With exactly N plies the side to move follows from parity, so per N it is our target key. Brute-force counts:

| N | Diagrams (= wismuth) | Uniquely realizable (= wismuth) | Ours: unique **and** shortest |
|---|---|---|---|
| 0 | 1 | 1 | 1 |
| 1 | 20 | 20 | 20 |
| 2 | 400 | 400 | 400 |
| 3 | 5,362 | 1,862 | 1,862 |
| 4 | 71,852 | 9,373 | 9,309 |
| 5 | 815,677 | 51,323 | 51,187 |

At N = 4, 64 diagrams have exactly one 4-ply game but are also reached in 2 plies (e.g. 1.a3 a6 2.a4 a5, versus 1.a4 a5).

**Sample puzzles: 2 per star level** (from `stats data/puzzles-v1.jsonl --samples 2`)

| Stars | Plies | Target | Solution |
|---|---|---|---|
| ★ | 6 | `rnbqkbn1/ppppppp1/8/r7/4P3/8/PPPP1P1P/RNBQKBNR w` | 1.g4 h5 2.gxh5 Rxh5 3.e4 Ra5 |
| ★ | 6 | `1nbqkbnr/2pppppp/r7/p7/8/4P3/PPPP1PPP/RNBQKBNR w` | 1.e3 b5 2.Bxb5 a5 3.Bf1 Ra6 |
| ★★ | 7 | `1r1qkbnr/pbpppppp/8/8/4P3/1P6/P1PP1PPP/RNBQK1NR b` | 1.e4 Na6 2.Bxa6 Rb8 3.Bxb7 Bxb7 4.b3 |
| ★★ | 7 | `rnbqk1nr/p1ppbp1p/8/1p6/3P4/8/PPP1PPPP/RN1QKBNR b` | 1.d3 g5 2.Bxg5 b5 3.Bxe7 Bxe7 4.d4 |
| ★★★ | 9 | `1nbqkbnr/2pppppp/8/Rp6/6P1/8/2PPPP1P/1NBQKBNR b` | 1.b4 a5 2.bxa5 Rxa5 3.g4 Rxa2 4.Rxa2 b5 5.Ra5 |
| ★★★ | 9 | `r1bqkbnr/pppnppp1/8/8/2P1P3/8/PP1P1PPP/RNB1K1NR b` | 1.e4 h5 2.Qxh5 Rxh5 3.Bb5 Rh8 4.Bxd7+ Nxd7 5.c4 |
| ★★★★ | 11 | `1Qq1kbnr/p1ppp1pp/b7/1p6/8/4P3/PPPP1PPP/RNB1K1NR b` | 1.e3 b5 2.Bc4 Ba6 3.Bxf7+ Kxf7 4.Qf3+ Ke8 5.Qxa8 Qc8 6.Qxb8 |
| ★★★★ | 12 | `r2qkbnr/p3pppp/8/2pp4/8/4P2P/PPPPKP1P/RNB1Q1NR w` | 1.e3 Na6 2.Bxa6 d5 3.Bxb7 Bxb7 4.Ke2 Bc8 5.Qe1 Bh3 6.gxh3 c5 |
| ★★★★★ | 11 | `rn1qkbnr/pp1bpp1p/8/8/5P2/8/PPP1P1PP/RN2KBNR b` | 1.d4 c5 2.Bh6 cxd4 3.Bxg7 Bxg7 4.Qxd4 Bf8 5.Qxd7+ Bxd7 6.f4 |
| ★★★★★ | 12 | `rn2kbnr/ppp1pppp/8/8/8/8/PPQPPP1P/RNB2bK1 w` | 1.c4 d5 2.cxd5 Qxd5 3.Nh3 Qxg2 4.Bxg2 Bxh3 5.O-O Bxg2 6.Qc2 Bxf1 |

**Evidence**
- `pnpm check`: all green.
  - Time: 110–150 s, varying by run on this laptop after hours at full load. Warm steps: lint 17 s, typecheck 9 s, tests 77–93 s, Go 6 s, hooks 1 s. Phase 4 added about 8 s: incremental-bound checks, the wismuth N ≤ 4 test and the generator tests.
  - Engine unit tests: 16 files, 266 tests, statements 93.1%. Engine property tests: 10 files, 36 tests.
  - Generator: 7 files, 37 tests. Web 3/3, golangci-lint `0 issues`, Go tests ok, hook test passed.
- `test:slow` (1,861 s, slowed by the review agent running in parallel): 14 files, 30 tests passed. That includes 100,000 games of admissibility, now with the incremental bound compared against a fresh one at every position, and the wismuth N = 5 check. That check alone takes 34 s.
- Pool run: `generate --count 500 --seed 1 --jobs 4` took 4,294 s (72 min) on the owner's laptop (i5-6300U, 2 cores / 4 threads). Per-ply acceptance is in `data/puzzles-v1.jsonl.stats.json` and in `stats`.
- **Self-review** (separate review agent): no soundness bugs in the incremental bound, the frozen-pawn distances, the one-ply shortcut, the table pool, the transposition pre-check or determinism.
  - Its independent checks:
    - incremental bound against fresh at 240,000 positions of deep random push/pop walks (657 castlings, 383 en passant, 770 promotions);
    - `solveFrom` against brute force on 62,068 targets from 150 mid-game starts;
    - the pool's stars, prefix caps and line endings;
    - 16 long puzzles re-verified;
    - `--jobs 1` vs `--jobs 3` byte-identical.
  - Fixed:
    - `--min-plies` / `--max-plies` outside 5–12 silently dropped those lengths. They now stretch the nearest quota, with a test.
    - CLAUDE.md's example command would have taken over an hour; it now uses a quick configuration and explains that cost depends on width and length, not count.
    - The fixture now includes an 11- and a 12-ply puzzle.
    - `king-walk` counted both kings together; it now counts per side.
    - A worker that exits without an error event no longer hangs `verify`.
    - Added a determinism test where searches hit the node limit.
    - Seeds above 2^31 − 1 are rejected.
    - Stale table sizes (17 MB, not 13 MB) and two wrong statements in the docs are corrected.
  - The pool was re-verified after the fixes: `ok: 500 puzzles verified`.

**Known issues / follow-ups**
- **Every puzzle has a capture; none has a promotion, en passant or phoenix.** The beam's interest score and the pool's "highest score first" both reward captures. Promotions and en passant are rare at ≤ 12 plies, and the random source, which could add them, accepts only about 0.15% of its games. If the samples feel samey, the next lever is the pool's selection (spread scores within each quota rather than taking the top).
- **About 72 minutes per pool on this laptop**, over the plan's ~1 hour guideline. At N ≥ 10, 25–55% of candidates hit the 200,000-node limit and are discarded. So long puzzles are biased toward ones the solver proves quickly, and the 10–11-ply quota fell 9 short.
- ★ puzzles are all 6 plies: the 5–6 quota takes the best-scoring, and 6-ply games score higher than 5-ply ones.
- `.claude/rules/engine.md` says the solver *and generator* accept `timeLimitMs` and `shouldStop`. The generator deliberately takes only node limits (determinism, DECISIONS 2026-10-22). The rule's wording should be updated; I left the rules file for you to change.
- The fast incremental-bound test checks one-level push/pop. The nightly suite runs it on all 100,000 games; a nested random walk (like the reviewer's stress script) would be a cheap addition.

**How to try it** (VS Code terminal, PowerShell, in the project folder)

1. Summarize the committed pool and show sample puzzles:
   ```powershell
   pnpm --filter @retrograde/generator start -- stats data/puzzles-v1.jsonl --samples 2
   ```
   You should see `500 puzzles`, the tables above, and 2 puzzles per star level with their solutions in SAN.
2. Re-verify the whole pool (about 4 minutes with 4 workers):
   ```powershell
   pnpm --filter @retrograde/generator start -- verify data/puzzles-v1.jsonl --jobs 4
   ```
   It should end with `ok: 500 puzzles verified`.
3. Generate a small pool of your own (about 35 seconds):
   ```powershell
   pnpm --filter @retrograde/generator start -- generate --count 30 --seed 7 --max-plies 8 --width 40 --jobs 4 --out my-puzzles.jsonl
   pnpm --filter @retrograde/generator start -- stats my-puzzles.jsonl --samples 1
   ```
   You should see per-ply progress lines, then a `30 puzzles` summary. Running it again gives a byte-identical file. Delete `my-puzzles.jsonl` and `my-puzzles.jsonl.stats.json` afterwards.
4. Regenerate the committed pool (about 72 minutes; output identical to `data/puzzles-v1.jsonl` with engine 0.4.0):
   ```powershell
   pnpm --filter @retrograde/generator start -- generate --count 500 --seed 1 --jobs 4 --out data/puzzles-v1.jsonl
   ```
5. Run the generator's tests: `pnpm --filter @retrograde/generator test` should end with `Tests  37 passed`.
6. `pnpm check` should pass.

### Phase 3: Proof-game solver (2026-10-22)

**Done, by acceptance criterion**
- **Admissibility over ≥ 5,000 games fast / 100,000 slow, with castling, promotion and en passant.**
  - The lower bound (`packages/engine/src/solver/bound.ts`) implements §6.3 with the owner-approved correction: a non-pawn target piece may be a promoted pawn at cost 0, at most E times per kind.
  - It also has the castling trap, light/dark bishops as separate kinds, and the feasibility rules.
  - The property test (`test/solver/bound-properties.test.ts`, slow: 4 × 25,000) checks every position of every game. It asserts that castling, en passant and promotion games occur, and so does the pattern that breaks a forced matching: a promotion to a kind the side already has, with the original captured later (116 such games per 1,000).
  - The dedicated counterexample test (1.g8=N Rxa1) is in `bound.test.ts`.
- **Brute-force cross-check N ≤ 4 fast, N = 5 slow.**
  - Every target at N = 1–3 and 500 sampled at N = 4 (197,281 games) match the solver's counts exactly; so do 500 sampled at N = 5 (4,865,609 games).
  - Since the self-review, the fast suite also checks targets with zero 4-ply games and checks that find-all collects exactly the brute-force number of distinct games.
- **Every random-game target up to N = 10 solved `complete`.** 2 per N in the fast suite, 20 per N in the slow suite. Each proof replays to the target.
- **Bench recorded; median at N = 8 within target.** The median at N = 8 is 2 ms against the ~5 s target (see Measurements). The solver: depth-first search with exact remaining plies, per-side budgets, ordering by bound in find modes, and a fixed-size transposition table for memoized counting.
- **`analyzePosition` returns `legal` with a proof for the §5.5 fixture.**
  - Every "legal" fixture now gets verdict `legal` with a shortest proof that replays and keeps the stated castling rights and en passant square. That includes 1.e4 e5 written with `-`, 1.e4 with e3 stated, 1.e4 d5 2.exd5, and the castled position (7 plies).
  - Quick proof attempt: 10 plies / 750 ms / 1,000,000 nodes by default; otherwise `undecided` with a reason (SPEC §5.1).
- Also: `solveProofGame` and `shortestProofGame` are public, with `castling`/`enPassant` claim options and `ttBits`; `pnpm --filter @retrograde/engine bench`; engine version 0.3.0. The replay vectors were regenerated, and only their `engineVersion` changed.

**Evidence**
- `pnpm check`: all green, about 102 s with warm caches (138 s on a cold first run after a restart). Engine unit tests: 16 files, 261 tests, statements 93.91%. Engine property tests: 9 files, 35 tests (about 59 s). Web 3/3, generator 1/1, golangci-lint `0 issues`, Go tests ok, hook test passed.
- `test:slow` (1,649 s): 29/29 passed. That covers all perft rows (including start d6 = 119,060,324), 100,000-game admissibility, N = 5 brute force, 20 random targets per N up to 10, the 50,000-node progress callback, 50,000-position retraction completeness/soundness, and analyzer claims on 3,000+ positions (now including proof attempts, about 26 min).
- **Self-review** (separate review agent): no admissibility or count bugs. It independently verified:
  - pawn distances against BFS;
  - 200,000 random pawn sets against a brute-force matching;
  - 30,000 extra stress games;
  - 1,805 search-versus-brute-force checks (en passant and castling requirements, find-all, zero targets, shared table);
  - that the admissibility test fails on 27 games when the bound is deliberately broken back to a forced matching.

  Fixed:
  - Limits were first checked at node 4,096, so a 750 ms budget measured 813 ms. Now they're checked on the first node and every 256 nodes, `shortestProofGame` stops before another length once its budget is spent, and a test holds a 100 ms budget to under 400 ms.
  - A 13 MB table was allocated on every Lab analysis; it's now lazy.
  - Table counts could wrap negative; they now saturate.
  - Comments and DECISIONS wording; SPEC now says `shortestProofGame` takes no `cap`.

**Known issues / follow-ups**
- On searches that prune poorly (12 plies back to the start position), count mode runs at only about 6,000 nodes/s, because it evaluates the bound for every child. Real puzzle targets prune so hard that this doesn't matter (median 9–14 nodes). If the Phase 4 generator's "shortest" checks at N − 2, N − 4, … turn out slow, an incremental bound is the first optimization to try.
- The promotion allowance (cost 0, E per kind) is deliberately loose. It's admissible, but a tighter promotion cost (the pawn's distance to the last rank) could speed up targets with promotions.
- The nightly slow suite now takes about 27 minutes, dominated by the analyzer-claims property.

**How to try it** (VS Code terminal, PowerShell, in the project folder)

1. Run the engine's fast tests:
   ```powershell
   pnpm --filter @retrograde/engine test
   ```
   Expect `Tests  261 passed` with `Statements : 93.91%`, then `Tests  35 passed`.
2. Benchmark the solver:
   ```powershell
   pnpm --filter @retrograde/engine bench
   ```
   You should see six lines (N = 6, 8, 10 × find-one / count). Medians are a few milliseconds and the median node counts are in the teens.
3. Find a shortest proof game and analyze a legal position:
   ```powershell
   cd packages/engine
   npx tsx -e "import { shortestProofGame, analyzePosition, parseFen } from './src/index'; console.log(shortestProofGame('r1bqkbnr/pppppppp/2n5/8/8/5NP1/PPPPPPBP/RNBQ1RK1 b', 12, { castling: 'kq' })); const p = parseFen('rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2'); if (p.ok) console.log(analyzePosition(p.value).verdict);"
   cd ../..
   ```
   The first result has `plies: 7` and the proof `g1f3 b8c6 g2g3 c6b8 f1g2 b8c6 e1g1`. The second has `kind: 'legal'` with the proof `e2e4 d7d5 e4d5`.
4. Optional, about 27 minutes: `pnpm --filter @retrograde/engine test:slow` should end with `Tests  29 passed`.
5. `pnpm check` should pass.

### Phase 2: Retro analysis (2026-10-22)

**Done, by acceptance criterion**
- **Every §5.2 rule, with trigger and non-trigger tests.**
  - All 16 rules from SPEC §5.2 plus the owner-approved `NO_POSSIBLE_HISTORY`, each with plain-English messages and highlight squares (plus arrows for forced moves). Code: `packages/engine/src/retro/rules.ts`, `pawns.ts`, `analyze.ts`.
  - Pawn accounting uses an exact bitmask dynamic program, and a maximum matching whose Hall-violating group is named in `PAWN_STRUCTURE_IMPOSSIBLE` messages.
  - Tests: `test/retro/rules.test.ts` (trigger and silent cases per rule, silence on 8 real-game positions), `pawns.test.ts`, `lastmoves.test.ts`.
- **Completeness and soundness, 2,000 fast / 50,000 slow.**
  - Completeness: for every legal move from each random position P (giving Q), `retractions(Q)` must contain P with only the unknowable fields left out. Checked for Q as played, Q with `-` for en passant, and Q with `-` for castling.
  - Soundness: every retraction of every visited position is confirmed independently with the full move generator.
  - Split into 4 files each (fast 4 × 500, slow 4 × 12,500) so they run in parallel.
- **At least 30 curated fixtures, including the §5.5 table.** `test/fixtures/positions.json` has 37 positions, each with a reasoning comment: all 10 from §5.5, every illegal rule, deductions, a forced last move, a missing last move, a depth-2 dead end, castling claims, un-castling, unpromotion and un-en-passant. Every fixture's proof game was replayed by both the engine and python-chess.
- **`lastMoves` with depth and limits; `LAST_MOVE_FORCED` and `NO_POSSIBLE_LAST_MOVE` tested.** Viability is three-state (viable / not viable / unknown), with node, time and stop limits, and claims are made only from definite results. Tests cover depth changing the verdict, limits producing `unknown` without claims, forced moves (including the "possibly en passant" wording), and the silent cases.
- **`pnpm --filter @retrograde/engine fixtures` writes `fixtures/replay-vectors.json`.**
  - 520 legal games (251 castles, 73 en passant captures, 317 promotions of which 248 underpromotions) and 132 illegal ones covering 6 kinds.
  - Generation is deterministic (a regenerated file is byte-identical), and python-chess agrees on all 652 games.
  - An engine test fails if the file goes stale.
- Also:
  - Owner decisions folded into SPEC §5 and DECISIONS.md: stated castling rights constrain the last move, `NO_POSSIBLE_HISTORY`, three-state viability, bitmask DP plus Hall group.
  - A new property test checks `analyzePosition` on real-game positions: never "illegal", and a forced move is always the move that was played.
  - Engine version 0.2.0.

**Evidence**
- `pnpm check`: all green. Engine unit tests: 14 files, 240 tests, statements 94.53% (coverage measured on unit tests). Engine property tests: 6 files, 15 tests. Web 3/3, generator 1/1, golangci-lint `0 issues`, Go tests ok, hook test passed.
- `pnpm --filter @retrograde/engine test:slow` (1,106 s, run alongside the review agent): 12/12 passed. Every perft count at depth 5, start position at depth 6 = 119,060,324, 400 long random games, and completeness/soundness over 4 × 12,500 positions. The new slow analyzer-claims property ran separately after the review fixes: 1/1 passed (3,000+ real-game positions at depth 3, as played and with `-` fields; 846 s).
- **Self-review** (separate review agent): no soundness bugs. Its probes found 0 failures over 75,285 moves from 4,000 hand-built positions, and no false "illegal" or wrong forced move in 1,828 real-game positions. Fixed:
  - A forced move that could be en passant *or* an ordinary capture was reported as definitely en passant (a false deduction). Now it reads "capturing a black pawn (possibly en passant), …", with a regression test.
  - Added the analyzer-claims property test (fast and slow).
  - Added "does not fire" tests for `LAST_MOVE_FORCED` and `CAPTURES_REQUIRED`.
  - Property failures now print their seed (see DECISIONS.md).
  - Corrected the parity explanation in SPEC, the fixtures and the learning note.
  - Lazy prior positions now pick "the first king" in the same order as `parseFen`.

**Known issues / follow-ups**
- Positions that are legal can only be reported as "undecided" until the Phase 3 solver finds proof games. The "legal" fixtures assert "not illegal" now, and Phase 3 tightens them to `legal`.
- `pnpm check` takes about 1 minute (the engine's property tests are about 40 s of it). The slow suite takes about 15–20 minutes and runs nightly in CI.
- The `NO_POSSIBLE_HISTORY` message says "checked 3 moves deep", following SPEC's example text, but the depth counts single moves (plies), not move pairs.

**How to try it** (VS Code terminal, PowerShell, in the project folder)

1. Run the engine's fast tests (unit tests with coverage, then the property tests):
   ```powershell
   pnpm --filter @retrograde/engine test
   ```
   Expect `Tests  240 passed` with `Statements : 94.53%`, then `Tests  15 passed`.
2. Ask the analyzer about some positions:
   ```powershell
   cd packages/engine
   npx tsx -e "import { analyzePosition, parseFen } from './src/index'; for (const f of ['7k/8/8/8/8/8/PPP5/KB6 b - - 0 1', 'k7/8/8/8/8/PP6/PP6/K7 w - - 0 1', '6k1/4Kppp/8/8/8/8/8/8 w - - 0 1', 'r3k2r/pppp1ppp/4p3/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1']) { const p = parseFen(f); if (p.ok) { const r = analyzePosition(p.value); console.log(f, '->', r.verdict.kind); for (const x of r.verdict.findings) console.log('   ', x.rule + ':', x.message); } }"
   cd ../..
   ```
   You should see:
   - "There's no move White could have just played to reach this position." (the walled-in king);
   - "3 white pawns (a2, b2, a3) could only have started on the a- and b-files, so the pawn on a3 has no possible starting file.";
   - "Black's last move must have been …Kh8-g8, possibly capturing a white knight, bishop, rook or queen.";
   - the `NO_POSSIBLE_HISTORY` message for the last position.
3. Regenerate the cross-language replay vectors (should leave no diff):
   ```powershell
   pnpm --filter @retrograde/engine fixtures
   git status --short fixtures
   ```
4. Optional, about 15–20 minutes: `pnpm --filter @retrograde/engine test:slow` should end with every test passed.
5. `pnpm check` should pass.

### Phase 1: Engine core (2026-10-22)

**Done, by acceptance criterion**
- **Perft at fast depths, slow suite at depth 5 plus start depth 6.** Six reference positions: the five from SPEC §4.7 plus chessprogramming.org's Position 6 (owner's request), all numbers checked against the Perft Results page. Fast suite: start d4, Kiwipete d3, Pos 3 d4, Pos 4 d4, Pos 5 d3, Pos 6 d3. Slow suite: d5 for all six, and the start position at d6.
- **Property tests:** FEN round-trip; make+unmake restores every field; incremental Zobrist hash = recomputed hash; SAN and UCI round-trip for every legal move. These run on seeded random games that favour castling, en passant and promotion (the test asserts each actually occurs): 20 games in the fast suite, 400 longer ones in the slow suite. The same invariants are also checked in random play from nine illegal-but-parseable positions (king capture, two kings, back-rank pawns, no kings, many queens).
- **`replay` handles every special move:** seven reference games built and cross-checked with python-chess (used only as a local tool, not a dependency). Between them they cover both castles for both sides, en passant for both sides, promotions to all four pieces (with and without capture, both colours), checkmate as the last move, a discovered double check, and `illegalAt`/reason reporting.
- **Perft speed recorded:** ≈4.0M nodes/s (see Measurements).
- Also: §11.2's 90% engine statement coverage is enforced in the engine's `test` script (currently 96.25%). The owner's en passant decisions (FEN `-` means "not stated" for retro analysis; ep file hashed only when capturable) are in SPEC §4.5, §5.3, §5.5 and DECISIONS.md. Engine version bumped to 0.1.0.

**Evidence**
- `pnpm check`: all green. Engine: 9 test files, 146 tests passed, statements 96.25% (720/748). Web 3/3, generator 1/1, golangci-lint `0 issues`, Go tests ok, hook test passed.
- `pnpm --filter @retrograde/engine test:slow` (494 s): start d5 = 4,865,609 ✓; Kiwipete d5 = 193,690,690 ✓; Pos 3 d5 = 674,624 ✓; Pos 4 d5 = 15,833,292 ✓; Pos 5 d5 = 89,941,194 ✓; Pos 6 d5 = 164,075,551 ✓; start d6 = 119,060,324 ✓; 400 random games ✓.
- Move-generation, notation and replay expectations were cross-checked against python-chess 1.11.2; the RNG's reference values against an independent Python implementation of splitmix32.
- **Self-review** (separate review agent): no blockers. Fixed:
  - added a game with queen and bishop promotions, including a quiet one;
  - run the full invariants from illegal positions, not just "doesn't throw";
  - made the from-scratch hash test meaningful by playing castling, en passant and a promotion first, and isolated placement in another hash test;
  - stopped `parseFen` accepting the Kelvin sign (K) as a king;
  - made `isSquareAttacked(-1)` return false instead of true;
  - stopped castling onto an attacked square in two-king positions;
  - removed a tuple allocation on castling make/unmake;
  - reject `x` on quiet SAN moves;
  - made fast-check report a failing seed at once (`endOnFailure`);
  - added a test that pins down parsing of an en passant square on the wrong rank.

**Known issues / follow-ups**
- The slow suite takes about 8 minutes, so it runs nightly in CI, not on every push.
- In positions with several kings of one colour, legality is judged against one tracked king (DECISIONS.md). This only affects illegal positions.

**How to try it** (VS Code terminal, PowerShell, in the project folder)

1. Run the engine's fast tests with coverage:
   ```powershell
   pnpm --filter @retrograde/engine test
   ```
   Expect `Test Files  9 passed`, `Tests  146 passed` and a coverage summary with `Statements : 96.25%`.
2. Measure move-generation speed (counts every position 5 moves deep from the start):
   ```powershell
   pnpm --filter @retrograde/engine perft 5
   ```
   You should see `nodes    4,865,609` and a speed of a few million nodes/s. Try a harder position, for example `pnpm --filter @retrograde/engine perft 4 "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"`, which should report `nodes    4,085,603`.
3. Optional, takes about 8 minutes: the slow suite.
   ```powershell
   pnpm --filter @retrograde/engine test:slow
   ```
   Expect `Tests  8 passed`, including `start depth 6 = 119060324`.
4. Everything still passes together:
   ```powershell
   pnpm check
   ```

### Phase 0: Foundations (2026-10-22)

**Done, by acceptance criterion**
- **Clean clone works (Windows and Ubuntu).** pnpm workspace with `@retrograde/engine` (empty library, one test), `@retrograde/generator` (placeholder CLI) and `@retrograde/web`; Go module `services/api` with `serve` and `migrate`; goose with an empty initial migration embedded in the binary; root scripts `dev`, `check`, `test:api`, `gen`, `db:migrate`, `db:up`/`db:down`, `build` (plus `lint`, `format`, `typecheck`, `test`, `check:go`, `test:hooks`). `seed` (Phase 6), `start` (Phase 9) and `test:e2e` (Phase 5) arrive with the phases that give them something to do.
- **`pnpm dev` shows "API: ok".** `GET /api/health` (200 `{"status":"ok","db":"ok"}`, or 503 when the database doesn't answer within 2 s), called by the placeholder page through the Vite proxy.
- **`pnpm gen` produces no diff.** One contract (`api/openapi.yaml`) → oapi-codegen strict server (Go) + openapi-typescript (TS); sqlc for SQL. Tools pinned with Go's `tool` directive in `services/api/tools/go.mod`.
- **Hook active and tested.** `prepare` sets `core.hooksPath`; `scripts/test-commit-msg-hook.mjs` proves the trailer is stripped in a throwaway temp repo.
- **CI green on Ubuntu and Windows**, with Go module/build caches keyed on both `go.sum` files and a nightly slow-test job.
- Also: ESLint (typescript-eslint strict type-checked), Prettier, golangci-lint v2 configs; `LICENSE` (GPL-3.0 text); `.env.example`; `.nvmrc`; README skeleton; optional docker-compose Postgres on port 5433. Spec gaps 9–18 settled with the owner and folded into SPEC.md (DECISIONS.md, 2026-10-22).

**Evidence**
- `pnpm check` on this machine: ESLint + Prettier clean; `tsc` clean in all three packages; Vitest engine 1/1, generator 1/1, web 3/3; `go vet` clean; golangci-lint `0 issues`; Go unit tests ok (`cmd/retrograde`, `internal/config`, `internal/httpapi`); hook test passed.
- `pnpm test:api` (integration, `retrograde_test`): ok for `cmd/retrograde`, `internal/config`, `internal/httpapi`, `internal/store` (migrate twice = idempotent, real-database health check returns 200).
- Clean clone into a temp folder whose path contains a space: `pnpm install` → exit 0, `core.hooksPath` = `.githooks`; `pnpm db:migrate` → exit 0; `pnpm check` → exit 0; `pnpm gen` → no changes.
- `pnpm dev`: `curl http://localhost:5173/api/health` → `200 {"db":"ok","status":"ok"}`; a headless browser load of `http://localhost:5173/` shows "API: ok" with 0 console errors and 0 failed requests; `POST /api/health` → `405` problem+json with `Allow: GET, HEAD`.
- GitHub Actions run 39688748846 (first push): Ubuntu ✓ (3m09s, cold cache), Windows ✓ (1m35s). The run on the final Phase 0 commit is linked from the `phase-0` tag's commit on GitHub.
- **Self-review** (a separate review agent, against the acceptance criteria and CLAUDE.md): no blockers. Fixed: wrong-method requests returned 404 instead of 405; handler log lines lacked `request_id`; CI could cancel runs on `main`; a second Ctrl+C during shutdown was swallowed; `migrate` had no connect timeout; an empty exported variable hid the `.env` value; IPv6 `HOST` produced an invalid address; `KEY="v" # comment` kept its quotes; the hook test crashed instead of explaining when `core.hooksPath` was unset; `/health` didn't declare its problem+json errors; `.vscode/` wasn't gitignored; README lacked the cmd.exe copy command. Each fix has a test where one makes sense.

**Known issues / follow-ups**
- TypeScript is pinned to 6.0.3 because typescript-eslint and openapi-typescript don't support TypeScript 7 yet (DECISIONS.md). Revisit later.
- The first `pnpm gen` / `pnpm check` on a new machine compiles the Go tools (sqlc, golangci-lint) and can take several minutes; later runs are cached.
- Windows' 260-character path limit: a clone nested very deep in folders can make pnpm fail with "The system cannot find the path specified". The project's normal location is fine. If you ever hit it, move the clone to a shorter path or enable Windows long paths.
- CLAUDE.md's generator command is fixed in Phase 4 (DECISIONS.md, 2026-10-22, item 8).

**How to try it** (VS Code terminal, PowerShell, in the project folder)

1. Install and check everything:
   ```powershell
   pnpm install
   pnpm check
   ```
   You should see "All matched files use Prettier code style!", three Vitest summaries with all tests passed, `0 issues.` from golangci-lint, `ok` lines from `go test`, and "commit-msg hook test passed". The first run may spend a few minutes compiling Go tools.
2. Prepare the database (your `.env` already exists; on a fresh clone run `Copy-Item .env.example .env` first and fill in your PostgreSQL user and password):
   ```powershell
   pnpm db:migrate
   ```
   The last line should be a JSON log with `"msg":"database is up to date"` and `"version":1`.
3. Run the app:
   ```powershell
   pnpm dev
   ```
   Wait for `[api] … "msg":"listening"` and `[web] … Local: http://localhost:5173/`, then open http://localhost:5173. The page says **Retrograde** and **"API: ok"**. Each page load adds a `"msg":"request"` log line with `"status":200` and a `request_id`.
4. See the failure path: stop your PostgreSQL service (Windows **Services** app → `postgresql-x64-18` → Stop), reload the page: it says **"API: unavailable"** within about 2 seconds. Start the service again and reload: back to "API: ok". Stop `pnpm dev` with `Ctrl+C`.
5. Run the database integration tests:
   ```powershell
   pnpm test:api
   ```
   Expect `ok` for `internal/httpapi` and `internal/store`.
6. Check that codegen is in sync and commits stay yours:
   ```powershell
   pnpm gen
   git status --short
   git log -5 --format="%an <%ae> | %s"
   ```
   `git status` should show nothing new from `pnpm gen`, and every log line should show you.

<!-- Template for each phase entry:
### Phase N: Name (YYYY-MM-DD)
- Done: what was built, by acceptance criterion
- Evidence: test/check summary, self-review findings and fixes
- Known issues / follow-ups
- How to try it: exact commands for the VS Code terminal (PowerShell) and what you should see
-->
