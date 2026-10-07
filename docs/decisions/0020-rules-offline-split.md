# 0020 · Event rules are predicted offline; time rules run on the server

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** The owner wants automations offline where possible.
- **Decision:** Rules triggered by runs or property changes run in core on the device (predicted) and on the server (authoritative). `elapsed`/`schedule` rules run only on the server, via `timers`.
- **Rejected:** Server-only rules (as in v3).
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
