# C-005 `who` on tasks replaces the CEL task audience (supersedes the audience part of A-009)
priority: medium        status: provisional
date: 2026-10-05   lead: a   work packages: WP-1047   touches: H2, H3, H6, R13

## Context
A-009 kept the task audience as CEL (`'x' in actor.roles` in `tasks.<t>.when`). C-004 (owner 2026-10-05) makes one action carried out by people or the system. The audience therefore became its own key.

## Options
- A) Keep the audience in `when` and the system as `actor.kind == 'system'`. Two mechanisms for one question.
- B) `tasks.<t>.who`: role keys plus the reserved `admin` and `import`. No `who` means no person may run it. `when` is one condition for every run.

## Chosen (provisional)
B. `actor.roles` stays in the rule language (A-009 part A holds). Write rights stay as `permissions.*`; `deriveRights(config)` shows the rights the tasks alone would grant, a subset of the stated ones for every golden template. Dropping the keys is a later step. **Admission by actor kind (WP-619):** a participant needs a role in `who`; an admin account `admin` or a role in `who`; an import `import` or a role it holds that is in `who` (a task without `who` refuses it, like a person); the system skips `who` only for the run of one of the task's own `auto` entries (`Run.auto` names `<task>.<name>`, set by `fireOne` and by the timers; it is never stored or accepted from a client), every other system run is checked like any actor. Seam: `whoAdmits` (`core/perms/who.ts`) is the only reading of `who`; an active role (H3) or teams (H2) extend it there.

**Owner 2026-10-05 (via lead-c, WP-1060).** A new person action ("+ Aktion" > "Von Personen": Schaltfläche, Formular) and a new "Eingang" are created with `who` = every role key of the project at that moment plus `admin` (like v3, where an empty role list meant everyone; there is no `$all` form in the grammar and `import` is not added). "Automatisch" writes no `who`. The file rule is unchanged: no `who` means nobody (`whoAdmits` untouched). Helper: `allRolesWho` in `core/perms/who.ts`.

## Cost to change later
now: one function and the compile check · later: removing `permissions.*` needs the surplus rights (admin edits, read-only roles) expressed as tasks first.
