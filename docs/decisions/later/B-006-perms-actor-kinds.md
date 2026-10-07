# B-006 Role allowlists bind participants only; admin, system and rule runs are not role-filtered
priority: high        status: provisional
date: 2026-09-30   lead: b   work packages: WP-041, WP-042   touches: F6, R3, H4, security

## Context
Permissions (decision 0012) are role audiences. Runs come from participants, admins (builder, imports, migrations), the system (rules, timers) and later assistants (H4). WP-041 had to decide which actor kinds the role allowlists apply to.

## Options
- A) Role allowlists bind `participant` actors only; admin and system runs pass the permission check (they are still refused by `on`/`when`, form and constraints). Assistants act as their human principal (A-006/H4), so they are participants or admins.
- B) Every actor kind is role-filtered; admins and the system carry synthetic roles that must be granted in every project file.
- C) A per-kind policy in the project file.

## Chosen (provisional)
A. It matches v3 practice and keeps project files simple; rules must be able to change what participants cannot. `when` still applies to all kinds. Seam: `Perms.subjects(actor)` is the single place mapping actors to subjects (PERM_SUBJECT_KINDS), so B or C can be introduced there without touching plan.

## Cost to change later
now: low · after the build: medium (every project file gains grants for admin/system subjects under B). Security note for the owner: an admin account can change any property through runs; audit is the run log.
