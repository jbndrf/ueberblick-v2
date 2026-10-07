# 0005 · Observations (O&M) are the truth; no built-in properties; one fold

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** The owner: 'setting an assignee is an observation — there is no native assignee field'. v3 had special paths for stage and geometry.
- **Decision:** An append-only `observations` table (feature, property, result, phenomenon_time; procedure and observer via the run). Only `$type` and `$deleted` are reserved. `core.fold` is the only definition of current state.
- **Rejected:** Built-in assignee/due/stage columns; mutable current-value tables as truth.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
