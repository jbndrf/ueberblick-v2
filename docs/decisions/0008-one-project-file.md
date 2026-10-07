# 0008 · One project file: Zod schema, versioned, compiled

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** Config was spread over collections and two YAML formats.
- **Decision:** A single YAML document per project (template or overlay). The Zod schema is the source for JSON Schema, builder forms and docs. `schema:` version plus migrators. ID-keyed maps; comment-preserving round trip; revision hash; no status in the file. `compile()` does semantic checks and diff.
- **Rejected:** CUE/Pkl/KCL (break the builder round trip), DB rows as source of truth.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
