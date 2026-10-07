# 13 · UX principles (binding for every UI work package)

> **Since 2026-10-01 the target is the owner's v3 app** (`docs/process/rebuild.md`). These principles judge *how well* a ported element serves its purpose. They never justify moving an element away from v3's place or flow, or inventing a new one.

The app must be **understandable, fast to use and good-looking**, both for participants in the field and for admins configuring a project. Configurability must never turn into clutter. The owner's standard: *if a user did this in the UI right now, how would they get there, and does that make sense?*

## Principles
1. **Role-first.** Each role sees *its* app (H3): its views, tools, tasks and presets. Don't show what the role can't use.
2. **Settings where the work happens, plus an overview** (owner 2026-10-01). An admin configures a thing where they work on it, e.g. the roles of a property right on the property while building a form. An overview (e.g. the permission matrix) serves bulk changes. Two places for one setting are intended when they serve two purposes; what must not happen is the same purpose scattered without reason.
3. **Shallow.** At most **two levels** of navigation: level 1 is the top-level navigation (areas in `docs/ia-map.md`), level 2 is one sub-level (tab, section or sub-menu), and there is nothing deeper. In-place disclosure (principle 5) doesn't count as a level. Frequent actions take **three steps at most** from the place the user naturally is. A *step* is one tap, click or completed selection. *Frequent* means the role does it at least daily, or it is listed as a shortcut in the role's app profile.
4. **Proximity follows the journey.** If a user does X and then Y, then Z (the natural next step) sits next to Y, or is reachable from it in one step.
5. **Progressive disclosure, not hiding.** Advanced options fold out in place, and never move somewhere else.
6. **Canvas feeling.** Direct manipulation over forms where it fits: the map, the builder canvas, drag with a non-drag alternative (WCAG 2.5.7).
7. **Consistency through the design system.** Reuse `packages/ui` components, tokens (colour, spacing, type) and SVG icons. A new visual pattern needs a reason in the work package.
8. **Honest state.** Sync status, offline, refused runs and loading are always visible and understandable, never silent.
9. **Field-proof.** Primary touch targets are at least 56 px, primary actions sit in the thumb zone, and there is an outdoor high-contrast mode. Don't rely on colour alone.
10. **Beautiful by default.** Admins can shape the look (form layout, button colours, icons, data views), and the defaults must already look good.

## The purpose and journey check (required before porting or adding any UI)
Every UI work package writes this into its Log **before** implementing, per element:
```
Purpose:  This element let <role> do <XYZ> in v3 (<reference file:line>).
Port:     In the new app <role> does XYZ at <place> (and <place>, if in context + overview), reached by <path> (<n> taps).
Why:      <same as v3> | <deviation forced by the engine: …> | <owner decision: …>
```
- v3's place and flow are the default. A deviation needs a reason from the engine or an owner decision.
- An element with no clear place, a new element, or one that would lose its purpose goes to the lead, and from there to the owner's list (`docs/process/rebuild.md` §3). Never invent.
- `docs/ia-map.md` is the map of where every function lives. UI work packages update it in the same change.

## Review
The reviewer fails a UI work package when:
- the purpose and journey check is missing
- an element's purpose sentence (with v3 file:line) is missing, or its place or flow deviates from v3 without a reason
- something is invented (a screen, menu, feature or setting outside v3 and the owner decisions)
- the navigation depth exceeds two levels
- a frequent action takes more than three steps
- it bypasses the design system without a stated reason
- a UI string lives outside a Paraglide catalogue (one catalogue per package, tools and the participant app included; no `messages.ts` string table)
