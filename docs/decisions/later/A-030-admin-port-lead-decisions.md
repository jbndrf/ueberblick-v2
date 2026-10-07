# A-030 Small placement decisions for the v3 admin port
priority: low        status: provisional
date: 2026-10-01   lead: a   work packages: step-3 and step-4 UI WPs   touches: docs/ia-map.md

## Context
Porting v3's admin pages (`docs/research/v3-parity/plans/lead-a-steps-3-4.md`) needs a few small choices that v3's code and the owner decisions settle, or that are cheap to undo. The bigger ones are in QUESTIONS.md "Open for owner" (A1–A4).

## Chosen (provisional)
1. **"Aktiv/Inaktiv" per Objektart is dropped.** Its purpose was to keep a type unavailable while it is being built. The draft plus Q17 (nothing is live before Veröffentlichen) serve that purpose now.
2. **The account menu's "Einstellungen" item is dropped.** In v3 it led nowhere useful (register a1 bug 4). Theme and language are already in the menu itself.
3. **"Tabellen" in the sidebar lists the Objektarten without geometry and without a process** (comparison §10.7: "a type without geometry and with a single stage is a table").
4. **A role's quota ("Max. … pro Teilnehmer:in") goes through the draft** (Q16). Only the self-join switch applies at once (Q14).
5. **The CSV import's stage mapping stays stage-only**, as in v3.
6. **Until the deploy overview (S4-18) lands, "Veröffentlichen" is a simple confirm.** A plan with breaking changes says so and points to the deploy overview once it exists.
7. **The data page's "Builder" button opens the ported workflow builder** of that Objektart.
8. **Releases and Fork become "Versionen"** (comparison §10.8). The fork's draft badge and fork entries are gone (§10.18).

## Cost to change later
Each is one UI element or one label.
