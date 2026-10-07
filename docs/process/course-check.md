# Course check: the critical direction review

This is a regular, critical review of **direction**. Line-level quality is handled per work package by the Sonnet reviewer, and this is not that.

## When (whichever comes first)
- every **4 merged work packages**
- when a work package flagged `major: true` merges (schemas, contracts, protocols, persistence, navigation structure)
- at every **phase end**
- when the lead is unsure, or when the metrics report raises flags

## Who
- **strategist** (Opus 5.5, `.claude/agents/strategist.md`) writes the review.
- **lead-a** (Opus 5.5) replies. Its actions become work packages in the owning lead's lane.
- They get **at most 3 rounds** in total, then they agree on an action list. Anything still disputed becomes a high-priority later topic, and the build continues.

## File: `reviews/course/NNN-YYYY-MM-DD.md`
```markdown
# Course check NNN (range <sha>..<sha>, WPs …)

## 1. On track?            verdict (on track | drifting | off track) + 3 lines why
## 2. Misconceptions       ranked list: assumption → evidence → consequence
## 3. Lock-in risks        | decision/shape | where | undo cost now | undo cost in 3 months | blocks H? | recommendation |
## 4. Budgets              current numbers vs docs/12, trend
## 5. Docs                 dev/user docs out of sync (file → what)
## 6. Process & metrics    flags and trends from metrics/reports/<date>.md (review rounds, rework, tokens, docsync outcomes)

## Debate
### Round 1 — lead
### Round 2 — strategist
### Round 3 — lead (final)

## Outcome
- Agreed actions: … (each → WP id / decision record / revert)
- Later topics (for the owner, after the build): … (ids in docs/decisions/later/)
```

## Rules
- **Prefer reversibility.** If two paths are otherwise equal, take the one that is cheaper to undo. If a lock-in is unavoidable, it needs a later topic (priority high if it touches H1–H6) and a seam.
- An agreed action becomes a work package or a decision record in the same session. Nothing stays as prose only.
- The lead records the check in `docs/process/roadmap.md` under "Course checks": date, verdict, number of actions.
