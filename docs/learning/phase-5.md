# Phase 5: Web shell and Lab

Phase 5 is the first thing you can use in a browser: a React app with every route of the site, a "detective's casebook" visual design, and the **Lab**, where you set up any position and the engine explains its history. Everything runs in your browser; no server is needed yet.

Code: [apps/web/src/](../../apps/web/src/). The Lab is in [features/lab/](../../apps/web/src/features/lab/), the board in [components/Board.tsx](../../apps/web/src/components/Board.tsx), and the engine worker in [worker/](../../apps/web/src/worker/).

## 1. The shape of the app

- **React + React Router.** Each route is a lazily loaded module ([router.tsx](../../apps/web/src/router.tsx)), so a visitor to the home page doesn't download the board or the Lab. The main bundle is 116.65 KB gzipped; opening `/lab` adds the Lab and board chunks, about 144 KB of JavaScript in total.
- **Tailwind with design tokens.** Every colour is a CSS variable ([styles/index.css](../../apps/web/src/styles/index.css)): "paper" tones in light mode, "ink" in dark mode. Tailwind classes like `bg-card` and `text-ink` read those variables, so switching theme means changing one attribute, `data-theme` on `<html>`. Even the chessboard's squares are drawn in CSS from the same tokens (a `repeating-conic-gradient` makes the checkerboard).
- **Theme without a flash, and without inline script.** The theme has to be applied *before* the page first paints, or dark-mode users see a white flash. The usual trick is an inline `<script>` in `<head>`, but a strict Content Security Policy (Phase 9) forbids inline scripts unless you add `'unsafe-inline'` or hashes. So [public/theme-init.js](../../apps/web/public/theme-init.js) is a tiny *external* script loaded with a plain `<script src>` (not `async` or `defer`). The browser blocks rendering until it runs, which is exactly what we want here.

## 2. The engine in a Web Worker

Analysis and the solver are synchronous CPU work: seconds of searching that would freeze the page on the main thread. So they run in a **Web Worker**, a background thread with its own event loop.

- **Comlink** turns the worker into an async API: `await engine.analyze(fen, depth)` sends a message, and the worker runs [worker/api.ts](../../apps/web/src/worker/api.ts) and posts the result back. Progress for Prove comes through a Comlink *proxy*, a callback the worker can call across threads.
- **Cancelling.** A synchronous search never checks its message queue, so you can't send it "stop". The only way to stop it is `worker.terminate()`, then creating a fresh worker for the next call. [worker/client.ts](../../apps/web/src/worker/client.ts) wraps that: `cancel()` terminates, rejects every call in flight with a `CancelledError`, and the UI shows "Cancelled" instead of an error.
- **Two workers.** The Lab has one worker for analysis and one for Prove, so editing the position while a long proof search runs still gets an instant analysis.
- **A subtle bug, found by an end-to-end test:** after Cancel, progress messages the worker had *already posted* were still waiting in the main thread's queue. They arrived after the cancel and flipped the UI back to "Searching…". The fix: once a run is cancelled, its late progress is ignored ([useEngine.ts](../../apps/web/src/features/lab/useEngine.ts)).

## 3. React state that can't go stale

Two React ideas carry most of the Lab:

- **Derive, don't copy.** `useAnalysis` doesn't keep an "analysis status" that effects must keep in sync. It keeps only the last *finished* result and the request it belonged to (position + depth). The status is computed during rendering: if the finished result is for the current request it's "done"; otherwise it's "running", with the previous result shown dimmed. A stale result can never be shown as current, because it's labelled with the request it answers.
- **Tag state with the position it belongs to.** A highlighted note or a proof belongs to one position. Instead of an effect that clears them when the position changes (which React's lint rightly flags, because it causes an extra render with stale data), they're stored together with their FEN and simply ignored for any other FEN.

## 4. The board wrapper

[Board.tsx](../../apps/web/src/components/Board.tsx) wraps **chessground**, Lichess's board library, which manipulates the DOM itself. The rule: create it once when the component mounts, update it with `set()` when props change, destroy it on unmount. Two lessons:

- Chessground draws coordinates only when it's created, so the *first* config must already be complete. Passing it later via `set()` left coordinates on boards that shouldn't have them.
- Every `set()` redraws the board, and a redraw drops a piece being dragged. Callers often pass a new but equal array (`highlights={[]}`), so the config is built from *content keys* (`highlights.join(' ')`) rather than array identity.

## 5. The Lab

- **Editing.** Drag pieces on the board (free mode; drag off to delete), drag new pieces from a palette, or click a palette piece to arm "click-to-place". That lays 64 transparent buttons over the board, which is also how keyboard users place pieces (Tab to a square, Enter). The FEN field accepts partial FENs ("placement w") and shows the engine's parse error inline.
- **Report.** The verdict always comes as an icon, a word and a colour together (never colour alone). Detective notes group repeated findings, and hovering or focusing a note highlights its squares. Last moves list every retraction with its viability and a "Take it back" button. Prove searches up to 16 plies and plays the proof back with a scrubber (a range input, so arrow keys work).
- **Links.** The position lives in the URL (`/lab?fen=…`). Edits *replace* the history entry (so Back doesn't step through every drag), while take-backs and examples *push* one (so Back undoes them). "Copy link" copies it; "Open in Lichess" opens Lichess's editor with the same FEN.

## 6. Testing a UI you can see

- **Component tests** (Vitest + Testing Library) render the report with *real* engine reports, and check the behaviour: grouping, highlight on hover and focus, take-back, the proof player. Chessground needs real layout, so tests swap the board for a stub that exposes its props as data attributes.
- **End-to-end tests** (Playwright) run against the production build in Chromium: every example's verdict, pasting a FEN, dragging from the palette, click-to-place, take-back with Back, Prove, Cancel, Copy link, every route at 360 px with no horizontal scroll, axe accessibility scans in both themes, and a keyboard-only Lab session.
- **Screenshots for review.** `pnpm --filter @retrograde/web shots` photographs 11 states at 360 and 1280 px in light and dark mode. Looking at them found what tests couldn't: coordinates outside the board, black palette pieces invisible on dark buttons, a last-moves list squeezed to one word per line on phones, and "…" splitting from its move at line breaks. Three rounds of shoot, look and fix got the list to empty.

## Interview questions you should be able to answer

- *Why a Web Worker, and how do you cancel work in it?* To keep the page responsive; and you can't interrupt a synchronous loop, so you terminate the worker and start a new one.
- *What's the race when you cancel a worker?* Messages it already sent are still queued for the main thread; ignore results and progress from runs you've abandoned.
- *How do you avoid stale async results in React?* Label each result with the request it answers and derive the displayed state from that, instead of syncing state in effects.
- *How do you avoid a theme flash under a strict CSP?* A blocking external script in `<head>`, not an inline one.
- *How do you make a drag-and-drop board accessible?* Give every action a keyboard path (the FEN field, click-to-place squares as buttons), describe the board in words, and never signal with colour alone.
