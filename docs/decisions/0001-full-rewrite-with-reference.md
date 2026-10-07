# 0001 · Full rewrite; v3 is read-only reference

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** v3 grew around a workflow-type-centred model; config sits in ~15 stores, rules in 3 languages, 8 client/server twins. The owner chose a rewrite.
- **Decision:** Rewrite from scratch in a new repo. v3 source lives in `reference/` (read-only) for behaviour and edge cases only. De-risked by a golden corpus written from the target capabilities, differential tests against v3 behaviour where it matters (planner checks, sync numbers), and vertical slices.
- **Rejected:** Porting code line by line; strangler inside v3; reusing v3 demo projects as fixtures (they would understate the scope, per the owner).
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
