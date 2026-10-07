# Dev server (`npm run dev`)

v3's dev setup, on the v4 engine: one command starts `vite dev` of `apps/web` with seeded data, so you can develop against a live server and open it on a phone.

```bash
npm run dev                       # https on every LAN address, port 5173, data in ./.dev-data
npm run dev:http                  # the same over plain http
npm run dev -- --reset            # wipe the data dir and seed it again (or DEV_RESET=1)
npm run dev -- --port 5200 --dir /tmp/dev-data --host 127.0.0.1
```

Flags: `--port` (5173), `--host` (0.0.0.0), `--dir`, `--reset`, `--http`. Environment: `DATA_DIR` (same as `--dir`), `DEV_RESET=1`, `DEV_HTTP=true` (same as `--http`).

## What it does
1. Compiles the Paraglide messages (`npm run i18n -w @ueberblick/web`, generated files the dev server imports; `npm run build` does the same as `prebuild`).
2. **Seeds** the data dir when it has no `.dev-seeded` marker (`scripts/demo/demo.mjs` `seed`, the same function as `npm run demo`, R1): control.db with the admin, the three demo projects, one participant per role and the sample data as runs. A short-lived dev server on a free port takes the deploy. A non-empty dir without the marker is refused (use `--reset` or another `--dir`).
3. Keeps the data on later starts. `--reset` or `DEV_RESET=1` reseeds.
4. Starts `vite dev --host` (its pid is the one the script stops on Ctrl-C) and prints the addresses, the admin e-mail and password and one sign-in link per participant. A link works once; `npm run demo -- --links --dir ./.dev-data` prints fresh ones.

The admin signs in with e-mail and password only (`ADMIN_TOTP` is off by default, WP-942; the seed creates the admin, the memberships and the roster through `seedControl`, which the first-admin-from-`.env` start does not): the seed does not enrol TOTP (owner decision: TOTP is optional, off by default). `seedControl` (`apps/web/e2e/seed.ts`) takes `{ totp: false }` for this; the e2e specs keep the default and enrol TOTP.

## https, the phone and http
`npm run dev` loads `@vitejs/plugin-basic-ssl` (`DEV_HTTPS=1`, set by the script): a self-signed certificate, so a phone on the same network gets a secure context (service worker, Web Locks; plain http from another device stops the participant app). Open `https://<LAN address>:5173/` from the phone, accept the certificate warning once. `npm run dev:http` leaves the plugin out, for desktop GIS clients (QGIS, GDAL) that reject the certificate; then only `localhost` gets a working participant app.

## The data dir
`./.dev-data` (gitignored): `control.db`, `project-<key>.db`, `.dev-seeded` (the sign-in), `seed-server.log`. Delete it or use `--reset` to start over.

## Why dev needed a fix
SvelteKit put `@ueberblick/core` and `@ueberblick/ui` into `ssr.external`, so Node's own loader read the TypeScript sources and failed on the extensionless import `./model` (every route answered 500). `apps/web/vite.config.ts` (`workspaceSources`) takes all `@ueberblick/*` packages out of `ssr.external` and into `ssr.noExternal`, as the build does.

## Tests
`scripts/dev/dev-seed.spec.ts` (in `npm run check`): arguments, seed once, the `seedControl` option. `scripts/dev/dev.spec.mjs` starts the real dev server (http and https, restart, reset) and takes minutes, so it is outside `npm run check`: `npm run test:dev`.
