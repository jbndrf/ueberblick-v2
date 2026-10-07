# BITV self-check (WCAG 2.1 A and AA, EN 301 549 clause 9)

Status of 2026-09-30 (WP-554). BITV 2.0 refers to EN 301 549 v3.2.1, whose web clause 9 is WCAG 2.1 A and AA: 50 criteria. `docs/09-standards.md` names WCAG 2.2 AA as the aim. The 2.2 additions (2.4.11, 2.5.7, 2.5.8, 3.3.7, 3.3.8 and others) are a stretch goal, not part of the statement; the drag alternatives and the 44 px / 56 px targets already serve 2.5.7 and 2.5.8.

This is a **self-assessment by the developers**, not an audit. The statement template (`static/accessibility/`) says so. A tender may still require an external test; that is needs-owner.

## How it is checked
| Layer | Where | Runs |
|---|---|---|
| axe-core, WCAG 2.1 A/AA tags, serious and critical fail | `packages/ui/src/components.a11y.spec.ts` over every `.svelte` file (a new component without a scan fails the guard) | `npm run check` |
| Keyboard and screen-reader smoke paths (shell, list alternative, feature sheet, task sheet) | `packages/ui/src/paths.a11y.spec.ts` | `npm run check` |
| Source guards (relative text sizes, orientation, press cancellation, reduced motion) | `components.a11y.spec.ts` | `npm run check` |
| Colour contrast from the tokens (normal 4.5:1, outdoor 7:1, focus and border 3:1) | `packages/ui/src/tokens.spec.ts` | `npm run check` |
| Real browser: axe with contrast, reflow at 320 px, text spacing, reduced motion, focus indicator, zoom not blocked | `e2e/a11y/pages.spec.ts` | `npm run e2e` (a new violation fails it; not in `npm run check`) |
| Participant app in the browser, from the QR sign-in to the task submit: axe with contrast on the sign-in page, list, feature sheet and task sheet, landmarks and names, skip link, focus indicators, reflow, text spacing, zoom, reduced motion, titles, Escape and focus return, task by keyboard to the status message | `e2e/a11y/participant.spec.ts` (project `participant` of `e2e/a11y/playwright.config.ts`, reusing the world of `e2e/participant`) | `npm run e2e` (same config, project `participant`) |

The e2e run keeps a **ledger** per page: known failures (axe rule id and the follow-up work package). A new failure fails the test, and a fixed one must leave the ledger.

## Result
**0 fail**, 39 pass, 11 not applicable (7 rows, the time-based media row counts 5 criteria; 50 in all). Every fail has a follow-up work package (the lead creates the files).

Re-check when they land: 1.3.5 (once a login or profile form exists), and the map drawing tool (WP-551) for 2.1.1 and 2.5.1.

## Criteria
Result: P pass, F fail, N/A not applicable.

