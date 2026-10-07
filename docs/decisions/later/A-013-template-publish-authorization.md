# A-013 Template publishing: any project admin may publish (templates are global)
priority: medium        status: provisional
date: 2026-09-30   lead: a   work packages: WP-114, WP-210   touches: O10, O12, docs/09 security

## Context
WP-210 added "publish template" to the builder's Versions lens. Templates are global (control.db `templates`), not per project, so a publish affects every project that extends that template's key. A-008 grants the admin API to any project membership, and A-010 keeps project and admin creation to the operator CLI.

## Options
- A) Any project admin may publish a new template version (chosen). Minor versions are checked for breaking changes (core `template.breakingChanges`); major versions don't affect projects until they upgrade.
- B) Only a server-level "template publisher" role, or the operator CLI (`npm run admin -- publish-template`).

## Chosen (provisional)
A, cheapest to undo, and it matches A-008. Projects only move to a new template version through an explicit upgrade, so a publish cannot silently change another project. The seam: `authorizeAdmin` (A-008) plus one `authorizePublish` check in the publish route, so B is a single function change.

## Cost to change later
small: one authz function and a role (and a builder hint for non-publishers).
