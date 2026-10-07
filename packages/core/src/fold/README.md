# core.fold

The only definition of current state (F4). Entry: `createFold(geo)` from `./index`; the contract is `contract.ts`.

| File         | What                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.ts`   | highest seq per property; reserved `$type` (creates, state `active`) and `$lifecycle` (a registry state; highest seq wins); derives geometry values for changed geometry properties       |
| `edges.ts`   | reference edges: old values out, current values in, only for properties that received a new observation                                                                                   |
| `derived.ts` | `recomputeDerived`: derived edges in both directions through a `DerivedLookup` (bbox prefilter, the exact `core.geo` predicate, then `DerivedLookup.condition` when the relation has one) |

## Rules

- Observations with `seq <= prev.updatedSeq` are ignored, so replays change nothing. Input is sorted by seq if it is not already.
- Folding in chunks, or one observation at a time, gives the same feature (H2). Chunks of a feature must start with its `$type`; the adapter passes `prev`.
- Cost is O(observations of that feature); geometry is derived only when its value changed.
- An archived or deleted feature keeps its state; `recomputeDerived` removes all its derived edges.
- `DerivedLookup.edgesFrom/edgesTo` are queried per relation key; the adapter returns only that relation's edges. Relation keys should therefore be unique per declaring type (compile() should enforce this).
- Derived relation with a `condition` (a conjunction such as golden `veranstaltung.kollision`): `predicate` prefilters, `DerivedLookup.condition(path, self, other)` decides; the adapter implements it with `expr.condition` (an error counts as false). A condition reads only own properties of `self` and `other` (compile rejects relation traversal). The adapter recomputes when `geometryChanged` or `derivedInputsChanged` (non-geometry properties that a condition reads, from `FoldType.derivedInputs`) is non-empty.
- Benchmark: `bench/fold` (60k features: 270 ms total, worst 1,000-feature page 17 ms; 7 us per incremental observation).
- Benchmark `bench/fold/derived`: one moved feature, 2,000 candidates, full condition: 2.2 ms median (budget 20 ms).
