# A-003 Rule-language parser: hand-written subset parser (O2)
priority: medium        status: provisional
date: 2026-09-29   lead: a   work packages: WP-020   touches: O2, H4, budget (participant shell JS)

## Context
O2 asked for a hand-written CEL-subset parser or a CEL library behind our AST. WP-020 prototyped all three (`spikes/cel-parser/REPORT.md`).

## Options
- A) Hand-written: parse 10k expressions 77 ms, 4.3 kB gz, rejects everything outside the subset at parse time with spans.
- B) `@bufbuild/cel`: 1053 ms, 7.8 kB gz, stack overflow on deep nesting (unsafe for untrusted input, H4).
- C) `@marcbachmann/cel-js`: 49 ms, 23.2 kB gz, accepts the full CEL language; subset control would need a second pass.

## Chosen (provisional)
A, because it is the only option with subset control and safe limits (length 4096, depth 64) at a negligible bundle cost. Related sub-choice: history functions take the property as a quoted string (`last('stage', 3)`). The seam: `parse(src) → ParseResult` over `expr/ast.ts`; `parse/parse-cases.ts` is the conformance suite any library adapter must pass.

## Cost to change later
now: none · after the build: one adapter module (~200 lines) passing the conformance suite; no AST or consumer change. Changing the history-function argument style needs a `migrate` step over project files.
