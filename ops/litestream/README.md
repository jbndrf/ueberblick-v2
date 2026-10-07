# ops/litestream

`litestream.yml` is generated per deployment, never hand-written:
`node scripts/backup/config.mjs <data-dir> <replica-base-url> > ops/litestream/litestream.yml`
(it lists `control.db` and every `project-<key>.db` it finds). The generated file is machine-specific and not committed. Runbook: `docs/process/backup.md`.

The compose profile `backup` builds `Dockerfile` here (context: repository root) and generates the config itself at start and whenever a database appears; no hand-generated file is needed there. See `docs/process/backup.md`.
