# C-004 One action: one condition, one outcome, carried out by people or automatically
priority: high        status: accepted by the owner 2026-10-05 ("yeah we can make it like this. also make step 2 and 3"); step 1 WP-1045/524/615, step 2 WP-1046, step 3 WP-1047
date: 2026-10-05   lead: c   work packages: none yet   touches: R1, R3, R5, R7, R11, R13 (H2, H3, H4), R15 / docs 05, 06, 01 / builder

## Context
In the demo walkthrough the owner could not tell tasks, rules and conditions apart ("rules right now sound like conditions for tasks to me", "is a notification now not an automation but a task that runs automatically?"). He proposed the model: **every action is a condition plus an outcome; the only difference is who carries it out once the condition holds, a person or the system.** He asked for it to be verified, researched and solved ("the less concepts the easier for people").

Today one automatic step is spread over three places. Mängelmelder, `fixtures/golden/templates/maengelmelder/1.0.0.yaml`:
- a task `eskalieren` with `when: "actor.kind == 'system'"`, which is "nobody may press this" written as a condition (:141-146);
- a rule `eskalation_nach_frist` with a trigger (`on`), a second condition (`when`) and `run: eskalieren` (:197-200);
- in the builder, a "Regel" whose own task shows as an ordinary button (`packages/builder/src/v3/canvas/model.ts:41-51`, `v3/catalog/inventory.ts:63-83`).
"Who may" is also written several times: in the task `when` (`'x' in actor.roles`), in the type's `permissions.create/write/delete`, and in `roles.app.shortcuts`. The warnings `task_field_not_writable` and `task_role_cannot_write` (docs/05:274-275) exist only to catch these copies disagreeing.

## Verification (engine on main f3e87977a)
- **A task is already condition plus outcome.** `when` gates it and `then` writes. A rule writes nothing itself: it plans its task as a system run through the same path as a submitted run (`core/src/plan/rules.ts:1-21`; F3, R3).
- **"A trigger is a condition becoming true" exists.** `on: { when }` fires once on false → true and re-arms by itself (docs/06 "Edge trigger").
- **Person and system read the same condition differently.** For a person it is *level*: the action is offered while the condition holds. For the system it is *edge*: it acts once when the condition starts to hold.
- **Limits.**
  - Time alone changes nothing, so time needs a timer (`elapsed`, `schedule`).
  - "After task X" is an event, not a state: `massnahme_bei_schaden` fires on every `kontrolle` with vitality ≥ v3.
  - An edge is judged only on features the run touched, so a change to a related feature alone never fires (docs/06:133).
- **Prior art.**
  - CMMN, the case-management standard v3 and v4 lean on: a task is enabled by a sentry, and its **ManualActivationRule** decides whether a person starts it or it starts by itself.
  - BPMN: the user task and the service task are the same box with a different marker.
  - Statecharts (XState): the same guarded transition is either event-driven or `always`.

## Proposal (revised)
**Concept (builder words):**
- **Aktion** = **Bedingung** (one, shared) + **Ergebnis** + **Wer**.
- **Wer** is a list of roles (people may press it), **automatisch** (the system does it), or both.
- "Regel" and the separate "Automatisierungen" list go from the admin UI. Where an expression shows, admin-visible text calls it "Ausdruck" ("Regelsprache" contains "Regel"); developer docs keep "rule language" (R5).

