---
id: WP-000
title: Short imperative title
phase: 1
status: todo            # todo | ready | in-progress | review | done | blocked
depends: []             # e.g. [WP-010, WP-020]
owns:                   # the ONLY paths this work package may change
  - packages/core/src/example/**
model: sonnet
major: false            # true = schema/contract/protocol/persistence/navigation → triggers a course check after merge
---

## Goal
One or two sentences: what exists afterwards that didn't before.

## Read first
- `docs/…` (only what is needed)
- `reference/…` (behaviour to learn from, if any)

## Contract
The types and functions this work package implements or consumes. Link the contract file. If it's missing, the lead writes it before dispatch.

## Acceptance (each item is proven by a test)
- [ ] …
- [ ] `npm run check` green

## Extensibility (R13)
Which of H1–H6 (`docs/11-future-capabilities.md`) this work package's shapes touch, and what must stay open. Write "none" if none.

## Performance (R14)
The relevant budget lines from `docs/12-performance-budgets.md`, and the benchmark to add (for hot paths). Write "not a hot path" otherwise.

## UX (R15, UI work packages only)
Which role and screen this concerns, where it should live per `docs/ia-map.md`, and the tap budget. The implementer writes the full journey check into the Log before building.

## Docs (R16)
The developer docs and user docs this work package must update. Write "none" only if nothing observable changes.

## Out of scope
What not to do, even if it's tempting.

## Notes
Ideas and questions for the lead, written by the worker.

## Log
Worker appends: date, what was done, surprises, follow-ups.
Lead events (start, review rounds, merged) are not written here. They go to `work/events/<WP>.log` via `npm run wp:event` (`docs/process/metrics.md`).
