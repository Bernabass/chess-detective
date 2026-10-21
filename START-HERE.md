# Start here

Everything happens inside this folder in VS Code, in the Claude Code chat panel. You paste a prompt; Claude Code plans, codes, tests, reviews its own work, commits as you, pushes, and then tells you how to try the result.

Setup was done once with the setup prompt from the chat. From then on you only need the prompts below.

## Each phase (same steps every time)

1. **Start a new conversation** in the Claude Code panel.
2. **Paste the "Next phase" prompt.** Claude finds the next phase by itself and writes a plan.
3. **Approve the plan:** reply `Approved, go ahead.` (or ask for changes first).
4. Claude builds, runs the tests, reviews its own work with a second agent, commits, tags `phase-N`, pushes, and stops.
5. **Try it:** run the commands from its "How to try it" section in the VS Code terminal, or paste the "Try it" prompt and Claude walks you through it.
6. **Learn it:** read `docs/learning/phase-N.md`.

| Phase | Name | What you can try afterwards |
|---|---|---|
| 0 | Foundations | A placeholder page showing "API: ok" |
| 1 | Engine core | Engine tests (move generation proved correct) |
| 2 | Retro analysis | Engine tests for illegal positions and "last move" analysis |
| 3 | Proof-game solver | Solver tests and benchmarks |
| 4 | Puzzle generator | Generate puzzles from the terminal |
| 5 | Web shell and Lab | The Lab in your browser |
| 6 | API core | The API with the database (tests and sample requests) |
| 7 | Daily UI, leaderboards, profiles, archive | The full daily game in your browser |
| 8 | Sign in with Lichess | Logging in with your Lichess account |
| 9 | Polish and ship | Everything, plus deployment and `docs/RUNNING.md` |

Phases 1–3 are the hardest. Expect several conversations each. If a conversation gets long or Claude starts going in circles, start a new one and paste the "Continue" prompt.

## Prompts

### Next phase

```
Start the next phase. Read docs/PROGRESS.md to see which phase is next, then follow CLAUDE.md: read the spec sections that phase references, look at the existing code, write the plan, and wait for my approval.
```

### Continue (new conversation in the middle of a phase)

```
Continue the current phase. Read docs/PROGRESS.md, the recent git log and the code to see where we are, then carry on with the approved plan.
```

### Try it

```
Walk me through trying everything we've built so far. Start whatever needs to run, then tell me step by step what to open, what to click or type, and what I should see. Run the automated tests too and show me the results.
```

### When something breaks

```
<paste the error or describe what went wrong>. Find the root cause, write a failing test that reproduces it, fix it, and show me the passing test output. Don't suppress the error or weaken any test.
```

### To learn the code

```
Explain <file or function> as if I'll be asked about it in a technical interview: what problem it solves, the algorithm, its time and memory complexity, the tricky edge cases, and two questions an interviewer might ask, with good answers.
```

### Final check (after Phase 9)

```
Do the final check from docs/SPEC.md Phase 9: from a fresh clone of the repo, follow docs/RUNNING.md exactly, run every automated test, then walk me through the manual test checklist one item at a time and wait for me to confirm each one. Fix anything that fails.
```

## Running it yourself

After Phase 7, a typical session in the VS Code terminal looks like this (Claude keeps `docs/RUNNING.md` as the full version):

```powershell
pnpm install
pnpm db:migrate
pnpm seed
pnpm dev
```

Then open the address it prints (usually `http://localhost:5173`). Stop it with `Ctrl+C`.

## How commits stay yours

- Commits use your name and email (`git config user.name` / `user.email` in this repo), so GitHub shows them as yours with your avatar.
- Claude's "Co-Authored-By" and "Generated with Claude Code" lines are turned off in `.claude/settings.json`, forbidden in `CLAUDE.md`, and removed by `.githooks/commit-msg` if one ever slips through.
- To check, run `git log -5 --format="%an <%ae> | %s"` in the terminal. Every line should be you.

## Tips

- If Claude asks permission for every routine command, open the mode menu at the bottom of the chat's prompt box and choose **Auto**.
- **Undo:** hover over an earlier message and use the rewind button to roll the code back to that point. The `phase-N` git tags are your bigger safety net.
- If you've corrected Claude twice on the same thing and it's still wrong, start a new conversation with a sharper prompt that includes what you learned.
- Phase 8 needs a quick test with your Lichess account, and Phase 9 needs a hosting account. Claude will tell you what to do.
- Read the diffs, at least for the engine. "I built it with Claude Code" is fine in interviews; "I don't know how it works" is not.

## For your resume, once it's live

> **Retrograde**: a daily chess deduction puzzle and retrograde-analysis lab. Built a TypeScript engine that reasons backwards from positions (complete retraction generation, matching-based capture accounting) and a proof-game solver with admissible per-side bounds and memoized uniqueness counting, used to generate hundreds of verified unique puzzles. Go + PostgreSQL API with sessions, Lichess OAuth (PKCE), streaks and leaderboards; React front end with the engine in a Web Worker.
