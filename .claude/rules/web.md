---
paths:
  - "apps/web/**"
---

# Web app rules

- React function components and hooks. Server state goes through TanStack Query; avoid a global client store unless a real need appears (record it in DECISIONS.md).
- API types come from `openapi-typescript` output. Never hand-write API request/response types.
- Analysis, retraction search and the solver always run in the Web Worker (`src/worker/`). Only cheap engine calls (FEN parsing, legal move destinations for the board) may run on the main thread.
- Cancel long engine tasks by terminating the worker and creating a new one. A synchronous search loop can't receive messages.
- The chessground wrapper lives in `src/components/Board.tsx`. Create it once per mount, update it with `set()`, and destroy it on unmount.
- Mobile-first. Every screen must work at 360px wide with no horizontal scroll.
- Accessibility: everything keyboard reachable, visible focus, labelled controls, `aria-live` for guess feedback, colors always paired with an icon or letter.
- Feedback colors and the share text use the exact symbols in SPEC §8.3 and §8.6.
- Tests: Vitest + Testing Library for components and hooks; Playwright for end-to-end flows in `apps/web/e2e/`.
