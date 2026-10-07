# Golden scenario runner (WP-050)

`npm run test:golden` runs every scenario in `fixtures/golden/scenarios` against `core.plan` and `core.fold`, through the simulation harness (`packages/core/src/testing`). The runner re-implements no rule: it builds the world (config, seeds, participants), submits runs to `SimServer` and compares results with the `then` block.

## What is executed
Step kinds `run`, `batch` (atomic or not), `replay`, `replay_refused` and `compile`. Asserted: `outcome`, `refusal`, `observations`, `observations_absent`, `no_trace`, seq contiguity, batch item results, `same_result_as`, `new_observations`; at scenario level `features`, `edges`, `edges_absent` and `ledger.runs_total`. Matchers: `{approx}` and `identical_to_input`.

| Step kind | Executed through | Asserted |
|---|---|---|
| `run`, `batch`, `replay`, `replay_refused` | `SimServer` (`core.plan`, `core.fold`) | see above |
| `compile` | `template.merge`, then `problemsFromMergeIssues` (merge issues) or `compile` (clean merge) | `outcome` (`accepted` or `failed`), `problems` (exact list in merge order: `problem`, `path`, `message`, and `hint` when named; an extra or missing problem fails), `nothing_deployed`, `resolved_template`, `origin` (merge provenance, `template` for untouched paths), `absent` |

**`replay_refused` (WP-778)** sends the run of step `of` again under its run id, with an optional other `actor` and/or other `input`, and expects the refusal `id_taken` with no trace and no new observations (since WP-754 a run id answers only to the same actor with the same payload). Both servers run it: `SimServer` binds a replay with `sameRunBinding` (WP-780, `packages/core/src/testing/binding.ts`), the run store through its ledger (`packages/server/src/store/run/golden.spec.ts`). The exact replay stays `replay` (accepted, `same_result_as`).

A scenario whose only steps are `compile` builds no world, so its project may be meant to fail merging.

## Nothing is skipped silently
`classify.ts` lists every step kind and expected-result key as asserted or as skipped with a reason. A key or kind that is in neither list fails the run ("unclassified"). Each skip is reported with its reason (`runScenario(...).skips`).

`known-skips.ts` holds **named** skips: `WP-011.2` (template write permissions of baumkataster) `WP-041.3` (core.plan defects the runner found). A named skip covers a step only when that step actually differs from its scenario, and the spec fails when an entry is no longer used, so the list can only shrink. The corpus is the spec: fix core in the named work package, then delete the entry.

## Adding a scenario
Write it as in `fixtures/golden/README.md`. If it uses a result key the runner does not know, add the key to `classify.ts` (asserted or with a reason).
