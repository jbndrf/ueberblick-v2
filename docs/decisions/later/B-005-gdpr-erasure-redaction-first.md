# B-005 GDPR erasure: redaction runs first, crypto-shredding kept as a seam
priority: high        status: provisional
date: 2026-09-29   lead: b   work packages: WP-530 (design), follow-ups P1–P7   touches: R3, R4, F4, sync protocol v1, backups, H4, H5

## Context
The observation log is append-only, synced to devices and replicated by Litestream, but Art. 17 requires erasure. WP-530 compared options with a prototype (`docs/research/gdpr-erasure.md`, `spikes/gdpr/`).

## Options
- A) Crypto-shredding: encrypt personal values per subject, delete the key. ~15 µs per value server-side, reads ~18× slower; devices must decrypt too.
- B) Redaction run: one admin run blanks the subject's personal values (including superseded observations and the copy in `runs.input`), re-folds affected features, writes an erasure ledger row without personal data; `secure_delete=ON`. 3,334 of 200,000 observations redacted in 449 ms.
- C) Hybrid: B now, A behind a seam for projects that need it.

## Chosen (provisional)
C, with B implemented first. Identity stays only in `participants`, so erasing that row anonymises every actor id. Personal properties are marked with a schema flag (`personal: { subject }`, registry-backed), not a new property type (R4). Erasure is an ordinary config-declared task whose `redact` effect (effect registry, A-007) appends null observations for the subject's current personal values and, in the same run transaction, overwrites the results of superseded observations and the `runs.input` copy with NULL in place: the single documented exception to append-only, reachable only through that effect (R3 holds; no third reserved key; fold unchanged, since a null result is an ordinary value). `erasure_subjects` keeps plain participant ids (pseudonymous once the participants row is gone) so erasures can be replayed after a backup restore. Devices learn about it through new sync tombstone kinds `redaction` and `blob`, added to protocol v1 now (WP-512) so no protocol major is needed later. Seam: a value-codec port between fold/store and stored results, where encryption (A) can be added.

## Cost to change later
now: low · after the build: medium (schema flag stays; adding A means a codec on server and device plus key management). Needs-owner: backup retention maximum (proposed 30 days, legal sign-off), AVV/TOM texts.