### 1 Perceivable
| # | Criterion | R | Evidence |
|---|---|---|---|
| 1.1.1 | Non-text content | P | Icons are decorative (`aria-hidden`) or carry a label (`icons.spec.ts`); icon-only buttons require a `label` (`contract.ts`); the map has the list alternative (`paths.a11y.spec.ts`). Alt text for user photos comes from the project's task form. |
| 1.2.1 to 1.2.5 | Time-based media (5 criteria) | N/A | The platform plays no audio or video. Re-check if a tool adds it. |
| 1.3.1 | Info and relationships | P | Landmarks, headings, table caption and column headers, labels tied to inputs, error summary (`paths.a11y.spec.ts`, axe rules in `components.a11y.spec.ts`). |
| 1.3.2 | Meaningful sequence | P | Single-column flex and grid layouts; no CSS `order`; focus order equals reading order (`paths.a11y.spec.ts`). |
| 1.3.3 | Sensory characteristics | P | State is text plus a distinct shape (`overlay.spec.ts`, StatusBadge); sort state is announced. |
| 1.3.4 | Orientation | P | No orientation lock (source guard). |
| 1.3.5 | Identify input purpose | N/A | No form collects the user's own personal data yet. The participant sign-in page has no input (QR link), so it stays N/A; re-check with a password login (WP-532). |
| 1.4.1 | Use of colour | P | Status uses icon shape and text; colour only reinforces (`overlay.spec.ts`). |
| 1.4.2 | Audio control | N/A | No audio. |
| 1.4.3 | Contrast (minimum) | P | Every text pair at 4.5:1 (normal) and 7:1 (outdoor) (`tokens.spec.ts`); axe contrast on the real start, not-found, builder and participant pages (`e2e/a11y/pages.spec.ts`, `participant.spec.ts`). |
| 1.4.4 | Resize text | P | Type sizes are `rem` (source guard); the viewport does not block zoom (e2e). |
| 1.4.5 | Images of text | P | Icons are SVG paths (`icons.spec.ts`); no text in images. |
| 1.4.10 | Reflow | P | The start, not-found and builder project pages, and every builder lens, fit 320 px without sideways scrolling (`e2e/a11y/pages.spec.ts`, WP-554.2). The Views lens cause is pinned at source by `packages/builder/src/lenses/views/reflow.spec.ts` (grid containers use `grid-template-columns: minmax(0, 1fr)`, `.actions` rows wrap; WP-207.2). The participant app list fits 320 px: a long feature id wraps (`overflow-wrap: anywhere` in `packages/ui/src/map/FeatureList.svelte`) and `participant.spec.ts` measures no sideways scroll (WP-554.6). |
| 1.4.11 | Non-text contrast | P | Focus ring and border at least 3:1 in both themes (`tokens.spec.ts`). |
| 1.4.12 | Text spacing | P | Line height 1.5, `rem` sizes; forcing the WCAG spacing values clips nothing on the three pages (e2e). |
| 1.4.13 | Content on hover or focus | N/A | Only native `title` tooltips, which the browser controls. |

