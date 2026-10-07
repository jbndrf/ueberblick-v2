# A-038 The time a property last changed is `changed_at('prop')`, read from the history port
priority: medium        status: provisional
date: 2026-10-02   lead: a   work packages: WP-389 (WP-377 wires the control)   touches: H2, H4, R4, R14

## Context
v3's rule time condition "Seit: betritt Phase" needs the time a feature entered its current stage (register a3-builder E16). `self.$changed_at` is the time of the feature's newest observation of any property, so it cannot say when the stage changed.

## Options
- A) function `changed_at('status')`, in the history family (`last`, `changed`, `count`, `previous`): the checker already validates a quoted property name of `self`'s type there.
- B) system-key form `self.$changed_at.status`: `$` names are a fixed registry (`SYSTEM_FIELDS`, one column each); a per-property member would need a new grammar form and a type rule for a dynamic member.
- C) A fold-kept per-property time map in `FeatureState`, filled only for properties some expression reads: new state on device and server, a compile-time collection pass, a sync field.

## Chosen (provisional)
A, reading `Facts.history(id, prop, 1)` (and `observations o` in SQL): the time (`phenomenonTime`, the run's time, R2) of the newest observation of the property; null while there is none or its run carried no time. Fold keeps no new state, so nothing grows for any property (R14: one indexed row lookup, `(feature_id, property, seq)`), device and server share the one implementation, and it is generic (R4: the stage is just a property). Type `timestamp`, so `changed_at('status') + days(3)`, `elapsed.from` and view filters work. An elapsed rule that names `changed_at('p')` re-schedules when `p` is written (`timeRules().reads`). The seam for C: `changed_at` is the only reader, so a fold-kept map can replace the history read without touching rules. H2 (dispatch: "Auftrag seit 3 Tagen in Phase X") and H4 (assistants) use the same function.
Limits: it is "last written", not "last different": writing the same value again moves the time (owner-lead decision). The device keeps 10 values per property, enough for the newest one. Rule runs inherit the triggering run's time (`Origin.clientTime`); the server's timer run (`timers.ts` `fireOne`) carries the tick's clock time (`deps.clock`, never `Date.now()` in core), so a stage a timer writes has a time.

## Cost to change later
now: one function, one checker line, one regex in `rules/timing/elapsed.ts`. After the build: switching to C changes the evaluator only; rules in files stay valid.
