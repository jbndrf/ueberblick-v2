# 0009 · Templates are base + overlay with key-wise three-way upgrades

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** The owner's core need: serve a template, let customers edit it, ship v2 without breaking them. v3 copies (sandbox clone/pushback) lost provenance.
- **Decision:** A project is `extends: template@major` plus overlay (add / override / hide / inputs). Keys are the contract. Minor versions must be non-breaking, checked by `breakingChanges()`. Major upgrades go through three-way merge with conflict UI, and template migrations run as system runs.
- **Rejected:** Copy-on-create with manual re-sync, git-style text merges of whole files.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
