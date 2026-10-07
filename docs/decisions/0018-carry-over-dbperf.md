# 0018 · Carry over the dbperf designs: sync, device stores, map, PMTiles

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** The v3 dbperf branch reached 60k features: snapshot ~18 s, delta ~4 ms, first markers < 5 s.
- **Decision:** Port the protocol and designs (`docs/07-sync-and-offline.md`), re-implemented against core ports. These numbers are the regression floor.
- **Rejected:** Adopting PowerSync/Zero/Electric (they need Postgres or conflict with runs).
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