### 2 Operable
| # | Criterion | R | Evidence |
|---|---|---|---|
| 2.1.1 | Keyboard | P | Every control on the shell, list alternative, feature sheet, task sheet and form works with Tab, Enter, Space and Escape (`paths.a11y.spec.ts`, `buttons.spec.ts`). The map canvas is covered by the list alternative; MapLibre's own keyboard handler is on. Re-check with the drawing tool (WP-551). |
| 2.1.2 | No keyboard trap | P | The sheet traps Tab on purpose and Escape leaves it; focus returns to the opener (`overlay.spec.ts`). |
| 2.1.4 | Character key shortcuts | N/A | The platform defines no single-key shortcuts. |
| 2.2.1 | Timing adjustable | P | No time limits in the UI; a session ending does not lose input, because drafts persist (`TaskSheet.spec.ts`). |
| 2.2.2 | Pause, stop, hide | P | Only the loading spinner moves, and it stops under reduced motion (source guard, e2e). |
| 2.3.1 | Three flashes | P | No flashing content. |
| 2.4.1 | Bypass blocks | P | Skip link in the shell (`AppShell.spec.ts`) and two in the builder (main, problems). |
| 2.4.2 | Page titled | P | Every builder page has `<lens> - <place> - <project> - Überblick Builder` (`title.spec.ts`), de and en; the error page shows its status. axe `document-title` finds nothing on the three real pages (e2e ledger is empty). The participant sign-in page and app have their own non-empty, different titles (`e2e/a11y/participant.spec.ts`). |
| 2.4.3 | Focus order | P | Sheet focus handling, error summary focus, skip link target (`overlay.spec.ts`, `forms.spec.ts`, `paths.a11y.spec.ts`). |
| 2.4.4 | Link purpose | P | Axe `link-name`; error summary links name the field (`paths.a11y.spec.ts`). |
| 2.4.5 | Multiple ways | N/A | A single-page app with the two-level shell, not a set of pages. Re-check with the search tool (WP-552). |
| 2.4.6 | Headings and labels | P | Heading outline of the feature sheet; every field has a visible label (`FeatureSheet.spec.ts`, `forms.spec.ts`). |
| 2.4.7 | Focus visible | P | A 3 px outline on every control (component CSS); every Tab stop of the three real pages shows one (e2e). |
| 2.5.1 | Pointer gestures | P | The map has no zoom buttons (v3 has none; WP-656 removed the unused `MapControls`). Pinch zoom is a multipoint gesture and has single-pointer alternatives: double-tap zoom, the mouse wheel and the keyboard (`+`, `-`, arrows, MapLibre's handler); Standort sits in the bar (`standort.spec.ts`). The pass holds because drag-pan is a single-pointer drag whose result depends only on its start and end points, so it is not path-based in the sense of 2.5.1; and the list view offers every feature without the map. `MapHandle.zoomBy` is tested in `renderer-zoom.spec.ts` (the lazy wrapper delegates it, `renderers-lazy-tools.spec.ts`). Builder drags have click alternatives. The map element is named and points to the list (`describeMap`, `controls.spec.ts`); the statements no longer list 2.5.1. WP-554.3, WP-656. |
| 2.5.2 | Pointer cancellation | P | No `ui` component acts on pointer down (source guard). The builder starts a connection on pointer down and completes it on pointer up, and offers the form alternative. |
| 2.5.3 | Label in name | P | Names equal the visible text; the decorative `+` is hidden (`paths.a11y.spec.ts`). |
| 2.5.4 | Motion actuation | N/A | No device motion input. |

### 3 Understandable
| # | Criterion | R | Evidence |
|---|---|---|---|
| 3.1.1 | Language of page | P | `lang` from `Accept-Language`, de or en (`hooks.server.ts`, e2e). |
| 3.1.2 | Language of parts | P | The error page marks each part with `lang`. Project text is resolved to one locale per view. |
| 3.2.1 | On focus | P | Focus changes no context. |
| 3.2.2 | On input | P | Inputs change no context; views and areas switch by button. |
| 3.2.3 | Consistent navigation | P | One shell navigation on every screen (`AppShell.svelte`). |
| 3.2.4 | Consistent identification | P | One design-system component and icon per function (docs/13 principle 7). |
| 3.3.1 | Error identification | P | Error summary plus `aria-invalid` and text (`FormRenderer.spec.ts`, `paths.a11y.spec.ts`). |
| 3.3.2 | Labels or instructions | P | Visible labels, hints and required marks (`forms.spec.ts`). |
| 3.3.3 | Error suggestion | P | Messages come from the field's rule, refusals show a typed reason (`refused-runs.md`). The wording of project rules is the project's. |
| 3.3.4 | Error prevention | P | Runs append and never overwrite, so each change is reversible by a later run; refused input reopens as a draft (`TaskSheet.spec.ts`). |

### 4 Robust
| # | Criterion | R | Evidence |
|---|---|---|---|
| 4.1.1 | Parsing | P | Generated markup; axe finds no duplicate id or invalid nesting. |
| 4.1.2 | Name, role, value | P | The map element gets a name and a description pointing to the list alternative (`describeMap`, `controls.spec.ts`). Axe over every component and state, and on the real participant screens (no open finding; the problem bar is a `role="status"` wrapper around a plain list, `panes.ui.spec.ts`, WP-554.6); `aria-pressed`, `aria-current` and `aria-sort` carry state. |
| 4.1.3 | Status messages | P | `role="status"` for connection state, task outcome and builder save state; `role="alert"` for errors (`paths.a11y.spec.ts`, `SaveStatus.ui.spec.ts`). |

## Limits of this check
- The participant browser test runs on the list alternative only (the keyboard and screen-reader path, independent of the GPU): the world embeds the golden `$ref` styles before publishing (B-013), so the map mounts and the first sign-in logs no error about sources or layers (WP-599). The map canvas and MapLibre keyboard handling are unmeasured.
- axe finds roughly a third of WCAG problems. Screen-reader behaviour is asserted through roles and names, not through a real screen reader. A manual test with NVDA and VoiceOver is needs-owner.
- jsdom has no layout, so contrast and reflow are proven from tokens and in the real browser run only.
- Content that projects author (labels, photos, help texts) is the project's responsibility. The builder does not yet warn about missing alt text or low-contrast custom themes.

## Needs-owner
- Sign-off of the statement and its publication (the legally binding part is out of scope of WP-554).
- The feedback contact and the enforcement procedure fields of the statement.
- An external audit or a manual assistive-technology test, if a tender asks.
