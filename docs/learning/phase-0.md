# Phase 0: Foundations

Phase 0 builds no chess. It builds the **skeleton every later phase hangs on**: a monorepo with three TypeScript packages and a Go service, one API contract that generates code for both languages, a database migration pipeline, quality gates (`pnpm check`, CI), and a git hook that keeps authorship honest. The point is that from Phase 1 on, every new feature drops into a place that already builds, tests, lints and deploys.

## 1. The monorepo: one repo, two languages

```
packages/engine     TypeScript library (the chess brain, empty for now)
apps/generator      Node CLI that will produce puzzles
apps/web            React + Vite front end
services/api        Go HTTP API + PostgreSQL
api/openapi.yaml    the contract between web and api
```

- **pnpm workspaces** ([pnpm-workspace.yaml](../../pnpm-workspace.yaml)) link the TS packages to each other. `apps/generator` depends on `"@retrograde/engine": "workspace:*"`: pnpm symlinks the local folder instead of downloading anything, so a change in the engine is visible to the generator immediately.
- The engine's `package.json` exports `./src/index.ts` directly. There is no build step for internal packages: Vite, Vitest and `tsx` all understand TypeScript, so source is consumed as-is.
- **Root scripts are the only task runner** ([package.json](../../package.json)). Windows has no `make`, and npm scripts run in `cmd.exe` there, so anything more than a one-liner is a Node script in [scripts/](../../scripts/), which runs identically on every OS. `go -C services/api …` replaces `cd services/api && …`.

*Interview angle:* "Why not Nx/Turborepo?" With four packages, plain pnpm workspaces plus scripts is enough; a build orchestrator pays off with caching across dozens of packages.

## 2. Contract-first API: one YAML, two code generators

[api/openapi.yaml](../../api/openapi.yaml) describes `GET /api/health`. `pnpm gen` ([scripts/gen.mjs](../../scripts/gen.mjs)) turns it into:

| Generator | Output | Used by |
|---|---|---|
| oapi-codegen (strict server) | [services/api/internal/httpapi/openapi.gen.go](../../services/api/internal/httpapi/openapi.gen.go) | Go: the `StrictServerInterface` we implement |
| openapi-typescript | [apps/web/src/api/schema.d.ts](../../apps/web/src/api/schema.d.ts) | TS: the `paths` type that `openapi-fetch` uses |
| sqlc | [services/api/internal/store/sqlcdb/](../../services/api/internal/store/sqlcdb/) | Go: type-safe functions from `db/queries/*.sql` |

Why it matters: if someone renames a field in the YAML, **both** the Go server and the React code stop compiling until they're updated. Drift between client and server becomes a compile error instead of a production bug. CI re-runs `pnpm gen` and fails if the committed output differs (`git diff --exit-code`), so nobody can forget to regenerate.

The **strict server** style means a handler is a plain function: typed request in, typed response out ([server.go](../../services/api/internal/httpapi/server.go), `GetHealth`). Each possible response is its own type (`GetHealth200JSONResponse`, `GetHealth503JSONResponse`), so you can't return a status code the contract doesn't list.

## 3. The health check, end to end

```
browser ──GET /api/health──▶ Vite dev server :5173 ──proxy──▶ Go API 127.0.0.1:8080 ──SELECT 1──▶ PostgreSQL
```

1. [App.tsx](../../apps/web/src/App.tsx) asks for `/health` through TanStack Query and the typed client ([client.ts](../../apps/web/src/api/client.ts)).
2. In development, Vite forwards `/api/*` to Go ([vite.config.ts](../../apps/web/vite.config.ts)). The browser only ever talks to one origin, which is also how production will work (the Go binary will serve the web app itself), so there's no CORS to configure.
3. `GetHealth` gives the database **2 seconds** (`context.WithTimeout`) to answer `SELECT 1`. It returns 200 `{"status":"ok","db":"ok"}`, or 503 `{"status":"unavailable","db":"error"}`.
4. The database error itself is **logged, never sent** to the client: an error string like "password authentication failed for user bob" would leak internals. A unit test checks the exact body for that case.

Why `SELECT 1` instead of pgx's built-in `Ping`? It goes through sqlc like every other query (sqlc also refuses to run with zero queries), and it proves the database *answers queries*, not just accepts connections.

## 4. Go service structure

