# 0017 · Tools are plug-ins with a declared manifest

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** 'Tool' meant five things in v3.
- **Decision:** `defineTool({ type, schema, mount, produces, component })`. Outside tasks tools only read or start tasks; inside tasks they only produce field values. First-party plug-ins only in v4.0. The API is extracted from 2–3 real tools (photo, draw, measure), not designed up front.
- **Rejected:** WordPress-style hooks with full access.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
