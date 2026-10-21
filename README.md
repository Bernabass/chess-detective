# Retrograde

Chess detective puzzles built on **retrograde analysis**: instead of asking "what's the best move?", Retrograde asks "**what happened?**". Look at a position and reason backwards to work out how it arose.

> Status: under construction. See [docs/PROGRESS.md](docs/PROGRESS.md) for what works today.

<!-- Live demo link: added in Phase 9 -->
<!-- GIFs of solving a daily and of the Lab: added in Phase 9 -->

## What it does

- **Lab**: set up or paste any position. The engine explains in plain English whether it is legal, lists the possible last moves, and can prove legality by finding a game that reaches it.
- **Daily Proof Game**: a Wordle-style daily puzzle. Reach the target position from the start in exactly N plies, with six guesses, per-ply feedback, hints, streaks and leaderboards.
- **Accounts**: username/password or "Sign in with Lichess"; guests can play too.

## Architecture

<!-- Diagram: added in Phase 9. Until then, see docs/SPEC.md §3. -->

| Part | Stack |
|---|---|
| `packages/engine` | TypeScript chess + retro engine, no runtime dependencies |
| `apps/web` | React + Vite; the engine runs in a Web Worker |
| `apps/generator` | Node CLI that generates and verifies daily puzzles |
| `services/api` | Go + PostgreSQL; serves the built web app in production |
| `api/openapi.yaml` | The API contract; Go and TypeScript code is generated from it |

## Interesting problems

<!-- Written as the phases land: retraction completeness, admissible bounds and the castling trap,
memoized uniqueness counting, matching-based capture accounting, one rule set in two languages. -->

## Running it locally

Requirements: Node 24 with pnpm, Go, Git and PostgreSQL. Windows, Linux and macOS all work.

```sh
pnpm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env   (then fill in your PostgreSQL user and password)
pnpm db:migrate
pnpm dev                  # open http://localhost:5173
```

## Tests

```sh
pnpm check       # lint, typecheck, fast tests (TS and Go), golangci-lint
pnpm test:api    # Go integration tests against the test database
pnpm --filter @retrograde/engine test:slow
```

## License

[GPL-3.0-or-later](LICENSE). The board UI uses [chessground](https://github.com/lichess-org/chessground), which is GPL-3.0.