- [cmd/retrograde/main.go](../../services/api/cmd/retrograde/main.go): one binary, subcommands `serve` and `migrate`. `run()` takes its arguments and output streams as parameters, so it's testable without starting a process.
- **Graceful shutdown:** `signal.NotifyContext` cancels a context on Ctrl+C or SIGTERM; `server.Shutdown` stops accepting connections and waits up to 10 s for in-flight requests.
- **Server timeouts** (`ReadHeaderTimeout` and friends) are set explicitly. Go's zero values mean "no timeout", which lets a slow client hold a connection open forever (the Slowloris attack).
- **Middleware** ([middleware.go](../../services/api/internal/httpapi/middleware.go)) wraps the router like onion layers: request ID → access log → panic recovery → router. Each is a function `http.Handler → http.Handler`. The logger wraps the recoverer so a panic is still logged with status 500.
- **Errors** use RFC 9457 `application/problem+json`, a standard error format clients can rely on.

### Configuration without global state

[internal/config](../../services/api/internal/config/) reads settings from real environment variables first, then from the nearest `.env` file above the working directory (stopping at the repo root). The trick is that it **never calls `os.Setenv`**: `Environ()` returns a lookup function, and `Load(lookup)` validates everything and reports *all* problems at once with `errors.Join`. Tests pass a map instead of touching the real environment, so they can run in parallel safely.

## 5. Migrations (goose) embedded in the binary

- Migrations live in [services/api/db/migrations/](../../services/api/db/migrations/) as plain SQL with `-- +goose Up` / `-- +goose Down` sections. They're **append-only**: you never edit an applied migration, you add a new one.
- `//go:embed migrations/*.sql` ([db/migrations.go](../../services/api/db/migrations.go)) compiles the SQL files *into the binary*, so production can run `retrograde migrate` without the source tree. `go:embed` can only see files at or below the package's directory, which is why that small Go file sits next to the migrations folder.
- goose's `Provider` API is used instead of its package-level functions, which rely on global state.
- goose records applied versions in a `goose_db_version` table, which is why running `migrate` twice is safe (the integration test does exactly that).

## 6. Pinned tools via Go's `tool` directive

oapi-codegen, sqlc, goose and golangci-lint are declared in [services/api/tools/go.mod](../../services/api/tools/go.mod) with `tool` lines (Go 1.24+). Running `go tool -modfile=tools/go.mod sqlc` builds that exact version from source and caches it. Benefits: no global installs, the same versions on every machine and in CI, and the tools' many dependencies stay out of the API's own `go.mod`. Cost: the first build is slow (sqlc took about 15 minutes on Windows), which is why CI caches Go's module and build caches.

## 7. Quality gates

- `pnpm check` = ESLint (typescript-eslint *strict type-checked*) + Prettier + `tsc` + Vitest + `go vet` + golangci-lint + Go unit tests + the hook test. It must pass before every commit.
- **Engine purity:** the engine is type-checked twice: once with Node types (for its tests), and once by [tsconfig.lib.json](../../packages/engine/tsconfig.lib.json) with *no* Node or DOM types. If engine code ever touches `process` or `document`, the second check fails. ESLint also bans `node:*` imports there.
- **Integration tests** carry a `//go:build integration` tag, so `go test ./...` stays fast and database-free, and `pnpm test:api` adds `-tags integration` to run them against `retrograde_test`.
- **CI** ([ci.yml](../../.github/workflows/ci.yml)): Ubuntu runs everything against a real Postgres service container; Windows runs install + tests to keep the scripts honest; a nightly job runs slow engine tests.

## 8. The commit-msg hook

[.githooks/commit-msg](../../.githooks/commit-msg) deletes AI attribution lines from commit messages. `pnpm install` runs `prepare`, which sets `git config core.hooksPath .githooks` ([setup-hooks.mjs](../../scripts/setup-hooks.mjs)), so it's active on every clone. The hook is proven by [test-commit-msg-hook.mjs](../../scripts/test-commit-msg-hook.mjs), which creates a **throwaway repo in the temp folder**, commits a message with the trailers, and checks they're gone while normal lines (including a human co-author) survive. Testing in a temp repo keeps this repository's history clean.

## Questions an interviewer might ask

1. **"Why generate code from OpenAPI instead of writing types by hand?"** Two languages share one API. Generation makes the contract the single source of truth, and CI's no-diff check means generated code can't go stale. The trade-off is a codegen step and generated files in the repo.
2. **"What happens if the database goes down?"** The server still starts (pgxpool connects lazily), `/api/health` returns 503 within 2 seconds instead of hanging, the error is logged with the request ID, and the page shows "API: unavailable".
3. **"How do you keep tests from hitting the dev database?"** Integration tests read only `TEST_DATABASE_URL` (a separate `retrograde_test` database), they're behind a build tag, and the helper fails with a clear message if the variable is missing.
4. **"Why bind to 127.0.0.1 by default?"** Least exposure: the dev API isn't reachable from the network, and on Windows it avoids a firewall prompt on every `go run`. Production sets `HOST=0.0.0.0` explicitly.
