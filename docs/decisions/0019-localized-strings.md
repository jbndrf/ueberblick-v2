# 0019 · LocalizedString for all project content from day one

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** v3 content was single-language; migrating later is expensive.
- **Decision:** Every label, help text and message in config is `string | { [locale]: string }` with a default-locale fallback.
- **Rejected:** Translating later.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
