# 0012 · One permission section, compiled three ways

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** Three encodings in v3.
- **Decision:** Per feature type: `see`, `create`, `write` (per property), optional `visible_when`. `core.perms` compiles them to an SQL predicate (sync, API), a property allowlist and a planner check. Deny by default; matrix test in CI.
- **Rejected:** Hand-written checks per endpoint.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
