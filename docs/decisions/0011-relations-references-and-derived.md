# 0011 · Relations = references + derived edges; bind follows declared relations

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** Five relation mechanisms in v3; spatial relations were impossible.
- **Decision:** A reference is a property of type `reference`. A derived relation is a `derive:` rule (e.g. `within`), recomputed on geometry change. Both are stored in `edges`. A task's `bind` may only traverse declared relations. Parent/child is a view.
- **Rejected:** Arbitrary queries in bind (unpredictable offline availability and permissions).
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
