# 0006 · One pure core package with ports

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** Eight hand-synced twins in v3.
- **Decision:** `packages/core` contains all domain logic, performs no I/O, and receives storage, clock, IDs and blobs through ports. Enforced by lint (restricted imports) and dependency-cruiser.
- **Rejected:** Shared utils imported ad hoc; code generation.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
