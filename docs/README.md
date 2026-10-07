# docs: the v4 specification

Read in this order. Everything with a number is **binding**. `research/` and `history/` are background.

| Doc | What it answers |
|---|---|
| [00-vision.md](00-vision.md) | What Überblick is, who uses it, what v4 must achieve, and non-goals |
| [01-glossary.md](01-glossary.md) | The only allowed vocabulary, plus banned v3 words |
| [02-foundations.md](02-foundations.md) | The 13 architectural rules and the v3 problem each one removes |
| [03-architecture.md](03-architecture.md) | Packages, ports, dependency rules, the life of a run |
| [04-data-model.md](04-data-model.md) | SQLite schema (fixed), fold semantics, sync cursor |
| [05-config-format.md](05-config-format.md) | The project file: template, overlay, feature types, tasks, rules, views |
| [06-rule-language.md](06-rule-language.md) | The CEL subset: syntax, types, functions, the four backends |
| [07-sync-and-offline.md](07-sync-and-offline.md) | Sync protocol, run queue, prediction, rebase, iOS realities |
| [08-builder.md](08-builder.md) | The builder as an IDE for the project file |
| [09-standards.md](09-standards.md) | External standards we follow (OGC, ODK, MapLibre …) and the "before sales" list |
| [10-reference-map.md](10-reference-map.md) | Where things are in `reference/` (v3): what to learn, what never to copy |
| [11-future-capabilities.md](11-future-capabilities.md) | The horizon every design must leave room for: 3D/BIM, dispatch, role apps, AI assistants, command centre, external GIS |
| [12-performance-budgets.md](12-performance-budgets.md) | Device and server budgets. They are acceptance criteria. |
| [13-ux-principles.md](13-ux-principles.md) | UX bar and the purpose and journey check required before any UI |
| [ia-map.md](ia-map.md) | Living map of where every UI function lives |
| [decisions/](decisions/) | Decision records: accepted ones, `open.md` (owner decisions still pending) and `later/` (later topics: provisional decisions the owner reviews after the build) |
| [process/](process/) | How work is orchestrated: the rebuild mission and checkpoints (`rebuild.md`), three Opus leads (lead-a, lead-b and lead-c, the steward) and the strategist (an Opus subagent of lead-a), Sonnet implementers and reviewers, course checks, docsync and logwatch (local model: docs and logs, never code review), metrics, roadmap, the dev server ([`process/dev.md`](process/dev.md)) |
| [user/](user/) | **User documentation** (admins, participants). Kept current with every user-visible change (R16) |
| [research/](research/) | The raw research reports (v3 code analysis, standards, prior art) and the three concept pages as HTML |
| [history/](history/) | The full planning conversation with the owner (why things were decided) |

**When the docs conflict:** decision records win over numbered docs, and numbered docs win over research and history. If you find a conflict, report it to the lead. Don't resolve it silently.
