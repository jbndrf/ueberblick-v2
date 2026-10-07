# Simulation against the real adapters (WP-513)

The WP-050 invariants (converge, no accepted run lost, refused runs leave no trace) with the **real** device and server adapters, under seeded network faults. Harness: `packages/client/src/simulation` (see its section in `packages/client/README.md`). This folder holds what needs both packages, which the client may not import from each other: it is outside the package graph.

| File | What |
|---|---|
| `backend.ts` | `sqliteBackend`: the run store on in-memory SQLite, the sync service, and the real run and sync HTTP handlers. Transports carry `Request` and `Response` objects through them. |
| `profiles.yaml`, `profiles.ts` | The `short` and `long` profiles and the `regressions` seeds (schema-checked). |
| `real.spec.ts` | The `check` profile (in `npm run check`), determinism, tamper tests that prove each invariant can fail, and the minimal reproduction of a failing seed (a server that lies). |
| `limits.spec.ts` | The accepted limits as expected behaviour: server-minted ids replace the device's guesses on pull; predictions cover reference edges only. |
| `long-0..9.spec.ts`, `long.testing.ts` | The long profile, ten shards so vitest runs them in parallel. Skipped unless `SIM` is set. |

## Running
- `npm run check` runs the `check` profile in the specs (8 seeds of 3 devices x 16 runs, one self-contained test per seed, each under 1 s). The `short` profile (8 seeds of 6 devices x 40 runs, at most 30 s in all) is the benchmark `bench/simulation-real`.
- `npm run sim` runs the long profile: 50 seeds of 20 devices x 500 runs (`SIM=1`).
- A failing seed prints a reproduction such as `SIM_SEED=17 SIM_DEVICES=3 SIM_RUNS=7 SIM_DROP=0 ... npm run sim`. It runs exactly that simulation. Add the seed to `regressions` in `profiles.yaml` once it is fixed.

## What is faulted
Lost request (the server never sees it), lost reply (the server applied it, the device did not hear, so the run is sent again and the ledger answers), duplicate, late duplicate (a stale copy that reaches the server after newer runs), offline periods, restarts (store and queue survive, in-flight state and sometimes the snapshot head are lost), an atomic batch submitted by a `verwaltung` device, and an admin batch straight to the server (H2).
