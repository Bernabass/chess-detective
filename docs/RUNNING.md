# Running Retrograde locally

Everything here works on Windows (PowerShell, cmd.exe or Git Bash), Linux and macOS. The commands are written for PowerShell in VS Code's terminal; where another shell differs, it says so.

## 1. Install the tools

| Tool | Version | Windows |
|---|---|---|
| Git | any recent | `winget install Git.Git` |
| Node.js | 24 LTS | `winget install OpenJS.NodeJS.LTS`, or the installer from nodejs.org |
| pnpm | 12 | `npm install --global pnpm@12.14.0` |
| Go | 1.27 or newer | `winget install GoLang.Go` |
| PostgreSQL | 17 or 18 | the installer from postgresql.org (remember the `postgres` password) |

Open a new terminal afterwards so the new tools are on `PATH`. `psql` may not be on `PATH`; it's in `C:\Program Files\PostgreSQL\<version>\bin`.

Docker is optional: `pnpm db:up` starts a throwaway PostgreSQL on port 5433 instead of a local one, and Docker builds the production image ([DEPLOY.md](DEPLOY.md)).

## 2. Get the code and set it up

```powershell
git clone https://github.com/Bernabass/chess-detective.git
cd chess-detective
pnpm install
Copy-Item .env.example .env        # cmd.exe: copy .env.example .env   bash: cp .env.example .env
```

Edit `.env`: put your PostgreSQL username and password into `DATABASE_URL` and `TEST_DATABASE_URL` (URL-encode special characters, e.g. `@` as `%40`). Then create the two databases:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE retrograde"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE retrograde_test"
```

Load the puzzles:

```powershell
pnpm seed
```

You should see the migrations applied, `imported 500 puzzles`, and a schedule from `LAUNCH_DATE` (set to 14 days ago in your `.env` if it wasn't there, so the archive has puzzles) through 30 days ahead. `pnpm seed` is safe to run again.

## 3. Run it

| Command | What it does | Open |
|---|---|---|
| `pnpm dev` | Applies pending migrations, then runs the Go API and the Vite dev server with hot reload | http://localhost:5173 |
| `pnpm build` then `pnpm start` | The production build: one binary serving the API and the web app, with the production security headers | http://localhost:8090 |
| `pnpm try:api` | Builds a private API on port 8091 and walks through the daily flow (guest, wrong guess, hint, solve, register, leaderboards), printing every request and response | (terminal only) |

`pnpm dev` stops at once with a clear message if PostgreSQL isn't running or `.env` is missing. `pnpm start` also applies migrations first. Stop either with Ctrl+C.

## 4. Test it

| Command | What | Time |
|---|---|---|
| `pnpm check` | Lint, typecheck and fast tests for every TypeScript package, `go vet`, golangci-lint, Go unit tests | about 1.5 min |
| `pnpm test:api` | Go unit and integration tests against `retrograde_test` | about 1 min |
| `pnpm --filter @retrograde/web exec playwright install chromium` | Once: the browser for the end-to-end tests | |
| `pnpm test:e2e` | Playwright end-to-end tests against the production build, a real API on fixture puzzles (in an `e2e` schema of `retrograde_test`) and a fake Lichess, under the production CSP | about 3 min |
| `pnpm --filter @retrograde/engine test:slow` | The engine's slow suite: deep perft, 50,000-position retraction properties, 100,000-game bound admissibility | about 30 min |
| `pnpm --filter @retrograde/generator test:slow` | The generator's slow suite, including `verify` of the whole committed pool | about 5 min |
| `pnpm gen` | Regenerates the Go server, sqlc code and TypeScript API types from `api/openapi.yaml`; `git status` should then show no changes | |
| `pnpm --filter @retrograde/web shots` | Screenshots of every key page at 360 and 1280 px, light and dark, into `apps/web/screenshots/` | about 2 min |
| `pnpm --filter @retrograde/web gifs` | Records the README's demo GIFs into `docs/demo/` | about 1 min |

The generator, if you want to make puzzles yourself:

```powershell
pnpm --filter @retrograde/generator start -- generate --count 30 --seed 7 --max-plies 8 --width 40 --jobs 4 --out puzzles.jsonl
pnpm --filter @retrograde/generator start -- verify puzzles.jsonl
pnpm --filter @retrograde/generator start -- stats puzzles.jsonl
```

That takes under a minute. The committed 500-puzzle pool (`--count 500 --seed 1 --jobs 4`) takes about 72 minutes.

## 5. Manual test checklist

Run `pnpm dev`, open http://localhost:5173 in a private window, and go through these. Each says what to do and what you should see.

**A guest plays the daily** (the first key journey)
1. Click **Daily**. The **How to play** dialog opens with a small example (✕ ✓ ↔ ✓). Close it. Reload: it doesn't open again. **How to play** at the top reopens it.
2. The page shows the target position, its stars and its length ("Reach the target in 4.5 moves · 9 plies").
3. Drag a knight out, then type a move such as `e4` in the move field and press Enter. Illegal moves aren't accepted. The ply counter counts up, and **Submit guess** stays disabled until exactly the right number of plies.
4. Tick **Show differences from the target**: the squares that differ are marked.
5. Submit. A row of squares appears, one per ply, each with an icon (✓ right move, ↔ right move at another ply, ✕ not in the solution) and the moves under it. A screen reader announces the result.
6. Click **Take hint 1 of 3**: which pieces moved. Then hint 2: the plies with captures.
7. Click your guess row: it loads onto the board for editing.
8. To solve it, run `pnpm try:api` in a second terminal. Its "solving guess" step prints today's solution in UCI. Type those moves (the field accepts UCI) and submit. You see **Case closed**, the solution played back, the share card and a countdown to the next puzzle in your local time.
9. Click **Copy result** and paste it somewhere: `Retrograde #N ★… · …`, your rows as coloured squares, and the link.

