# 0014 · Map styling uses the MapLibre Style Spec

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** v3 had a proprietary `icon_config`.
- **Decision:** Styles are stored as Style Spec. CEL may compute state properties that styles map to icons and colours. The builder offers a simple UI that produces Style Spec.
- **Rejected:** CEL style rules (would reinvent the Style Spec).
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
