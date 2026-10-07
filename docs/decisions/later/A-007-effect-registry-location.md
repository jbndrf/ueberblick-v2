# A-007 Outbox effect registry lives in the server for now
priority: low        status: provisional
date: 2026-09-29   lead: a   work packages: WP-107   touches: docs/03 (registry lists defineEffect), R1

## Context
docs/03 lists `defineEffect` among the core registries. WP-107 built the outbox with `defineEffect` in `packages/server/src/outbox/effects.ts`, because `then` steps cannot yet declare effects (A-002 item 5) and nothing in core needs effect kinds.

## Chosen (provisional)
Keep it in the server until `then` gains effect steps. Then move the effect **kinds** (keys, input schema) into the core registry so `plan` can emit outbox rows and `compile` can check them; handlers stay in the server. The seam: the registry shape (`key`, `description`, handler port) is already the core `defineRegistry` shape.

## Cost to change later
small: move the kinds file, re-export; handlers unchanged.
