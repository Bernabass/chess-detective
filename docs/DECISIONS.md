# Decisions

Append-only. Each entry: date, context, decision, consequences. Newest at the bottom.

## 2026-10-21: Stack
- Context: The engine must run in the browser and in Node; the product needs accounts, leaderboards and a server-side secret (the daily solution). The author knows TypeScript, Go, Python, C#, React and Postgres and wants a strong portfolio project.
- Decision: TypeScript for the engine, generator and web app; Go + PostgreSQL for the API.
- Consequences: Chess rules exist in two languages (TS engine, Go library on the server). Cross-language fixture tests are mandatory (SPEC §11.2).

## 2026-10-21: License
- Context: chessground is GPL-3.0.
- Decision: The whole repository is GPL-3.0-or-later.
- Consequences: Every dependency must be GPL-compatible. The source must stay public.

## 2026-10-21: Plies and target comparison
- Decision: All internal lengths are plies. Daily targets compare piece placement + side to move only.
- Consequences: Castling rights, en passant and clocks in a target are ignored, which matches proof-game problem conventions.

## 2026-10-21: Day boundary
- Decision: A puzzle day is a UTC calendar day; puzzle #1 is `LAUNCH_DATE`.
- Consequences: Players far from UTC see the new puzzle at a fixed local time, not midnight.

## 2026-10-21: Windows-first tooling
- Context: The owner develops on Windows 10 in VS Code with the Claude Code extension. `make` isn't available there by default.
- Decision: No Makefile. All tasks are cross-platform root `package.json` scripts backed by Node helpers; LF line endings via `.gitattributes`; CI also runs on `windows-latest`.
- Consequences: Scripts avoid shell-specific syntax. Tools that can't run natively on Windows run through Docker.

## 2026-10-21: Commit authorship
- Context: The repository is the owner's portfolio. Every commit must show only the owner's GitHub account.
- Decision: Commits use the repo's git identity only: the owner's GitHub username and the email on their GitHub account, like any normal developer. AI attribution is disabled in `.claude/settings.json` (`attribution.commit`/`pr` empty, `sessionUrl` false) and stripped by `.githooks/commit-msg` as a backstop. No GitHub app or bot account is used.
- Consequences: The hook must stay enabled (`core.hooksPath .githooks`, set by `pnpm install`).

## 2026-10-21: Retraction castling rights
- Decision: Normal retractions copy the current castling rights to the prior position; only un-castling adds a right (SPEC §5.3).
- Consequences: Analysis stays sound. Some prior positions may have had more rights than shown, which doesn't affect any verdict.
