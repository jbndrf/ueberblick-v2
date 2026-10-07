# 0003 · SQLite with a fixed platform schema, one DB file per project

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** The owner wants a light footprint (no Postgres RAM cost). Per-project isolation eases export, backup and deletion.
- **Decision:** SQLite (WAL) with the schema in `docs/04-data-model.md`. `control.db` holds accounts, credentials, sessions and templates. Project changes never alter tables; the only config-driven DDL is expression indexes (`index: true`).
- **Rejected:** Postgres/PostGIS, SpatiaLite (native extension burden), per-project generated tables.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
