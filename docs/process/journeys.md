# Qwen UI explorer (journeys) and e2e triage

Status: owner request, 2026-09-30. Tooling lane (lead-c): part A is WP-900, part B is WP-901, part C is WP-902. Part C needs WP-900 and runs first against the builder; the participant journeys follow WP-550.

## Why
Browser work costs a lot of Claude tokens: screenshots, long DOM snapshots, reading traces. The local model is multimodal (a vision check on 2026-09-30 took 212 ms and answered correctly) and costs no Claude tokens. Qwen does the looking, clicking and reporting. Deterministic code turns its recorded actions into test code. Claude (Sonnet) only reviews short test candidates and fixes the app.

Rules, which are unchanged from CLAUDE.md: Qwen never reviews code and never writes code that reaches main unreviewed. Qwen writes **structured data** (steps, expectations, findings). Code is generated from that data by a script, or written by Sonnet.

## A. `scripts/ui/ui.mjs`: browser helper CLI (deterministic, no model)
- A Playwright session kept alive between calls (server mode with a unix socket or a small HTTP port). Commands:
  - `open <url> [--viewport 360x800|1280x800]`
  - `snapshot`: the accessibility tree, trimmed to interactive and landmark nodes, with stable refs; at most about 4k tokens
  - `click <ref>`, `fill <ref> <text>`, `press <key>`, `select <ref> <value>`
  - `screenshot [--full]`: writes a PNG and returns the path
  - `console`: errors and warnings since the last call
  - `network`: failed requests
  - `axe`: violations only
  - `wait <text|ref>`
- **Every action is appended to an action log** (JSONL) together with the locator actually used: role and accessible name first, `data-testid` second, never CSS or XPath.
- Seeds a fresh project from `fixtures/golden/*` for each run, so journeys are reproducible.

## B. `npm run e2e:triage`: after a red `npm run e2e`
Usage: `e2e-triage.md`.
- Collects the Playwright JSON report, the failing step, console and network errors, a trace summary (text), and the last screenshot.
- Qwen classifies each failure as `app-bug`, `test-bug`, `flaky` or `env`, with evidence and a suggested next step.
- Writes `metrics/raw/e2e/<stamp>.md`. Only `app-bug` with high confidence goes to `ATTENTION.md`.
- Logs `e2e.jsonl` (tokens and ms) and feeds it into the metrics report.

## C. `npm run journeys [--journey <id>] [--all]`: exploratory runs
- Input per journey: the entry in `docs/ia-map.md`, the matching page in `docs/user/`, the role, and the fixture project.
  - Short journeys only (at most about 15 actions). Split longer ones.
- Qwen works in omp with tool access to `ui.mjs` only. Its loop is: snapshot, decide, act. It takes a screenshot at every screen change and on anything visual:
  - maps (canvas: the accessibility tree is blind there)
  - contrast outdoors
  - layout at 320 or 360 px
  - touch targets of 56 px or more
