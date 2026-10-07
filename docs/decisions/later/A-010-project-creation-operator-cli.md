# A-010 Projects and admin accounts are created by the server operator via CLI only
priority: low        status: provisional (superseded in part by WP-309: any signed-in admin may create a project over HTTP, `POST /api/admin/projects`; the CLI stays as the operator path)
date: 2026-09-29   lead: a   work packages: WP-114   touches: O10, O12, H5 (command centre), docs/09 security

## Context
WP-114 added the bootstrap (`npm run admin -- create-project|create-admin|add-membership|publish-template`). There is no HTTP API to create projects or admin accounts, and no rule yet for who may call one.

## Options
- A) Operator-only: the CLI on the server host is the only way to create projects and admin accounts (chosen).
- B) A server-level "platform admin" role with an HTTP API and a builder screen.

## Chosen (provisional)
A, cheapest to undo and the smallest attack surface. The seam: `createProject`, `createAdmin`, `addMembership` and `publishTemplateFile` in `packages/server/src/admin/` are plain functions, so B is one authz check (`authorizeAdmin`, A-008) plus thin routes.

## Cost to change later
small: a platform-admin role, three routes, a builder screen (R15 journey check).
