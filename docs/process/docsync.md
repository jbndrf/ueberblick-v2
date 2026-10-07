# docsync: the local model writes docs, Opus reviews them

docsync is a local model on the owner's GPU fleet (llama-swap at `192.168.1.47:8001`, configured in `~/.omp/agent/models.yml`), driven through omp. It has **exactly one job: propose documentation updates** after code lands on `main`.

- It **never reviews code** and never gives feedback on code. It is not intelligent enough for that (lab: 41% recall on real defects). Code review is done by the Sonnet `reviewer` (the merge gate) and by Opus (the lead, plus the strategist in course checks).
- **Every docsync branch is reviewed by lead-c (Opus).** Nothing from docsync reaches `main` unreviewed.

Default model: `qwen3.8-27b-nvfp4-kv8-c128k-n4-mtp`. Override it with `LOCAL_MODEL` (shared client: `scripts/local-model.mjs`).

## Flow
1. `npm run docsync:watch` runs as a user service (`scripts/docsync/docsync.service`). Every 10 minutes, if `main` moved, it runs **one** update over the whole new range. It skips ranges that contain only doc commits, `chore(wp)` lead-event commits or its own docsync merges, and it defers up to 3 ticks while another model is loaded on the GPU.
2. `scripts/docsync/update-docs.mjs` lets omp and the model edit docs in a worktree at the landed commit, then **rebuilds branch `docsync/<sha7>` on main's current tip** (`onto-base.mjs`): per file a three-way merge (base = landed commit, ours = main's tip, theirs = the model's file). Hunks main already has merge to nothing, hunks that conflict with main are dropped (main's side wins) and **reported**: update-docs prints "Dropped N conflicting hunk(s) in <files>", writes the same line into the commit body and the run report, and logs `droppedHunks` and `droppedFiles`. Check them in review, because a dropped hunk is a doc change the model wanted and main disagrees with. And a proposal that ends up empty creates no branch (`no-changes`). The prompt still says "document the range `from..to`". The guardrails from the lab:
   - only doc paths (`docs/**` except `decisions/`, `research/` and `history/`; package READMEs; `apps/<name>/README.md`; root README), otherwise the run is `rejected-guardrail`
   - one bounce if the model wrote nothing
   - a check that every backticked path or name it added exists in the repo (informational, in the report)
   - **WP-977 guardrails** (`scripts/docsync/guardrails.mjs`, pure, tested in `guardrails.spec.ts`), run on the staged result: a backticked file name (`*.md`, `*.ts`, `*.mjs`, `*.svelte`, `*.json`, `*.yaml`) must be a repo path or a bare name that exists exactly once under `docs/` or a touched package (`login.en.md` instead of `sign-in.en.md` fails); a changed `docs/user/**/X.md` needs `X.en.md` changed too, and the reverse, when the counterpart exists. A problem bounces the model **once** with the reasons; if it persists the run is `rejected-guardrail` (reasons in the report, `guardBounced` in the log). Found by the 48-branch review of 2026-10-02
   - two language and label rules in the prompt (`PROMPT`, tested in `update-docs.spec.ts`): `docs/user/*.md` without `.en` is German, so the model writes German there and quotes code identifiers or report codes in backticks with a German gloss in parentheses, never bare English prose; and a UI label quoted in `docs/user/**` must be copied verbatim from the message catalogues (`catalogueDirs`, `scripts/messages-sort.mjs`), never invented or translated (review step 3 still checks it); and the type and status names in `docs/user/**` quote the catalogue label, never the config key. `npm run lint:ui-strings` also reports a quote that differs from a catalogue label only by `…` versus `...`, with the catalogue spelling
   Report: `metrics/raw/docsync/<sha7>.md`.