- Output per journey:
  1. `metrics/raw/journeys/<stamp>/<journey>.md`
     - verdict: `passes` | `blocked-at <step>` | `docs-mismatch` | `ux-issue` | `a11y`
     - findings with screenshots and the exact snapshot excerpt
  2. `…/<journey>.steps.json`
     - the recorded actions (taken from the action log, not from the model's memory)
     - plus Qwen's **expectations** as data (`{after: step, expect: {role, name, text|visible|count|url}}`)
- **`scripts/ui/codegen.mjs`** turns `steps.json` into `apps/web/e2e/candidates/<journey>.spec.ts`. This is deterministic, so the model writes no code.
  - Then it runs the candidate **3 times** headless.
  - Stable passes become `candidate: ready`. Anything else becomes `candidate: unstable`, with the failure attached.
- Findings with high severity go to `ATTENTION.md`. Everything else is picked up by lead-c in its iteration: bugs become work packages, docs mismatches become docsync or doc work packages.
- Ready candidates are moved from `candidates/` into the real e2e suite by a **small Sonnet implementer**. It gives them sensible names, removes duplicates and sets up fixtures, and a reviewer checks the result. It must not rewrite the locators, because they are proven.

## Using ui.mjs
`node scripts/ui/ui.mjs <command> [args] [--json]`, or `npm run ui -- <command>`. The first call starts a detached session server that keeps one headless Chromium page. Later calls (separate processes) act on the same page. `stop` ends it, and it ends itself after 15 minutes without a call (`UI_IDLE_MS`). State lives in `$XDG_RUNTIME_DIR/ueberblick-ui-<uid>` (`UI_STATE_DIR`), the run directory (`actions.jsonl`, `shots/`) in `<state>/runs/<stamp>` (`UI_RUN_DIR`). Output is plain text, or one JSON object `{ok, text, data}` with `--json`. Exit code 1 on an error, 2 on an unknown command.

| Command | What it does |
|---|---|
| `open <url> [--viewport 360x800\|1280x800]` | go to a URL |
| `snapshot` | interactive and landmark nodes, `- role "name" [e3] testid=x disabled`; refs `e1`.. are valid until the next snapshot; at most about 4k tokens, and a `[truncated: n of m nodes shown ...]` line says when it cut |
| `click <ref>`, `fill <ref> <text>`, `select <ref> <value>`, `press <key>` | act |
| `wait <text\|ref>` | wait until the text shows or the ref is visible |
| `screenshot [--full]` | write a PNG, print its path |
| `console`, `network` | errors and warnings / failed requests since the last call |
| `axe` | accessibility violations only |
| `seed <fixture>` | fresh data directory from `fixtures/golden/projects/<fixture>.yaml` (same seeding as the e2e suite, `apps/web/e2e/seed.ts`), served by the built web app on a random local port, browser signed in as the seeded admin. Needs `npm run build -w @ueberblick/web` first |
| `stop`, `help` | end the session, list the commands |

The command table is `COMMANDS` in `scripts/ui/commands.mjs` (name, usage, summary): part C lists the model's tools from it.

### Action log
One JSONL line per action in `<run dir>/actions.jsonl`: `{at, cmd, ref, locator, args, url}`. `locator` is checked against the page before it is logged:
- `{role, name}` first (exact accessible name), `{testid}` second, `{label}` for controls that have no role (a password field). `nth` is added only when the locator alone matches several elements.
- never CSS or XPath.
- `null` when the element has neither. The action still runs and the output carries a `warning:`. `press`, `open`, `seed` and text `wait` have no element and log `null`.

`snapshot` stamps the listed elements with a `data-ui-ref` attribute so that a ref finds its element again. That attribute is internal and never logged.

## Using journeys (part C)
`npm run journeys -- --journey <id>` runs one journey, `-- --all` runs every one (and stops quietly when `gpuFree()` says the GPU serves another model), `-- --list` lists them, `--no-candidate` skips codegen. It needs the built web app (`npm run build -w @ueberblick/web`). A journey takes about 30 s on the VM.

- **Definitions:** `scripts/ui/journeys/defs.mjs` (id, title, role, fixture, `startPath`, viewport, `maxActions`, goal, the user doc). Start with a short goal; the runner seeds the fixture, opens `startPath` at the viewport and hands the model the first snapshot.
- **The loop** (`scripts/ui/journeys/runner.mjs`): one JSON action per turn, `{"action": <ui.mjs tool>, "args": [...], "expect": {...}}`, or `{"action":"finish","verdict":...,"findings":[...]}`. The model has the ui.mjs tools from `COMMANDS` except `seed`, `open`, `stop`, `help`. Only the newest snapshot and screenshot stay in its context.
- **Expectations** are data: `{role, name, visible: bool}`, `{role, name, count: n}`, `{role, name, text}`, `{testid|label, ...}` with the same kinds, `{text}` (somewhere on the page) or `{url: "/path"}`. `validateExpect` in `codegen.mjs` is the one definition; malformed ones are dropped and noted.
- **Steps come from the action log**, never from the model's text. `after` in an expectation is the number of the last logged step.
- **Verdicts:** `passes`, `blocked-at <step>` (a budget or the model said so), `docs-mismatch`, `ux-issue`, `a11y`. Budget: 40 model calls, 15 minutes, `maxActions` actions; hitting one ends the journey, there is no retry loop.
- **Output:** `metrics/raw/journeys/<stamp>/<id>.md`, `<id>.steps.json`, `shots/`; one line in `metrics/raw/journeys.jsonl`; high findings go to `ATTENTION.md`.
- **Codegen:** `node scripts/ui/codegen.mjs <id>.steps.json [--out file]` prints the spec. Locators are `getByRole(role, {name, exact})`, then `getByTestId`, then `getByLabel`, with `.nth(n)` when the log has one; a step without a stable locator is skipped and makes the candidate `unstable`. Every candidate starts with `seedApp()` (`apps/web/e2e/candidates/harness.ts`), which is the `ui.mjs seed` code, so it needs no web server.
- **Candidates:** `npm run journeys` runs the spec 3 times headless (`apps/web/e2e/candidates/playwright.config.ts`, `--repeat-each=3`). 3 of 3 passes: `apps/web/e2e/candidates/<id>.spec.ts` with `// candidate: ready`. Otherwise `<id>.unstable.ts` (not picked up by Playwright) with the failure in its second line. No expectation, no candidate. Only journeys with the verdict `passes` produce one.
- **Adopting** a ready candidate into the real suite is a separate small work package per batch (see above).

## The current journeys
Both run on the rebuilt builder of the seeded `musterstadt-baeume` project, starting at `/admin/projects/musterstadtbaeume/types/baum/builder` (WP-1028; the first-v4 `/builder/<project>` journeys were retired with that builder). Goals follow `docs/user/admin/builder.en.md`.
- `builder-views` (desktop): the toolbar view switch across Workflow, Model (Fields, Permissions) and Code, and a task's details tabs.
- `builder-phone-sheets` (phone, 360 px): the Catalog sheet and the Details sheet, and that closing a sheet keeps the selection.

## Scheduling and budgets
- One model on the GPU, so use `gpuFree()` like docsync and logwatch. Journeys run in the quiet hours or after a phase end. `--journey` runs one on demand.
- Budget per journey: at most 40 model calls and at most 15 minutes. If it is hit, the verdict is `blocked-at`, not a retry loop.
- Metrics in `journeys.jsonl`:
  - tokens (in, out, image), ms, actions, screenshots
  - verdict, candidates ready or unstable
  - findings, and later the findings accepted by a lead (the precision of the explorer)

## Acceptance
- `ui.mjs` has tests against a static fixture page.
- `codegen.mjs` has golden tests (`steps.json` in, spec out).
- Triage has a synthetic red report as a fixture.
- One real journey on the builder runs end to end and produces at least one `ready` candidate.
- Docs: `docs/process/journeys.md` and a row in `docs/process/metrics.md`.
- Dev and user docs are kept current as usual.

## Environment
- Headless Chromium runs on this VM (owner, 2026-09-30 16:05: all libraries installed).
