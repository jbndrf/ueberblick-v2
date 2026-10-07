# B-012 The device sync pipeline (pull, plan, IndexedDB writes) runs in a dedicated Web Worker
priority: medium   status: provisional
date: 2026-09-30   lead: b   work packages: WP-560, WP-565, WP-567   touches: packages/client, apps/web, docs/03, docs/12

## Context
The browser scenario `sync-snapshot-60k` (WP-560) measured a 640 ms main-thread task per snapshot page against the 100 ms budget. The cause was about 5,000 synchronous `IDBObjectStore.put` calls per page. Each put does a structured clone plus key extraction in the calling task. Chunked writes in one transaction (WP-565) brought that down to 141 ms. The rest is major GC (40–60 ms) and native time from the same puts, plus a total of about 20 s of put cost inside a 30.4 s copy (budget 30 s). Chunking cannot move work off the main thread, and only decoding runs in a worker today.

## Options
- A) Run the sync worker and the store's write path in a dedicated Web Worker. The main thread reads through the unchanged store port and gets change notifications (feature ids per applied page).
- B) Keep everything on the main thread and accept about 140 ms spikes and about 30 s, then re-judge on a real device.
- C) Shrink the per-page work (skip no-op trim counts, fewer allocations): about 3 s less total, but spikes stay.

## Chosen (provisional)
A, with C's trim-count skip as a separate cheap step. Only A takes the put cost off the main thread, which is what the budget is about. IndexedDB is available in workers, and the store port does not change. Seam: a host adapter picks in-thread or worker (the tests and Node run in-thread), so B is one adapter switch away. R13: the run queue (WP-511) and the role apps talk to the port, not to the thread.

## Cost to change later
now: medium · after the build: high (every consumer would assume main-thread store state).