3. **lead-c reviews the branch** (`git diff main...docsync/<sha7>`):
   - Before deciding, check every quoted UI string in `docs/user/**` against the message catalogues (`{de,en}.json` in each dir of `catalogueDirs`, `scripts/messages-sort.mjs`: `packages/{ui,builder}/messages`, `packages/tools/*/messages`, `apps/web/messages`). A label that is in no catalogue is invented: fix it or reject the branch. On 2026-09-30, docsync/754ea2f got through with invented status labels. `npm run lint:ui-strings` (WP-910) automates this check.
   - Read hunks on long one-line paragraphs with `git diff --word-diff main...docsync/<sha7>`. The model sometimes deletes unrelated sentences in the same line while editing one (docsync/5f1e965, 2026-10-01).
   - Correct: run `npm run docsync:outcome -- docsync/<sha7> merge`. The outcome is `as-is`.
   - The pre-commit hook (`scripts/ops/precommit.mjs`) refuses a staged text file that has a merge-conflict marker (a line starting with seven `<` and a space, or seven `>` and a space) and names `file:line`; a failed conflict resolution was committed twice with markers before this. A setext heading (a line of `=` alone) is fine.
   - Small errors: commit fixes on the branch, then `merge`. The outcome is `edited`, and the fix lines count as **rework**.
   - Wrong or useless: run `npm run docsync:outcome -- docsync/<sha7> reject "reason"`.

   Always use `docsync:outcome`, never a plain merge. Without it there is no rework measurement.
   `merge` runs under the main lock and first checks `git merge-tree --write-tree`. If the branch no longer merges cleanly, it rebases the branch onto main in its worktree. On a conflict it aborts the rebase, refuses (exit 2), lists the conflicting files and touches nothing: resolve by hand or reject. If the real merge still fails, it runs `git merge --abort` and exits non-zero, so main is never left mid-merge.
   **Rework** counts only the lines of the lead's own commits on the branch. Docsync's commits are told apart by their subject (`docs: sync with ...`), so a rebase adds 0 and a lead's fix commit counts. A merge commit (the lead merging main into the branch) counts only against the automatic merge of its parents: a clean merge adds 0, a hand-resolved conflict counts its resolution lines.
   **Hand-resolved rebases count (WP-948).** `merge` reads the branch reflog for the tip before the first rebase and compares its hunks with the hunks the branch carries now. Hunks that were dropped or changed by the rebase (a conflict resolved by hand, a hunk main already had) are logged as `droppedHunks`, together with `rebased: true`. A branch with `droppedHunks > 0` is `edited`, not `as-is`, even if the lead committed nothing. A clean rebase (0 dropped) stays `as-is`. The extra fields are additive: `npm run metrics` section 5 reads the same events.
   **Committing a fix:** run `npm run docsync:outcome -- docsync/<sha7> prepare` first. It reuses the worktree where the branch is checked out, wherever it is, or else creates `<main-checkout>-docsync-<sha7>` (derived from the main checkout, never from your cwd). If the branch is behind main it rebases it onto main (a conflict is aborted and reported, the branch stays as it was). Then it links `node_modules` with `scripts/ops/link-node-modules.mjs`, so the pre-commit hook passes. When the rebase brought in a new dependency, the worktree's install no longer matches its `package-lock.json`: `prepare` replaces that install with the link. `prepare` never runs `npm ci`: a docsync branch only changes docs, so it links main's install even when its old base's `package-lock.json` differs from main's. It first checks that the branch touches no `package.json` or `package-lock.json`, and refuses (no install, exit 1) if it does. Any other refusal (main has no `node_modules`, main's install is stale) also leaves no install and names the reason. An existing real copy is replaced by the link on the next `prepare`.

## Commands
| Command | Does |
|---|---|
| `npm run docsync -- <sha> [--from <sha>]` | One doc update for a range (default: the one commit) |
| `npm run docsync:watch` | The batching watcher (service) |
| `npm run docsync:outcome -- docsync/<sha7> merge\|reject ["reason"]` | Merges (rebasing if behind) or rejects, and logs the outcome and rework lines |
| `npm run docsync:outcome -- docsync/<sha7> prepare` | Worktree of the branch with `node_modules`, for a fix commit |
| `npm run metrics` | Section 5 shows docsync runs, tokens, time, bounces, outcomes and the rework ratio |

## Is it worth it?
The course check reads section 5 of the metrics report. docsync earns its place if **as-is + edited ≥ 60%** of outcomes and the rework ratio stays below about 30%. If more than 40% are rejected (with at least 10 outcomes), it costs more review than it saves: narrow its scope, change the prompt or the model, or switch it off.

## Facts from the owner's lab (`~/lab/bench/findings`) and our measurements
- **One model at a time on the GPU.** A swap costs about 20 s and stalls everyone. Hence batching and deferral.
- **The 27B often "answers" without writing files**, and sometimes invents names. Hence the bounce and the name check.
- **Spec quality beats model size.** The prompt names the exact range and the exact allowed paths.
- **Concurrency (measured 2026-09-29):**

  | Parallel requests | Tokens/s total | Tokens/s each |
  |---|---|---|
  | 1 | 142 | 142 |
  | 2 | 246 | 123 |
  | 4 | 407 | 105 |
  | 6 | 351 | slower (queueing) |
  | 8 | 406 | slower (queueing) |

  Four parallel requests is the ceiling; more just queue. docsync uses one slot.
- Warm TTFT is under 0.5 s. Thinking is controlled by the server; omp sends no thinking control.
