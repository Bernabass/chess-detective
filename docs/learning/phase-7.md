# Phase 7: Daily UI, leaderboards, profiles, archive

Phase 7 puts the game on the page. You play the daily proof game on a real board, get Wordle-style feedback, take hints, see the solution played back, copy a share card, and sign up to keep your streak. Leaderboards, profiles and the archive read the Phase 6 API.

Code: [apps/web/src/features/daily/](../../apps/web/src/features/daily/) (the game), [routes/](../../apps/web/src/routes/) (leaderboard, profile, archive, sign in), [lib/queries.ts](../../apps/web/src/lib/queries.ts) (every API call), [e2e/](../../apps/web/e2e/) (browser tests against a real API).

## 1. Server state, not app state

Every piece of game data lives on the server. The page shows what the server says and asks it to change things; it never keeps its own copy of "the truth".

- **TanStack Query** caches each GET by a key (`['puzzle', 4]`, `['me']`, `['leaderboard', 'daily', 4]`). Components ask for data with hooks (`usePuzzle(4)`), and the cache handles loading, errors and sharing between components.
- **Mutations** (start, guess, hint, sign in) change server state, then update or invalidate the cache. After a guess, the page re-reads the puzzle, so the guess rows, hints and (when finished) the solution all come from one fresh server answer. After signing in, *everything* is invalidated, because a guest merge can change any of it.
- **Typed end to end.** Requests go through `openapi-fetch` with types generated from `api/openapi.yaml`, so a renamed field breaks the build, not the page. Errors come back as RFC 9457 problems, turned into one `ApiError` class ([lib/problem.ts](../../apps/web/src/lib/problem.ts)) that every page displays the same way.
- **Retries only when they can help.** A network error or a 500 is retried; a 404 isn't (it won't change), so "puzzle #5 isn't released yet" shows at once.

The only state the page owns is the guess being played: a list of UCI moves in a reducer ([moves.ts](../../apps/web/src/features/daily/moves.ts)). Everything else (position, SAN, legal destinations, promotions, check) is *derived* from that list with the engine, so it can never disagree with it.

## 2. Playing moves on the board

- The board shows only **legal destinations**: the engine's `legalMoves` for the current position become chessground's `dests` map. Generating moves for one position takes microseconds, so it runs on the main thread (the solver and analysis stay in the Web Worker).
- **Promotions** are moves the board can't finish alone: a pawn reaching the last rank opens a picker. If the player cancels, the position hasn't changed, so React has nothing to re-render, but chessground has already moved the pawn. The board wrapper exposes `sync()` to redraw from the current props.
- **Typed moves** (SAN like `Nf3` or `bxa8=Q`, or UCI like `e2e4`) are the keyboard alternative, and the e2e tests use them for speed.
- The **difference overlay** compares the board with the target square by square. It uses only the public target, so it reveals nothing.

## 3. Races and the order of things

The daily page shows the puzzle, then starts the attempt (`POST /start`), because GETs must stay side-effect free (Phase 6). A fast player could submit a guess before the start answered, and the server would reject it. The e2e suite caught this; the fix is that Submit stays disabled until the attempt exists, with a component test that fails without the fix.

The same thinking applies to Windows-specific traps found along the way: a file named `countdown.ts` next to `Countdown.tsx` is the same file to Windows' case-insensitive file system, and the clipboard turns `\n` into `\r\n`.

## 4. Feedback that doesn't rely on colour

Each feedback square has a colour, an icon (✓, ↔, ✕) and words. The visible row is hidden from screen readers and replaced by one sentence per ply ("Ply 3, e4: right move, another ply"), and each result is announced in an `aria-live` region ("Guess 2 of 6: 3 right, 2 in another ply, 3 not in the solution"). The guess-distribution chart has a hidden table with the same numbers.

## 5. A How to play example you can trust

Proof games are new to most players, so the first visit opens a short How to play dialog (a native `<dialog>`: focus trap and Escape for free) with a tiny example: target after 1.e4 e5 2.Ke2 Ke7, and a guess 1.Nf3 e5 2.e4 Ke7 marked ✕ ✓ ↔ ✓. The example has to obey the real rules: daily puzzles have exactly one solution, so the example's target must too, or "right but swapped" might also solve it. A test runs the engine's solver to prove the target is a **unique shortest proof game**, and checks the feedback with the same reference implementation that generates the Go test vectors.

## 6. Time zones

The day changes at midnight UTC for everyone. The countdown computes the next UTC midnight (`Date.UTC(y, m, d + 1)`) and shows it in the player's own time with `Intl.DateTimeFormat`; tests pin the time zone (Tokyo, New York) to check it.

## 7. Testing against a real API

Component tests (Vitest + Testing Library) give pages a fake API: a tiny `fetch` that answers by method and path and records calls. End-to-end tests (Playwright) run the production build against the real Go API on a fresh `e2e` schema loaded with 10 known puzzles, so a test can look up today's solution and play it. They cover a guest solving the daily, failing an archive puzzle, the promotion picker, registering and keeping the result, the leaderboards, keyboard-only play and accessibility scans (axe) in both themes. A screenshot run photographs every state at 360 and 1280 px in light and dark mode for a visual review.

## Interview questions you should be able to answer

- *Where does game state live, and why?* On the server; the client caches it (TanStack Query) and only owns the guess in progress. One source of truth means no sync bugs, and the solution can stay secret.
- *How do you avoid a race between "start" and the first action?* Make the action depend on the start's result (Submit is disabled until the attempt exists), and test the failure case.
- *How do you make colour-coded feedback accessible?* Pair every colour with an icon and words, give screen readers a sentence per item, and announce changes with `aria-live`.
- *How do you test UI that depends on a real backend?* Component tests with a fake API for logic; end-to-end tests against the real API on known fixture data for the whole flow.
- *Why shouldn't you retry a 404?* It won't change; retries only delay the error. Retry what might succeed: network errors and 5xx.
