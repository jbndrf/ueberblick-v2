# 00 · Vision

## What Überblick is
Überblick is an open-source platform for **geo-referenced features and the tasks that change them**. Typical projects:
- a municipal **tree cadastre** (trees, areas, inspections, measures)
- **defect reporting**
- **event approvals** with inspection files
- regional **directories** such as "Bio einkaufen in Bonn"

These are only *examples of domains*. **v3 projects are deliberately not included** as fixtures or targets. They were built for v3's limits and would make the scope look smaller than it is. v4 is designed for the future scope in this document and in `02-foundations.md`: templates with upgrades, cross-feature tasks, derived spatial relations, multilingual content, offline rules, interop. The golden corpus (`fixtures/golden/`) is written from those capabilities, not reverse-engineered from old projects.

It has two surfaces, served by one app:
- **Participant app.** Mobile-first and offline-capable, used by field workers outdoors, often on cheap Android phones, with bad network, gloves and sunlight. Its UI is *generated from the project config*.
- **Admin.** v3's admin area (projects, participants, roles, relations, settings, data tables) and v3's workflow builder, on the new engine: where a project is set up, tried out in the preview, deployed, and where data is reviewed (`docs/process/rebuild.md`).

Participants log in with a QR code (no password). Admins log in with an account, and later through OIDC.

## What v4 must achieve
1. **The whole project is one config file.** It is a template version plus an overlay, editable by the builder, by LLMs over MCP, and by hand, all with the same result.
2. **Templates with safe upgrades.** The owner publishes a template (e.g. Baumkataster v1). A municipality customises it. The owner ships v2 without breaking that customisation. See foundation F13 and `05-config-format.md`.
3. **Performance at 50k+ features per project**, and fully offline, with an honest sync state. The v3 dbperf work proved the numbers: a 60k-feature snapshot in about 18 s, a delta in about 4 ms, first map markers in under 5 s. v4 must not regress on them.
4. **Per-property permissions**, enforced identically in sync, API and writes.
5. **Geometry with meaning.** Spatial rules and derived relations ("this tree lies in that area"), correct CRS handling, and interoperability with QGIS and ArcGIS (OGC API Features, GeoPackage).
6. **A codebase made for agentic development.** One way to do each thing, rules enforced by tools, tests as the specification.

## Non-goals (v4.0)
- Real-time collaborative editing (CRDTs). Field data is single-writer per property, and the server is the authority.
- A general-purpose low-code app builder. We model features, tasks and views, not arbitrary apps.
- User-supplied scripts in config. Extension happens through registries in code.
- BPMN/CMMN compliance. We borrow concepts and don't implement the standards.
- Postgres or any heavyweight server dependency. The target is one small process plus SQLite files.
- Native apps. The PWA comes first, with a Capacitor wrapper only when a customer needs background upload or external GNSS.

## Who decides
The owner (Jan) decides everything listed in `decisions/open.md`, and every change to the glossary, the foundations or an accepted decision record. Agents implement.
