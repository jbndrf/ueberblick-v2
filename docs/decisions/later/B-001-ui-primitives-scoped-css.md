# B-001 UI primitives use scoped CSS on token variables, not Tailwind/bits-ui
priority: medium        status: provisional
date: 2026-09-29   lead: b   work packages: WP-501   touches: R15, principle 10 (admin theming), docs/03 UI stack

## Context
docs/03-architecture.md names Tailwind 4 and bits-ui/shadcn-svelte as the UI stack. WP-501 built the first primitives (Button, IconButton, TextField, ErrorSummary, Sheet, StatusBadge, Icon) with scoped Svelte CSS on `--ub-*` custom properties emitted from typed tokens, and wrote its own focus trap for Sheet.

## Options
- A) Scoped CSS on token variables for primitives; Tailwind only for app-level layout later. Small bundle, tokens are data (admin re-theming), no class soup in primitives.
- B) Tailwind 4 + bits-ui everywhere, as docs/03 says. Faster to add complex widgets (combobox, menus) with tested a11y; larger dependency surface.

## Chosen (provisional)
A for the primitives. Complex headless widgets (combobox, menu, date picker) may still adopt bits-ui when a work package needs them. The seam: `packages/ui/src/tokens.ts` is the only token source, and Tailwind can consume the same `--ub-*` variables through `@theme`, so both can coexist.

## Cost to change later
now: low · after the build: medium (rewrite 7+ primitives' styles; props contract `packages/ui/src/contract.ts` stays)
