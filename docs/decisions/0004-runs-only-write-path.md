# 0004 · Runs are the only write path

- **Status:** accepted (owner, 2026-09-29 planning session)
- **Context:** v3 had four write paths.
- **Decision:** Every change by anyone is a run: `core.plan` produces observations or a refusal. The run ID (UUIDv7, minted on the device) is the idempotency key, and the server ledger returns the stored result on repeat. Rules produce system runs with `caused_by`.
- **Rejected:** Direct admin writes, direct import writes.
- **Source:** `docs/history/session-2026-09-29-planning.md`, `docs/research/artifacts/`