**The Lab** (the second key journey)
1. Click **Lab** and paste `rnbqkbnr/pppppppp/8/8/8/2P5/P1PPPPPP/RNBQKBNR b KQkq - 0 1` into the FEN field. **Illegal**: White's pawns needed a capture, but no black piece is missing.
2. Open each example from the gallery ("Who moved last?", "Count the captures", "The impossible start", …). Each opens with the verdict its card promises.
3. Hover a detective note: its squares light up on the board.
4. Under **Possible last moves**, click **Take it back**: the prior position loads, and the browser's Back returns.
5. Paste `rn2kbnr/ppp1pppp/8/8/8/8/PPQPPP1P/RNB2bK1 w - - 0 1` and click **Prove it**. Progress shows the length being searched, then "Found a shortest proof game: 12 plies". Play it back with the buttons and the slider.
6. Paste `rnbqkbnr/pppppppp/8/8/8/N7/PPPPPPPP/R1BQKBNR w - - 0 1`, click **Prove it**, then **Cancel**: "Cancelled.", and the Lab keeps working.
7. **Copy link** copies a `/lab?fen=…` address that reopens the position. **Open in Lichess** opens Lichess's board editor with it.
8. Click a palette piece, then a square, to place it with the mouse or keyboard (Tab, Enter); Escape stops placing.

**Accounts**
1. As the guest from above, click **Sign in → Create an account**. Your daily result moves to the new account, and the header shows your name.
2. **Sign out**, then sign in again; a wrong password says so without saying which part was wrong.

**A returning player with Lichess** (the third key journey). In a private window:
1. **Sign in → Sign in with Lichess**. Lichess asks to allow `http://localhost` to read only public data.
2. You're back where you started, signed in with your Lichess name (or `name-2` if that name is taken here).
3. Your profile says **Lichess: @yourname**, and the link opens your Lichess profile.
4. At https://lichess.org/account/security there's no app for localhost: the token was revoked at once.
5. Sign out and in with Lichess again: the same account. Try **Cancel** on Lichess: "Lichess sign-in was cancelled."

**Archive, leaderboards, profile, privacy**
1. **Archive** lists every released puzzle, newest first, with your result where you have one. Open an earlier one: it's marked practice, and after finishing, its share card says `(practice)`. Your stats and streak don't change.
2. **Leaderboard**: today's board ranks solvers by guesses, hints, then time, and marks your row **You**. The all-time boards rank by current streak, best streak and puzzles solved. Guests never appear.
3. Click your name: your profile shows played, solved, win rate, streaks, average hints and the guess distribution (as a chart, with the same numbers as a table for screen readers).
4. The footer's **Privacy** link opens `/privacy`: what's stored, the cookies, no tracking, and the third parties.

**Everywhere**
1. The theme toggle in the header switches light, system and dark, and remembers your choice.
2. At 360 px wide (the browser's device toolbar), no page scrolls sideways.
3. Everything works with the keyboard alone, with a visible focus ring.

**The production build:** run `pnpm build`, then `pnpm start`, and open http://localhost:8090. The same app, served by the Go binary with the production security headers. In the browser's developer tools, the console shows no Content Security Policy errors.
