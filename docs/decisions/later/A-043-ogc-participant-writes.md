# A-043 OGC writes run as the caller: a participant token or session writes under the participant's own permissions
priority: medium        status: provisional
date: 2026-10-03   lead: a   work packages: WP-402   touches: H6, R1, R3, R13

## Context
Owner Q18: "QGIS gets full access for anything the user may do: participants with their own permissions, and admins with theirs. That includes running tasks through QGIS, which then go through the normal write path as runs." WP-388 (A-037) made a participant token authenticate as the participant principal, but OGC Part 4 writes accepted only an admin and recorded actor kind `admin`.

## Options
- A) **Write as the caller**: drop the admin-only gate; the run carries the caller's own actor, so `core.plan` applies role, `when`, create and field-write permissions and rules exactly as in the app. The server maps the refusal to HTTP, nothing more.
- B) A second permission check in the OGC handler (rejected: a twin of core `perms`, R1).
- C) Run participant writes as `admin` after an own check (rejected: loses the audit trail and the role-bound rules).

## Chosen (provisional)
A. Mapping: OGC item write, then `resolveWriteTask` (A-017, unchanged: `?task=` wins, else the unique available task whose form covers the changed properties), then one run with the caller's actor (kind `participant` and their id; admins stay `admin`).
- **Refusals for a participant** are `403 forbidden` with `<code>: <reason>` and an issue whose `path` is core's refusal path (`permissions.write`, the property, `when`, `on`): codes `not_permitted` and `not_available`. A write where tasks exist for the change but none the participant may run carries it is `403` with path `task`. A write to a collection the participant cannot see is `403` (path `permissions.see`), an unknown collection stays `404`. Every other refusal (`required_missing`, `constraint_failed`, `quota_exceeded`, ...) and "no or several tasks" stay `422`, as for admins; admin answers are unchanged.
- **No widening:** an explicit `?task=` is only a choice among the tasks offered on the type; core `plan` still checks `when` and permissions. A property the task's form does not carry, or a `$`-key, is refused by `plan` (`invalid_input` / `not_permitted`), so a token cannot write more than the same participant could in the app. The oracle spec (`write-oracle.spec.ts`) compares OGC acceptance with `store.submit` of the same run for random role sets.
- **Seam (H6):** the mapping (`write.ts` + `write-task.ts`) is the one place where an external GIS write becomes a run; an assistant or another GIS client reuses it with its own principal and, later, a narrower token `scope` (A-037).

## Cost to change later
low: one status mapping and the removed gate; the principal and the task resolver are unchanged.
