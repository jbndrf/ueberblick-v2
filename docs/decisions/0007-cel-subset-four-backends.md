# 0007 · The rule language is a CEL subset with four backends

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** Seven condition mechanisms in v3; formulas were server-only.
- **Decision:** A CEL-syntax subset, parsed and type-checked once at compile time, with backends evaluate / toSql / explain / toChips. Spatial functions use OGC Simple Features names. CQL2 is accepted at the OGC API through `fromCql2`. Parser implementation: see open decisions.
- **Rejected:** JSONLogic (unreadable), FEEL (weak parity), Rego/Cedar (no spatial functions or too heavy), extending the v3 JSON condition trees.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
