# A-001 Server SQLite driver: better-sqlite3 behind a `Db` interface
priority: medium        status: provisional
date: 2026-09-29   lead: a   work packages: WP-100   touches: O1, O4, budget (server RSS, run p95)

## Context
Phase 2 needs a SQLite driver with R*Tree, JSON1, WAL and a synchronous transaction API (one transaction per run). The runtime question (Node vs Bun, O1) is open with the default Node 22.

## Options
- A) `better-sqlite3`: mature, synchronous, bundles SQLite with R*Tree/JSON1, fastest in Node. Native add-on (prebuilt binaries).
- B) `node:sqlite`: no native dependency, but still experimental in Node 22 and its extension set is not guaranteed.
- C) `bun:sqlite`: only if O1 goes to Bun.

## Chosen (provisional)
A, because it is the proven option on the O1 default (Node 22) and all three share the same synchronous shape. The seam: `packages/server/src/db/driver.ts` (`Db` interface); nothing outside `db/` imports the driver.

## Cost to change later
now: one file · after the build: one adapter file (~100 lines) plus a driver-parity test run; no data migration (same SQLite file format).
