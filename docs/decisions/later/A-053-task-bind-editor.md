# A-053 The task pane edits a task's `bind` ("Verknüpfte Objekte")
priority: low        status: provisional
date: 2026-10-04   lead: a   work packages: WP-458   touches: H3, H4, R1, R3

## Context
A5 linked form fields (A-047, WP-434/449) need a task `bind` (docs/05: `bind: { area: self.flaeche }`, cardinality one). The builder had no editor; WP-449's picker sent the admin to the Code view. v3 had no binds (it used the parent implicitly, `FormEditorView.svelte:486-499`), so there is nothing to port; this is an engine-required setting.

## Options
- A) A section "Verknüpfte Objekte" in the task pane's Definition tab: rows name + relation (a one-relation or reference property of the subject type, target type shown), add, rename, remove, written through the task ops.
- B) A separate tab. A fifth-to-sixth tab for a rarely used setting crowds the v3 tab set.
- C) Leave it to the Code view (status quo).

## Chosen (provisional)
A, because the setting belongs to the task and the Definition tab is where its other settings sit (R15: where the work happens). Only `self.<relation>` expressions are written; one the list cannot say (a path of several steps) shows as read-only text. Remove and rename are refused while form entries `<bind>.<property>` use the bind (they are named in place; the admin removes the fields first): the simpler of "refuse" and "remove the fields too". A `then` step or expression that still reads the bind is stopped by the checker like any edit (`planEdit`).

## Cost to change later
One component (`v3/task/BindSection.svelte`) and one pure ops module (`v3/task/bind-ops.ts`); moving it to a tab or offering "remove with its fields" changes only those.
