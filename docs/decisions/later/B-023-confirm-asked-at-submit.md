# B-023 A task's `confirm` is asked at Absenden when the task has several steps
priority: low        status: provisional
date: 2026-10-03   lead: b   work packages: WP-730   touches: R15

## Context
The task field `confirm` (owner-approved in `docs/process/rebuild.md:110`) had no timing. v3's participant app never asked: the builder stored `visual.requires_confirmation` (`TaskConfigSidebar.svelte:309-318`), but the participant code read only `button_label` and `button_color` (`WorkflowInstanceDetailModule.svelte:305,338-339`; register `p3-feature-forms.md:61` and `:130`). v4 asked on the tap, so "Änderungen speichern?" came before the quick edit and the location step, and Absenden submitted without a question, which contradicts `docs/05` ("asked before the run is submitted").

## Options
- A) Ask on the tap for every task. Contradicts docs/05; the question precedes the edit it is about.
- B) A task with several steps asks when the last step is sent (Absenden); any other task asks on the tap, because tap and submit are one moment there.
- C) Ask at the submit for every task. A one-tap task would need a confirm step of its own, an extra screen.

## Chosen (provisional)
B, because docs/05 is the written contract and the question is about what is saved. The seam: the timing is one function, `confirmTiming` (`apps/web/src/lib/participant/feature/task-presentation.ts`); the steps host (`StepFlow`, prop `confirm`) only asks when handed a text. Switching to A is one line (`confirmTiming` returns `'tap'`).

## Cost to change later
now: one line plus the two tests that name the timing · after the build: the same, no data change (`confirm` stays a task field).
