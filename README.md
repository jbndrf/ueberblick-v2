# Überblick v4

An offline-first platform for geo-referenced features and the tasks that change them. This is a full rewrite of Überblick v3, designed for agentic development.

- **Agents:** start with `CLAUDE.md`.
- **Humans:** `docs/00-vision.md`, then `docs/02-foundations.md`.
- **The lead session:** read `docs/process/kickoff.md`, then run `/next`.
- **Status:** `npm run wp` prints the work-package board. `docs/process/roadmap.md` has the phases.

`reference/` contains the v3 source (read-only) for behaviour and lessons. `docs/research/` holds the research that shaped v4, and `docs/history/` the planning conversation.

## Develop

```bash
npm run dev          # vite dev with seeded data, https on every LAN address (a phone gets a secure context)
npm run dev:http     # the same over plain http
```

`docs/process/dev.md` has the flags, the data dir and reseeding. `npm run demo` serves a build instead (`docs/process/demo.md`).

## Quick start (Docker)

```bash
cp .env.example .env      # set PUBLIC_URL, optionally the first admin; every variable is explained in the file
docker compose up -d      # builds the image, starts the app on APP_PORT (default 3000)
```

All data lives in `./data`. Details: `docs/user/admin/server-install.md` (German) and `docs/user/admin/server-install.en.md`. Configuration code: `apps/web/src/lib/server/config/`. `node scripts/docker/smoke.mjs` builds the image and checks health and data survival (not part of `npm run check`).