**Project file:**
```yaml
tasks:
  zuweisen:
    who: [sachbearbeiter]                 # people with these roles may press it
    auto:                                 # and the system does it by itself (keyed: one entry per cause)
      nach_bewertung: { after: bewerten }
    when: "self.status == 'offen'"        # ONE condition, for people and the system
    form: { zustaendig: { required: true } }
    then:
      - set: { status: "'zugewiesen'", zustaendig: "form.zustaendig ?? self.bezirk.leitung" }
  eskalieren:
    auto:
      frist: { elapsed: { from: self.gemeldet_am, after: "days(inputs.eskalation_tage)" } }
    when: "self.status != 'erledigt' && self.eskaliert == false"
    then:
      - set: { eskaliert: true, prioritaet: "'hoch'" }
```
- **`who`** lists the roles that may run the task. **No `who` means no person may run it**: the permission check refuses a participant or admin run of a task without `who`, and a test proves it. That closes the hole the strategist found, where removing `actor.kind == 'system'` from a task without `when` would have opened it to everyone (`scope.ts:262`).
  - `actor.roles` leaves task conditions in the templates.
  - Because participants write only through tasks (R3), a role's write and create rights can be derived from the tasks it may run (survey item 1; A-009's next step).
  - `permissions` keeps `see` and `visible_when`. Whether `write` stays as a separate safety net for `then.set` on other features (`of`, bound features) is decided in the work package, by test.
- **`when`** is the one shared condition: state only (stage, values, time windows). It applies to every run, person or automatic. The strategist's point that today's task guards (`bewerten`: `status == 'offen'`, `massnahme_anlegen`: `stage == 'massnahme'`) must keep applying to system runs holds by construction.
- **`auto.<name>`** is a keyed map, so each entry can be overridden, hidden and locked on its own; overlay lists are atomic (docs/05:307). Its name shows in the trace, the protocol and the timers table. Timing is one of (registry `AUTO_TIMING_KINDS`, replacing `RULE_TRIGGER_KINDS`):
  - default, when the shared `when` becomes true (edge);
  - `after: <task>`, after that task ran on the same subject (event; compile refuses a task offered on another type);
  - `elapsed: { from, after?, offset? }`;
  - `schedule: <cron>` + `idle` (compile refuses `schedule` without `idle` on a task offered on a type, because it has no subject).

  An entry may add its own `when`, which is ANDed with the shared one (for example "only when the district has a manager"). An edge entry on a `$map`/`$none` task is refused.
- **Values:** an automatic run has no form. Its values come from `then.set` expressions, for example `form.zustaendig ?? self.bezirk.leitung`. `with` goes. If a task needs a required form field for people, compile checks that `then.set` covers it for automatic runs. The strategist found that `with` is checked only against properties, not form fields (`run.ts:78-88`).
- **Only the task's own automation counts as automatic.** The `who` check is skipped only for a run caused by one of the task's own `auto` entries. Other system runs (seed, move, template migration) keep their existing paths. This is a change in plan's scope check, and it is stated.

**Compile:**
- A compiled `automations` table (`tasks.<t>.auto.<name>`) replaces the raw `config.file.rules` reads, with problem paths that point into the file.
- Plan's rule runs, the depth limit, offline prediction of event entries and server-only timers (0020) work as today on that table. Their readers move from `file.rules` to it.
- The fire.ts duplicate (TODO WP-556) is closed in the same work.
- No back-compat for `rules:` (R11). The golden corpus is converted in the same change.

