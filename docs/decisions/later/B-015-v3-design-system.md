# B-015 v3's design system (Tailwind 4 + bits-ui/shadcn-svelte) replaces the scoped-CSS primitives
priority: high        status: provisional (follows the owner's rebuild instruction)
date: 2026-10-01   lead: b   work packages: WP-610   supersedes: B-001   touches: packages/ui, apps/web, every ported screen

## Context
`docs/process/rebuild.md` §4.6: "v3's look is the target. Bring v3's components and styling into `packages/ui` as the design system instead of re-styling them. If that conflicts with an existing `packages/ui` component, v3 wins." v3 uses shadcn-svelte components (`reference/src/lib/components/ui/**`, `reference/components.json`, base colour slate) on Tailwind 4 and bits-ui, themed in `reference/src/app.css`. `docs/03-architecture.md` already names this stack. B-001 chose scoped CSS on `--ub-*` tokens for the first build's own primitives.

## Options
- A) Port v3's shadcn-svelte components and `app.css` theme into `packages/ui` with Tailwind 4 + bits-ui; the first build's primitives are deleted as their screens are replaced. Matches the owner's instruction and docs/03.
- B) Re-style the scoped-CSS primitives to look like v3. Against the instruction ("instead of re-styling them"), and every v3 screen port would need translation.

## Chosen (provisional)
A. v3's components live in `packages/ui/src/components/ui/<name>/` (v3's own layout) with `cn()` in `packages/ui/src/utils.ts`; the theme is v3's `app.css` (light and dark). Both lanes build on it (lead-a's admin pages use the same kit). The `--ub-*` tokens survive only where a headless v4 part (map renderer) still reads them, and map onto v3's CSS variables. The first build's primitives (`Button.svelte`, `Sheet.svelte`, …) are deleted when the last screen using them is replaced (R11).

## Cost to change later
now: low · after step 2: high (every screen is written against the kit).
