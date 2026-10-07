# core/testing: simulation harness (WP-050)

In-memory fake ports and a seeded simulator, for tests only. Not exported from the core barrel; the subpath `@ueberblick/core/testing` exists for adapter tests (server run store). It uses the real `core.plan`, `core.fold` and `core.perms` and re-implements no rule (R1). Clock, ids and randomness are injected (R2).

## Parts

| File                 | What                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract.ts`        | Types: `Workload`, `SimOptions`, `SimReport`, `Violation`. Proposed by WP-050 (the lead confirms).                                                                                                                                              |
| (`../memory`)        | `MemoryStore` (`@ueberblick/core/memory`, WP-543): `Facts` plus features and edges kept by `core.fold`, the log, capped history. Constructor `(config, clock, geo)`. Server, device and replay checks import it from there.                     |
| `scenario-server.ts` | `ScenarioServer`: the seam the golden runner drives (`simServerFactory` for `SimServer`; the SQLite run store implements it in `packages/server/src/store/run/scenario-server.testkit.ts`). `runScenario(doc, known, make?)` takes the factory. |
| `server.ts`          | `SimServer`: authoritative, assigns `seq`, keeps the **ledger** (a repeated run id returns the stored result). `submit(runs, atomic, asBatch)`, `pull(since, limit)`.                                                                           |
| `device.ts`          | `SimDevice`: confirmed replica, run queue (sequential send), predicted view (plan over confirmed), rebase after a refusal, restart.                                                                                                             |
| `network.ts`         | Lossy, duplicating, reordering network on ticks, faults from the seeded `Rng`.                                                                                                                                                                  |
| `sim.ts`             | `simulate(workload, options)`: N devices, offline periods, restarts, admin batches (H2), then a fault-free drain.                                                                                                                               |
| `invariants.ts`      | `checkInvariants`: convergence, no accepted run lost, refused runs leave no trace.                                                                                                                                                              |
| `workloads.ts`       | `baumWorkload()`: the golden tree cadastre with three roles.                                                                                                                                                                                    |
| `golden.ts`          | Loads the golden corpus (`goldenConfig`, `goldenYaml`, `seedFeatures`, `Aliases`). Vite only.                                                                                                                                                   |

## Invariants (docs/07 "Testing")

- **Convergence:** after the drain every device's confirmed features, edges and cursor equal the server's.
- **No accepted run lost:** every submitted run is accepted (its observations are in the log, once), or refused and visible with a reason (on the device), or still queued (a violation after the drain).
- **Refusals leave no trace:** no observation of a refused run, no seq gap, and the state equals the fold of the accepted log replayed in one chunk on a fresh store.

## Reproducing a failure

`simulate(workload, {...DEFAULT_OPTIONS, seed})` is a pure function of its arguments. A failing seed number is the whole report: rerun it with the same options. `SimReport.digest` is equal for equal seeds. `simulateWorld` returns the end state (server, devices) for inspection.

## Ledger and refusals

The server ledger stores refusals as well as acceptances, so a resent refused run gets the same answer. A refusal is not a trace: no run row, observation, seq or edge. (Phase 2 may store refused runs for the admin view; the invariant then reads "no observation".)

## Extending

A new domain writes a `Workload` (config, perms, participants, `seed`, `nextRun`, optional `adminBatch`); the simulator knows no task. H2: `adminBatch` runs are submitted directly to the server, atomic, while devices are offline.

## Performance

1,000 seeded scenarios (3 devices, 25 ticks) take about 7.4 s on the development machine (bench `simulation-1000`); the budget is 60 s (`bench/simulation/simulation.bench.ts`).