**Builder (v3's layout):**
- One action panel: **Bedingung**, **Ergebnis**, **Wer** (role chips plus an "Automatisch" chip with its timing). The form section shows when roles are set.
- Automatic actions keep v3's distinct canvas node: amber, a bolt, an "auto" badge and dashed arrows. Actions with roles show as buttons. An action with both shows both marks.
- The catalog lists actions with a filter (Alle · Personen · Automatisch). Conditions show as readable chips, with the expression editor behind a chip.

## Owner answers (2026-10-05)
- **Templates:** a project may change anything from its template, including adding automatic actions to template tasks. Every change must be visible in the change view (C-004 follows the change list and diff of WP-506).
- **Deploy:** editing an automatic action is a change like any other. The deploy offers keep/move (migration) for running objects.
- **End stage:** a feature stays in its end stage. Archiving or soft-deleting it is a separate automatic action (for example 30 days after "erledigt" → `lifecycle: archived`). Without one it stays forever. `process.end` completes nothing by itself. The templates may model the archive action; the engine has the step (`then: lifecycle`).
- **Words:** "Regel" and the separate "Automatisierungen" list give way to one "Aktion" (from "the less concepts the easier"; to be confirmed). This deliberately departs from v3's separate list (R15).

- **No separate "Wer" in the builder** (2026-10-05, after trying step 1): "we can remove the who tab from the tasks sheet... that is unnecessary since we have it already within condition". Roles stay part of the Bedingung in the UI. Step 3 (a `who` key in the file) is reopened: the permission fix (an automatic-only action must not be pressable) and derived write rights still need a home, but the builder shows roles inside the condition.

## Conversion of the golden corpus
Five template files carry rules: baumkataster 1.0.0, 1.1.0 and 2.0.0, maengelmelder 1.0.0, veranstaltung 1.0.0.
- Every `on: task.<k>` becomes `auto.<name>: { after: <k> }`.
- Every `elapsed` becomes `auto.<name>: { elapsed }`.
- Rule `when` becomes the entry's `when`, and `with` moves into `then.set`.
- Task conditions lose `actor.kind == 'system'` and `'x' in actor.roles`, and gain `who`.

Behaviour stays the same. The upgrade and overlay specs and the `fixtures/golden/scenarios/rules/*` scenarios move with it. Dev and demo databases need a re-seed, because timers pinned to old rule keys go stale (`timers.ts:310`).

## Size
- 74 non-test files read the config's rules today:
  - builder 41: 10 of them the "Regel" editor, which is replaced; 3 are dead lens code;
  - core 23;
  - migrate 6;
  - server 3;
  - web 1.
- Most reads are a path or a key. Plus specs and fixtures. That is wide but mechanical; the plan and fold runtime keep their logic.
- `who` and the derived write rights are the larger part (perms plus compile), and can land as a second step after `auto`.

## Extensibility check (R13)
- H2 (dispatch): automatic assignment becomes an action with `auto`.
- H3 (role apps): `who` is the one place a role's actions are listed, which is what a role app needs.
- H4 (AI assistants): one concept to explain and generate.
- H1, H5, H6 are untouched, and external writes are still runs.
- Seams:
  - `AUTO_TIMING_KINDS` (a registry entry per timing);
  - the keyed `auto` map;
  - a future non-writing outcome ("send a message"), which becomes a `then` step kind, not a concept.

## Order (strategist)
1. **Builder first, file unchanged:**
   - one action panel;
   - a rule shown together with its own system task as one automatic action;
   - "Regel" no longer in three meanings;
   - system-only tasks marked.

   Reversible, and it fixes what confused the owner.
2. **`auto` in the file** (this record), converted golden corpus, compiled automations table.
3. **`who` and derived write rights**, with the permission test from step 2 kept.

## Log
- 2026-10-05, step 2 landed (WP-1046): `rules:` is gone; `tasks.<t>.auto.<name>` is the one place, `compile()` builds the table `config.autos` (identity `<task>.<name>`), the four new `auto_*` problems are registered, the golden corpus and the v3 migration use `auto`, and the builder reads and writes the new paths. Behaviour is unchanged (the golden `rules/*` scenarios pass with renamed ids only). Locks (fix round): a lock on `tasks.<t>` covers the template's own `auto` entries but never stops a project adding its own new entry (`lockedBy`, `template/lock.ts`, shared by merge and the builder).

## Cost to change later
- **now:** as in Size.
- **after real projects:** every project file and overlay with `rules.` paths needs a conversion, and v3-migrated projects too. Before the pilot is cheapest.
- 2026-10-05, step 3 landed (WP-1047): `tasks.<t>.who` (roles, `admin`, `import`; none = only the system), one shared `when`, automatic values from `then.set` (no `with`; compile problem `auto_value_missing`), `deriveRights` shows the rights the tasks grant. The stated `permissions` stay (see C-005).
